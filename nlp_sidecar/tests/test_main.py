"""
Endpoint tests for nlp_sidecar.main.

The FastAPI lifespan (model loading) is bypassed by patching the module-level
_model and _batcher globals directly. httpx.AsyncClient with ASGITransport
is used for in-process HTTP without a running server.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from nlp_sidecar.main import app
from nlp_sidecar.tests.conftest import make_result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _async_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    )


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------


class TestHealth:
    async def test_ready(self) -> None:
        mock_model = MagicMock()
        mock_model.model_version = "1.0.0"
        with patch("nlp_sidecar.main._model", mock_model):
            async with _async_client() as client:
                resp = await client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["model_version"] == "1.0.0"

    async def test_not_ready_returns_503(self) -> None:
        with patch("nlp_sidecar.main._model", None):
            async with _async_client() as client:
                resp = await client.get("/health")
        assert resp.status_code == 503
        assert resp.json()["status"] == "loading"


# ---------------------------------------------------------------------------
# /infer
# ---------------------------------------------------------------------------


class TestInfer:
    async def test_success(self) -> None:
        mock_batcher = MagicMock()
        mock_batcher.enqueue = AsyncMock(return_value=make_result("1.0.0"))
        with patch("nlp_sidecar.main._batcher", mock_batcher):
            async with _async_client() as client:
                resp = await client.post(
                    "/infer",
                    json={"request_id": "req-001", "text": "Fed raises rates by 50bps"},
                )
        assert resp.status_code == 200
        body = resp.json()
        assert body["request_id"] == "req-001"
        assert body["model_version"] == "1.0.0"
        assert 0.0 <= body["bullish_prob"] <= 1.0
        assert 0.0 <= body["bearish_prob"] <= 1.0
        assert 0.0 <= body["neutral_prob"] <= 1.0

    async def test_batcher_not_ready_returns_503(self) -> None:
        with patch("nlp_sidecar.main._batcher", None):
            async with _async_client() as client:
                resp = await client.post(
                    "/infer",
                    json={"request_id": "req-002", "text": "some news"},
                )
        assert resp.status_code == 503
        body = resp.json()
        assert "error" in body
        assert body["request_id"] == "req-002"

    async def test_inference_error_returns_500_with_request_id(self) -> None:
        mock_batcher = MagicMock()
        mock_batcher.enqueue = AsyncMock(side_effect=RuntimeError("ONNX failed"))
        with patch("nlp_sidecar.main._batcher", mock_batcher):
            async with _async_client() as client:
                resp = await client.post(
                    "/infer",
                    json={"request_id": "req-003", "text": "market news"},
                )
        assert resp.status_code == 500
        body = resp.json()
        # AGENTS.md §6.4: error responses must carry request_id
        assert body["request_id"] == "req-003"
        assert "error" in body

    async def test_blank_text_rejected(self) -> None:
        async with _async_client() as client:
            resp = await client.post(
                "/infer",
                json={"request_id": "req-004", "text": "   "},
            )
        assert resp.status_code == 422

    async def test_empty_text_rejected(self) -> None:
        async with _async_client() as client:
            resp = await client.post(
                "/infer",
                json={"request_id": "req-005", "text": ""},
            )
        assert resp.status_code == 422

    async def test_missing_request_id_rejected(self) -> None:
        async with _async_client() as client:
            resp = await client.post(
                "/infer",
                json={"text": "hello"},
            )
        assert resp.status_code == 422

    async def test_text_too_long_rejected(self) -> None:
        async with _async_client() as client:
            resp = await client.post(
                "/infer",
                json={"request_id": "req-006", "text": "x" * 16_001},
            )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# /reload
# ---------------------------------------------------------------------------


class TestReload:
    async def test_success(self) -> None:
        mock_model = MagicMock()
        mock_model.reload.return_value = "2.0.0"
        with patch("nlp_sidecar.main._model", mock_model):
            async with _async_client() as client:
                resp = await client.post(
                    "/reload",
                    json={"model_path": "/opt/temporal/models/finbert_v2_0_0.onnx"},
                )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["model_version"] == "2.0.0"

    async def test_model_not_ready_returns_503(self) -> None:
        with patch("nlp_sidecar.main._model", None):
            async with _async_client() as client:
                resp = await client.post(
                    "/reload",
                    json={"model_path": "/opt/temporal/models/finbert_v2_0_0.onnx"},
                )
        assert resp.status_code == 503

    async def test_file_not_found_returns_404(self) -> None:
        mock_model = MagicMock()
        mock_model.reload.side_effect = FileNotFoundError("ONNX model not found")
        with patch("nlp_sidecar.main._model", mock_model):
            async with _async_client() as client:
                resp = await client.post(
                    "/reload",
                    json={"model_path": "/tmp/ghost.onnx"},
                )
        assert resp.status_code == 404

    async def test_same_version_returns_400(self) -> None:
        mock_model = MagicMock()
        mock_model.reload.side_effect = ValueError("already the active version")
        with patch("nlp_sidecar.main._model", mock_model):
            async with _async_client() as client:
                resp = await client.post(
                    "/reload",
                    json={"model_path": "/opt/temporal/models/finbert_v1_0_0.onnx"},
                )
        assert resp.status_code == 400

    async def test_missing_model_path_rejected(self) -> None:
        async with _async_client() as client:
            resp = await client.post("/reload", json={})
        assert resp.status_code == 422
