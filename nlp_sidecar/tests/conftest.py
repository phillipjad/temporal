"""
Shared fixtures and helpers for the nlp_sidecar test suite.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest

from nlp_sidecar.model import InferenceResult


# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------


@pytest.fixture()
def tokenizer_dir(tmp_path: Path) -> Path:
    """Minimal valid tokenizer directory (has tokenizer_config.json)."""
    d = tmp_path / "tokenizer"
    d.mkdir()
    (d / "tokenizer_config.json").write_text("{}")
    return d


@pytest.fixture()
def onnx_file(tmp_path: Path) -> Path:
    """Fake ONNX file whose name encodes version 1.0.0."""
    f = tmp_path / "finbert_v1_0_0.onnx"
    f.write_bytes(b"")
    return f


@pytest.fixture()
def meta_file(onnx_file: Path) -> Path:
    """Paired .meta.toml with version matching the onnx_file filename."""
    m = onnx_file.with_suffix(".meta.toml")
    m.write_text('[model]\nversion = "1.0.0"\n')
    return m


# ---------------------------------------------------------------------------
# Mock heavy dependencies
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_session() -> MagicMock:
    """InferenceSession mock — returns single-row logits by default."""
    s = MagicMock()
    s.run.return_value = [np.array([[0.1, 0.2, 0.7]], dtype=np.float32)]
    return s


@pytest.fixture()
def mock_tokenizer() -> MagicMock:
    """AutoTokenizer mock — returns minimal numpy encoding."""
    t = MagicMock()
    t.return_value = {
        "input_ids": np.zeros((1, 512), dtype=np.int64),
        "attention_mask": np.ones((1, 512), dtype=np.int64),
    }
    return t


# ---------------------------------------------------------------------------
# Result factory
# ---------------------------------------------------------------------------


def make_result(version: str = "1.0.0") -> InferenceResult:
    return InferenceResult(
        bullish_prob=0.7,
        bearish_prob=0.1,
        neutral_prob=0.2,
        model_version=version,
    )
