"""
ONNX session management for the FinBERT inference sidecar.

Responsibilities:
- Load and hold the FinBERT ONNX session.
- Tokenize raw text via the HuggingFace tokenizer (loaded from the same
  model directory as the ONNX file).
- Run inference and return (bullish_prob, bearish_prob, neutral_prob).
- Support atomic hot-reload without interrupting in-flight requests.

This module has zero knowledge of markets, users, confidence scores, or
trading logic. It receives text; it returns probabilities.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
import tomllib
from transformers import AutoTokenizer

logger = logging.getLogger(__name__)

MAX_TOKEN_LENGTH = 512


@dataclass(frozen=True)
class InferenceResult:
    bullish_prob: float
    bearish_prob: float
    neutral_prob: float
    model_version: str


@dataclass(frozen=True)
class _SessionBundle:
    """Immutable snapshot of a loaded model + tokenizer + version string."""

    session: ort.InferenceSession
    tokenizer: AutoTokenizer
    model_version: str


class FinBERTModel:
    """
    Thread-safe FinBERT ONNX model wrapper with atomic hot-reload.

    The active _SessionBundle is stored behind a plain object reference
    protected by a threading.Lock during swap only. Reads (inference) do
    not acquire the lock — they grab a local reference to the current
    bundle at the top of each call and use it for the duration, so a
    concurrent reload cannot invalidate an in-flight batch.

    ProsusAI/finbert label order: 0=negative (bearish), 1=neutral, 2=positive (bullish).
    This is remapped to the API contract (bullish, bearish, neutral) before returning.
    """

    def __init__(self, model_path: str | Path) -> None:
        self._lock = threading.Lock()
        self._bundle: _SessionBundle = _load_bundle(Path(model_path))
        logger.info(
            "FinBERT model loaded: version=%s path=%s",
            self._bundle.model_version,
            model_path,
        )

    @property
    def model_version(self) -> str:
        return self._bundle.model_version

    def infer_batch(self, texts: list[str]) -> list[InferenceResult]:
        """
        Tokenize and run inference on a batch of raw article texts.

        Args:
            texts: Non-empty list of raw article strings. Each will be
                   truncated to MAX_TOKEN_LENGTH tokens internally.

        Returns:
            List of InferenceResult, one per input text, in the same order.
        """
        if not texts:
            raise ValueError("infer_batch requires at least one text")

        bundle = self._bundle

        encoding = bundle.tokenizer(
            texts,
            padding="max_length",
            truncation=True,
            max_length=MAX_TOKEN_LENGTH,
            return_tensors="np",
        )

        feed: dict[str, np.ndarray] = {
            "input_ids": encoding["input_ids"].astype(np.int64),
            "attention_mask": encoding["attention_mask"].astype(np.int64),
            "token_type_ids": encoding.get(
                "token_type_ids",
                np.zeros_like(encoding["input_ids"], dtype=np.int64),
            ),
        }

        outputs = bundle.session.run(None, feed)
        logits: np.ndarray = outputs[0]
        probs = _softmax(logits)

        results: list[InferenceResult] = []
        for row in probs:
            bearish_prob = float(row[0])
            neutral_prob = float(row[1])
            bullish_prob = float(row[2])
            results.append(
                InferenceResult(
                    bullish_prob=bullish_prob,
                    bearish_prob=bearish_prob,
                    neutral_prob=neutral_prob,
                    model_version=bundle.model_version,
                )
            )
        return results

    def reload(self, new_model_path: str | Path) -> str:
        """
        Atomically replace the active session bundle.

        The new bundle is fully loaded before the lock is acquired, so
        in-flight inference calls on the old bundle complete uninterrupted.

        Returns:
            The new model version string.

        Raises:
            ValueError: If the new version string matches the current one
                        (prevents accidental no-op reloads).
            FileNotFoundError: If the model or its metadata is missing.
        """
        new_path = Path(new_model_path)
        new_bundle = _load_bundle(new_path)

        if new_bundle.model_version == self._bundle.model_version:
            raise ValueError(
                f"Reload target is already the active version: "
                f"{new_bundle.model_version}"
            )

        with self._lock:
            self._bundle = new_bundle

        logger.info(
            "FinBERT model hot-reloaded: version=%s path=%s",
            new_bundle.model_version,
            new_model_path,
        )
        return new_bundle.model_version


def _load_bundle(model_path: Path) -> _SessionBundle:
    """
    Load an ONNX session, its paired HuggingFace tokenizer, and metadata.

    Expected layout (all must exist and be co-located):

        /opt/temporal/models/
            finbert_vN.onnx
            finbert_vN.meta.toml      — [model] version = "N.M.P"
            tokenizer/
                tokenizer_config.json
                vocab.txt
                ... (standard HuggingFace tokenizer files)

    The tokenizer/ subdirectory is resolved relative to the .onnx file's
    parent. A missing .meta.toml or missing version key is a hard error.
    """
    if not model_path.exists():
        raise FileNotFoundError(f"ONNX model not found: {model_path}")

    meta_path = model_path.with_suffix(".meta.toml")
    if not meta_path.exists():
        raise FileNotFoundError(f"Model metadata not found: {meta_path}")

    with meta_path.open("rb") as fh:
        meta = tomllib.load(fh)

    try:
        model_version: str = meta["model"]["version"]
    except KeyError as exc:
        raise ValueError(
            f"meta.toml is missing [model] version key: {meta_path}"
        ) from exc

    tokenizer_dir = model_path.parent / "tokenizer"
    if not tokenizer_dir.is_dir():
        raise FileNotFoundError(
            f"Tokenizer directory not found: {tokenizer_dir}. "
            "The HuggingFace tokenizer files must be placed in a "
            "'tokenizer/' subdirectory alongside the .onnx file."
        )

    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = (
        ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    )
    sess_options.intra_op_num_threads = 4

    session = ort.InferenceSession(
        str(model_path),
        sess_options=sess_options,
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
    )

    tokenizer = AutoTokenizer.from_pretrained(
        str(tokenizer_dir),
        use_fast=True,
    )

    return _SessionBundle(
        session=session,
        tokenizer=tokenizer,
        model_version=model_version,
    )


def _softmax(logits: np.ndarray) -> np.ndarray:
    """Numerically stable row-wise softmax."""
    shifted = logits - logits.max(axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return (exp / exp.sum(axis=-1, keepdims=True)).astype(np.float32)