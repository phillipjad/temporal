"""
Offline training pipeline for the FinBERT sentiment classifier.

This script fine-tunes ProsusAI/finbert (or a compatible checkpoint) on
a labelled financial news dataset, then saves the fine-tuned weights for
ONNX export via export.py.

Label mapping (matches ProsusAI/finbert standard):
    0 = negative  (bearish)
    1 = neutral
    2 = positive  (bullish)

Usage:
    cd ml/training
    uv sync
    uv run python train.py

All paths are resolved from the paths in the TOML config at
/opt/temporal/config/temporal_config.toml. There are no environment
variables in this system (AGENTS.md §3.1).

Output:
    <training.output_dir>/finbert_ft/   — fine-tuned HuggingFace model
                                          ready for export.py
"""

from __future__ import annotations

import json
import logging
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from datasets import Dataset, DatasetDict
from sklearn.metrics import classification_report
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    EarlyStoppingCallback,
    EvalPrediction,
    Trainer,
    TrainingArguments,
)

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

_CONFIG_PATH = Path("/opt/temporal/config/temporal_config.toml")
_BASE_MODEL = "ProsusAI/finbert"
_MAX_TOKEN_LENGTH = 512
_LABEL_NAMES = ["negative", "neutral", "positive"]
_NUM_LABELS = 3


@dataclass
class TrainingConfig:
    data_path: Path
    output_dir: Path
    base_model: str
    max_length: int
    num_epochs: int
    per_device_batch_size: int
    learning_rate: float
    weight_decay: float
    warmup_ratio: float
    eval_split: float
    seed: int


def load_config() -> TrainingConfig:
    if not _CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config not found: {_CONFIG_PATH}")
    with _CONFIG_PATH.open("rb") as fh:
        raw = tomllib.load(fh)
    t = raw.get("ml", {}).get("training", {})
    return TrainingConfig(
        data_path=Path(t.get("data_path", "/opt/temporal/data/training.jsonl")),
        output_dir=Path(t.get("output_dir", "/opt/temporal/models")),
        base_model=t.get("base_model", _BASE_MODEL),
        max_length=int(t.get("max_length", _MAX_TOKEN_LENGTH)),
        num_epochs=int(t.get("num_epochs", 3)),
        per_device_batch_size=int(t.get("per_device_batch_size", 16)),
        learning_rate=float(t.get("learning_rate", 2e-5)),
        weight_decay=float(t.get("weight_decay", 0.01)),
        warmup_ratio=float(t.get("warmup_ratio", 0.1)),
        eval_split=float(t.get("eval_split", 0.1)),
        seed=int(t.get("seed", 42)),
    )


def load_dataset(data_path: Path, cfg: TrainingConfig) -> DatasetDict:
    """
    Load training data from a JSONL file.

    Each line must be a JSON object with at minimum:
        { "text": "...", "label": 0|1|2 }

    where label follows the standard FinBERT mapping:
        0 = negative (bearish), 1 = neutral, 2 = positive (bullish).

    Text is expected to be the article title concatenated with the body,
    separated by a space or newline. No preprocessing is applied here —
    the tokenizer handles normalisation.
    """
    if not data_path.exists():
        raise FileNotFoundError(f"Training data not found: {data_path}")

    records: list[dict[str, Any]] = []
    with data_path.open() as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"Invalid JSON on line {lineno} of {data_path}: {exc}"
                ) from exc
            if "text" not in obj or "label" not in obj:
                raise ValueError(
                    f"Line {lineno} missing 'text' or 'label' key: {obj}"
                )
            if obj["label"] not in (0, 1, 2):
                raise ValueError(
                    f"Line {lineno}: label must be 0, 1, or 2, got {obj['label']!r}"
                )
            records.append({"text": str(obj["text"]), "label": int(obj["label"])})

    if not records:
        raise ValueError(f"No training records found in {data_path}")

    logger.info("Loaded %d records from %s", len(records), data_path)

    dataset = Dataset.from_list(records)
    split = dataset.train_test_split(
        test_size=cfg.eval_split, seed=cfg.seed, stratify_by_column="label"
    )
    return DatasetDict({"train": split["train"], "eval": split["test"]})


def tokenize_dataset(
    dataset: DatasetDict,
    tokenizer: AutoTokenizer,
    max_length: int,
) -> DatasetDict:
    def _tokenize(batch: dict[str, Any]) -> dict[str, Any]:
        return tokenizer(
            batch["text"],
            padding="max_length",
            truncation=True,
            max_length=max_length,
        )

    tokenized = dataset.map(
        _tokenize,
        batched=True,
        remove_columns=["text"],
        desc="Tokenizing",
    )
    tokenized = tokenized.rename_column("label", "labels")
    tokenized.set_format("torch")
    return tokenized


def compute_metrics(eval_pred: EvalPrediction) -> dict[str, float]:
    logits = eval_pred.predictions
    labels = eval_pred.label_ids
    preds = np.argmax(logits, axis=-1)
    report = classification_report(
        labels,
        preds,
        target_names=_LABEL_NAMES,
        output_dict=True,
        zero_division=0,
    )
    return {
        "accuracy": float(report["accuracy"]),
        "f1_macro": float(report["macro avg"]["f1-score"]),
        "f1_bullish": float(report["positive"]["f1-score"]),
        "f1_bearish": float(report["negative"]["f1-score"]),
        "f1_neutral": float(report["neutral"]["f1-score"]),
    }


def train(cfg: TrainingConfig) -> Path:
    """
    Fine-tune FinBERT and save the result.

    Returns:
        Path to the saved fine-tuned model directory.
    """
    ft_dir = cfg.output_dir / "finbert_ft"
    ft_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Loading base model: %s", cfg.base_model)
    tokenizer = AutoTokenizer.from_pretrained(cfg.base_model, use_fast=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        cfg.base_model,
        num_labels=_NUM_LABELS,
        id2label={0: "negative", 1: "neutral", 2: "positive"},
        label2id={"negative": 0, "neutral": 1, "positive": 2},
        ignore_mismatched_sizes=True,
    )

    dataset = load_dataset(cfg.data_path, cfg)
    tokenized = tokenize_dataset(dataset, tokenizer, cfg.max_length)

    training_args = TrainingArguments(
        output_dir=str(ft_dir),
        num_train_epochs=cfg.num_epochs,
        per_device_train_batch_size=cfg.per_device_batch_size,
        per_device_eval_batch_size=cfg.per_device_batch_size * 2,
        learning_rate=cfg.learning_rate,
        weight_decay=cfg.weight_decay,
        warmup_ratio=cfg.warmup_ratio,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1_macro",
        greater_is_better=True,
        seed=cfg.seed,
        logging_steps=50,
        report_to="none",
        fp16=torch.cuda.is_available(),
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized["train"],
        eval_dataset=tokenized["eval"],
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)],
    )

    logger.info("Starting training: epochs=%d", cfg.num_epochs)
    trainer.train()

    eval_results = trainer.evaluate()
    logger.info("Final eval results: %s", eval_results)

    trainer.save_model(str(ft_dir))
    tokenizer.save_pretrained(str(ft_dir))
    logger.info("Fine-tuned model saved to: %s", ft_dir)

    return ft_dir


def main() -> None:
    cfg = load_config()
    logger.info("Training config: %s", cfg)
    ft_dir = train(cfg)
    logger.info(
        "Training complete. Run export.py to produce the ONNX artifact. "
        "Fine-tuned weights: %s",
        ft_dir,
    )


if __name__ == "__main__":
    main()