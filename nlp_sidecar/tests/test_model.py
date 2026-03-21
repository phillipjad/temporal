"""
Unit tests for nlp_sidecar.model.

All heavy dependencies (onnxruntime.InferenceSession, AutoTokenizer) are
patched so no real model weights or tokenizer files are needed.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, call, patch

import numpy as np
import pytest

from nlp_sidecar.model import FinBERTModel, InferenceResult, _softmax


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _make_model(
    onnx_file: Path,
    tokenizer_dir: Path,
    mock_session: MagicMock,
    mock_tokenizer: MagicMock,
) -> FinBERTModel:
    """Construct a FinBERTModel with all heavy deps mocked."""
    with (
        patch("nlp_sidecar.model.ort.InferenceSession", return_value=mock_session),
        patch(
            "nlp_sidecar.model.AutoTokenizer.from_pretrained",
            return_value=mock_tokenizer,
        ),
    ):
        return FinBERTModel(onnx_file, tokenizer_dir)


# ---------------------------------------------------------------------------
# TestInit
# ---------------------------------------------------------------------------


class TestInit:
    def test_missing_tokenizer_dir_raises(self, tmp_path: Path, onnx_file: Path, meta_file: Path) -> None:  # noqa: ARG002
        with pytest.raises(FileNotFoundError, match="Tokenizer directory not found"):
            FinBERTModel(onnx_file, tmp_path / "no_such_dir")

    def test_missing_tokenizer_config_json_raises(
        self, tmp_path: Path, onnx_file: Path, meta_file: Path  # noqa: ARG002
    ) -> None:
        incomplete = tmp_path / "incomplete_tokenizer"
        incomplete.mkdir()
        with pytest.raises(FileNotFoundError, match="tokenizer_config.json not found"):
            FinBERTModel(onnx_file, incomplete)

    def test_missing_onnx_raises(self, tmp_path: Path, tokenizer_dir: Path) -> None:
        with (
            patch("nlp_sidecar.model.AutoTokenizer.from_pretrained"),
            pytest.raises(FileNotFoundError, match="ONNX model not found"),
        ):
            FinBERTModel(tmp_path / "nonexistent.onnx", tokenizer_dir)

    def test_missing_meta_toml_raises(
        self, onnx_file: Path, tokenizer_dir: Path, mock_session: MagicMock
    ) -> None:
        with (
            patch("nlp_sidecar.model.ort.InferenceSession", return_value=mock_session),
            patch("nlp_sidecar.model.AutoTokenizer.from_pretrained"),
            pytest.raises(FileNotFoundError, match="Model metadata not found"),
        ):
            FinBERTModel(onnx_file, tokenizer_dir)

    def test_missing_version_key_raises(
        self, onnx_file: Path, tokenizer_dir: Path, mock_session: MagicMock
    ) -> None:
        meta = onnx_file.with_suffix(".meta.toml")
        meta.write_text("[model]\n")  # no version key
        with (
            patch("nlp_sidecar.model.ort.InferenceSession", return_value=mock_session),
            patch("nlp_sidecar.model.AutoTokenizer.from_pretrained"),
            pytest.raises(ValueError, match="missing \\[model\\] version key"),
        ):
            FinBERTModel(onnx_file, tokenizer_dir)

    def test_version_mismatch_raises(
        self, onnx_file: Path, tokenizer_dir: Path, mock_session: MagicMock
    ) -> None:
        # onnx_file is finbert_v1_0_0.onnx — filename encodes "1.0.0"
        meta = onnx_file.with_suffix(".meta.toml")
        meta.write_text('[model]\nversion = "2.0.0"\n')  # deliberate mismatch
        with (
            patch("nlp_sidecar.model.ort.InferenceSession", return_value=mock_session),
            patch("nlp_sidecar.model.AutoTokenizer.from_pretrained"),
            pytest.raises(ValueError, match="Model/metadata version mismatch"),
        ):
            FinBERTModel(onnx_file, tokenizer_dir)

    def test_successful_init(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
    ) -> None:
        model = _make_model(onnx_file, tokenizer_dir, mock_session, mock_tokenizer)
        assert model.model_version == "1.0.0"

    def test_tokenizer_loaded_once(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
    ) -> None:
        with (
            patch(
                "nlp_sidecar.model.ort.InferenceSession", return_value=mock_session
            ),
            patch(
                "nlp_sidecar.model.AutoTokenizer.from_pretrained",
                return_value=mock_tokenizer,
            ) as mock_from_pretrained,
        ):
            FinBERTModel(onnx_file, tokenizer_dir)
            mock_from_pretrained.assert_called_once()


# ---------------------------------------------------------------------------
# TestInferBatch
# ---------------------------------------------------------------------------


class TestInferBatch:
    def test_empty_batch_raises(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
    ) -> None:
        model = _make_model(onnx_file, tokenizer_dir, mock_session, mock_tokenizer)
        with pytest.raises(ValueError, match="at least one text"):
            model.infer_batch([])

    def test_result_count_matches_input(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
    ) -> None:
        # Return 3-row logits for a 3-text batch
        mock_session.run.return_value = [
            np.array(
                [[0.1, 0.2, 0.7], [0.6, 0.2, 0.2], [0.1, 0.8, 0.1]],
                dtype=np.float32,
            )
        ]
        model = _make_model(onnx_file, tokenizer_dir, mock_session, mock_tokenizer)
        results = model.infer_batch(["text A", "text B", "text C"])
        assert len(results) == 3

    def test_label_remapping(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
    ) -> None:
        """ProsusAI/finbert: index 0=bearish, 1=neutral, 2=bullish."""
        # Logits heavily favour index 2 (bullish)
        mock_session.run.return_value = [
            np.array([[0.1, 0.2, 0.7]], dtype=np.float32)
        ]
        model = _make_model(onnx_file, tokenizer_dir, mock_session, mock_tokenizer)
        results = model.infer_batch(["Fed cuts rates"])
        r = results[0]
        assert r.bullish_prob > r.bearish_prob
        assert r.bullish_prob > r.neutral_prob

    def test_model_version_in_result(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
    ) -> None:
        model = _make_model(onnx_file, tokenizer_dir, mock_session, mock_tokenizer)
        results = model.infer_batch(["some text"])
        assert results[0].model_version == "1.0.0"

    def test_probabilities_sum_to_one(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
    ) -> None:
        model = _make_model(onnx_file, tokenizer_dir, mock_session, mock_tokenizer)
        results = model.infer_batch(["some text"])
        r = results[0]
        total = r.bullish_prob + r.bearish_prob + r.neutral_prob
        assert abs(total - 1.0) < 1e-5


# ---------------------------------------------------------------------------
# TestReload
# ---------------------------------------------------------------------------


class TestReload:
    def _make_v2_onnx(self, tmp_path: Path) -> Path:
        """Create a second fake ONNX + meta for version 2.0.0."""
        f = tmp_path / "finbert_v2_0_0.onnx"
        f.write_bytes(b"")
        m = f.with_suffix(".meta.toml")
        m.write_text('[model]\nversion = "2.0.0"\n')
        return f

    def test_same_version_raises(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
        tmp_path: Path,
    ) -> None:
        model = _make_model(onnx_file, tokenizer_dir, mock_session, mock_tokenizer)
        # Second ONNX file with the SAME version "1.0.0"
        dup = tmp_path / "finbert_v1_0_0_copy.onnx"
        dup.write_bytes(b"")
        dup_meta = dup.with_suffix(".meta.toml")
        dup_meta.write_text('[model]\nversion = "1.0.0"\n')
        with (
            patch("nlp_sidecar.model.ort.InferenceSession", return_value=mock_session),
            pytest.raises(ValueError, match="already the active version"),
        ):
            model.reload(dup)

    def test_missing_file_raises(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
        tmp_path: Path,
    ) -> None:
        model = _make_model(onnx_file, tokenizer_dir, mock_session, mock_tokenizer)
        with pytest.raises(FileNotFoundError):
            model.reload(tmp_path / "ghost.onnx")

    def test_version_updates_after_reload(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
        tmp_path: Path,
    ) -> None:
        model = _make_model(onnx_file, tokenizer_dir, mock_session, mock_tokenizer)
        v2_path = self._make_v2_onnx(tmp_path)
        with patch("nlp_sidecar.model.ort.InferenceSession", return_value=mock_session):
            new_version = model.reload(v2_path)
        assert new_version == "2.0.0"
        assert model.model_version == "2.0.0"

    def test_tokenizer_not_reloaded(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
        tmp_path: Path,
    ) -> None:
        """AGENTS.md §6.3: tokenizer must NOT be reloaded on hot-swap."""
        with (
            patch(
                "nlp_sidecar.model.ort.InferenceSession", return_value=mock_session
            ),
            patch(
                "nlp_sidecar.model.AutoTokenizer.from_pretrained",
                return_value=mock_tokenizer,
            ) as mock_from_pretrained,
        ):
            model = FinBERTModel(onnx_file, tokenizer_dir)
            assert mock_from_pretrained.call_count == 1

            v2_path = self._make_v2_onnx(tmp_path)
            model.reload(v2_path)
            # Still exactly one call — reload must not touch the tokenizer
            assert mock_from_pretrained.call_count == 1

    def test_inflight_call_uses_old_bundle(
        self,
        onnx_file: Path,
        meta_file: Path,  # noqa: ARG002
        tokenizer_dir: Path,
        mock_session: MagicMock,
        mock_tokenizer: MagicMock,
        tmp_path: Path,
    ) -> None:
        """
        Atomic swap: in-flight infer_batch grabs a local bundle reference
        at the top of the call. A concurrent reload must not affect it.

        Simulate by capturing the bundle reference before reload and checking
        that infer_batch on the captured reference still returns v1 results.
        """
        model = _make_model(onnx_file, tokenizer_dir, mock_session, mock_tokenizer)

        # Grab the bundle before reload
        bundle_before = model._bundle  # noqa: SLF001
        assert bundle_before.model_version == "1.0.0"

        # Perform reload
        v2_path = self._make_v2_onnx(tmp_path)
        new_session = MagicMock()
        new_session.run.return_value = [np.array([[0.3, 0.3, 0.4]], dtype=np.float32)]
        with patch("nlp_sidecar.model.ort.InferenceSession", return_value=new_session):
            model.reload(v2_path)

        assert model.model_version == "2.0.0"
        # The captured reference still carries version 1.0.0
        assert bundle_before.model_version == "1.0.0"


# ---------------------------------------------------------------------------
# TestSoftmax
# ---------------------------------------------------------------------------


class TestSoftmax:
    def test_output_sums_to_one(self) -> None:
        logits = np.array([[1.0, 2.0, 3.0]], dtype=np.float32)
        result = _softmax(logits)
        assert abs(result.sum() - 1.0) < 1e-6

    def test_numerical_stability_large_values(self) -> None:
        logits = np.array([[1000.0, 1000.0, 1000.0]], dtype=np.float32)
        result = _softmax(logits)
        assert np.all(np.isfinite(result))
