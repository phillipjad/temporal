"""
ONNX export pipeline for the fine-tuned FinBERT model.

Takes the fine-tuned HuggingFace model produced by train.py and exports:
    finbert_vN.onnx           — ONNX model for the sidecar
    finbert_vN.meta.toml      — version + input/output metadata
    tokenizer/                — HuggingFace tokenizer files (copied alongside onnx)

The sidecar (model.py) expects all three co-located in the same directory:
    /opt/temporal/models/
        finbert_vN.onnx
        finbert_vN.meta.toml
        tokenizer/
            tokenizer_config.json
            vocab.txt
            ...

A version mismatch between the .onnx and .meta.toml is a hard startup
error in both the Go engine and the sidecar (ARCHITECTURE_PLAN.md §6.2).

Usage:
    cd ml/training
    uv sync
    uv run python export.py [--version 2.0.0]
"""

from __future__ import annotations

import argparse
import logging
import tomllib
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
import tomli_w
from transformers import AutoModelForSequenceClassification, AutoTokenizer

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

_CONFIG_PATH = Path("/opt/temporal/config/temporal_config.toml")
_MAX_TOKEN_LENGTH = 512
_OPSET_VERSION = 17


def load_config() -> dict:  # type: ignore[type-arg]
    if not _CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config not found: {_CONFIG_PATH}")
    with _CONFIG_PATH.open("rb") as fh:
        return tomllib.load(fh)


def export(version: str) -> Path:
    """
    Export the fine-tuned FinBERT model to ONNX and write its metadata.

    Args:
        version: Semantic version string for this artifact (e.g. "2.0.0").
                 Must differ from any previously deployed version.

    Returns:
        Path to the directory containing the exported artifacts.
    """
    cfg = load_config()
    training_cfg = cfg.get("ml", {}).get("training", {})
    output_dir = Path(training_cfg.get("output_dir", "/opt/temporal/models"))
    ft_dir = output_dir / "finbert_ft"

    if not ft_dir.exists():
        raise FileNotFoundError(
            f"Fine-tuned model not found: {ft_dir}. Run train.py first."
        )

    onnx_name = f"finbert_v{version.replace('.', '_')}.onnx"
    meta_name = f"finbert_v{version.replace('.', '_')}.meta.toml"
    onnx_path = output_dir / onnx_name
    meta_path = output_dir / meta_name
    tokenizer_dst = output_dir / "tokenizer"

    logger.info("Loading fine-tuned model from: %s", ft_dir)
    tokenizer = AutoTokenizer.from_pretrained(str(ft_dir), use_fast=True)
    model = AutoModelForSequenceClassification.from_pretrained(str(ft_dir))
    model.eval()

    dummy_input = _make_dummy_input(tokenizer)

    logger.info("Exporting to ONNX (opset %d): %s", _OPSET_VERSION, onnx_path)
    torch.onnx.export(
        model,
        args=(
            dummy_input["input_ids"],
            dummy_input["attention_mask"],
            dummy_input["token_type_ids"],
        ),
        f=str(onnx_path),
        input_names=["input_ids", "attention_mask", "token_type_ids"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch_size"},
            "attention_mask": {0: "batch_size"},
            "token_type_ids": {0: "batch_size"},
            "logits": {0: "batch_size"},
        },
        opset_version=_OPSET_VERSION,
        do_constant_folding=True,
    )
    logger.info("ONNX export complete: %s", onnx_path)

    _verify_onnx(onnx_path, dummy_input, model)

    _write_meta(meta_path, version, onnx_name)

    tokenizer_dst.mkdir(parents=True, exist_ok=True)
    tokenizer.save_pretrained(str(tokenizer_dst))
    logger.info("Tokenizer saved to: %s", tokenizer_dst)

    logger.info(
        "Export complete.\n"
        "  ONNX:      %s\n"
        "  Metadata:  %s\n"
        "  Tokenizer: %s",
        onnx_path,
        meta_path,
        tokenizer_dst,
    )
    return output_dir


def _make_dummy_input(tokenizer: AutoTokenizer) -> dict[str, torch.Tensor]:
    """Produce a single-item batch for the ONNX tracing pass."""
    dummy_text = "Federal Reserve raises interest rates by 50 basis points."
    encoding = tokenizer(
        dummy_text,
        padding="max_length",
        truncation=True,
        max_length=_MAX_TOKEN_LENGTH,
        return_tensors="pt",
    )
    return {
        "input_ids": encoding["input_ids"],
        "attention_mask": encoding["attention_mask"],
        "token_type_ids": encoding.get(
            "token_type_ids",
            torch.zeros_like(encoding["input_ids"]),
        ),
    }


def _verify_onnx(
    onnx_path: Path,
    dummy_input: dict[str, torch.Tensor],
    torch_model: AutoModelForSequenceClassification,
) -> None:
    """
    Validate the exported ONNX graph and assert numerical equivalence
    with the original PyTorch model.

    Raises:
        RuntimeError: If outputs differ beyond floating-point tolerance.
    """
    logger.info("Verifying ONNX model...")

    onnx_model = onnx.load(str(onnx_path))
    onnx.checker.check_model(onnx_model)
    logger.info("ONNX graph check passed")

    sess = ort.InferenceSession(
        str(onnx_path), providers=["CPUExecutionProvider"]
    )

    feed = {
        "input_ids": dummy_input["input_ids"].numpy().astype(np.int64),
        "attention_mask": dummy_input["attention_mask"].numpy().astype(np.int64),
        "token_type_ids": dummy_input["token_type_ids"].numpy().astype(np.int64),
    }
    ort_logits: np.ndarray = sess.run(None, feed)[0]

    with torch.no_grad():
        pt_logits = torch_model(**dummy_input).logits.numpy()

    max_diff = float(np.abs(ort_logits - pt_logits).max())
    logger.info("Max logit difference (PT vs ONNX): %.2e", max_diff)
    if max_diff > 1e-4:
        raise RuntimeError(
            f"ONNX export verification failed: max logit diff {max_diff:.2e} "
            f"exceeds tolerance 1e-4. Re-export with --opset or check model."
        )
    logger.info("Numerical verification passed")


def _write_meta(meta_path: Path, version: str, onnx_filename: str) -> None:
    """
    Write the .meta.toml artifact consumed by model.py at startup.

    The [model] version key is the authoritative version identifier.
    A sidecar that loads an .onnx without a matching .meta.toml will
    refuse to start.
    """
    meta: dict = {  # type: ignore[type-arg]
        "model": {
            "version": version,
            "onnx_file": onnx_filename,
            "base_model": "ProsusAI/finbert",
            "max_token_length": _MAX_TOKEN_LENGTH,
            "label_order": ["negative", "neutral", "positive"],
            "label_mapping": {
                "negative": "bearish",
                "neutral": "neutral",
                "positive": "bullish",
            },
        }
    }
    with meta_path.open("wb") as fh:
        tomli_w.dump(meta, fh)
    logger.info("Metadata written: %s", meta_path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export fine-tuned FinBERT to ONNX"
    )
    parser.add_argument(
        "--version",
        required=True,
        help="Semantic version for this artifact, e.g. 2.0.0",
    )
    args = parser.parse_args()

    version: str = args.version
    if not version or not all(c.isdigit() or c == "." for c in version):
        raise ValueError(
            f"--version must be a dotted numeric version string, got: {version!r}"
        )

    export(version)


if __name__ == "__main__":
    main()