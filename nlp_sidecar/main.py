"""
FastAPI entrypoint for the FinBERT ML inference sidecar.

Exposes three endpoints (ARCHITECTURE_PLAN.md §6.3):

    POST /infer   — accept raw article text, return sentiment probabilities
    GET  /health  — liveness + model version
    POST /reload  — atomically swap the ONNX session

Configuration is read from /opt/temporal/config/temporal_config.toml
at startup. There are no environment variables in this system
(AGENTS.md §3.1).

The sidecar has zero knowledge of markets, users, confidence scores,
or trading logic (AGENTS.md §4.1). It receives text; it returns
probabilities.
"""

from __future__ import annotations

import logging
import tomllib
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from nlp_sidecar.batching import DynamicBatcher
from nlp_sidecar.model import FinBERTModel

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

_CONFIG_PATH = Path("/opt/temporal/config/temporal_config.toml")


def _load_config() -> dict:  # type: ignore[type-arg]
    if not _CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"Config file not found: {_CONFIG_PATH}. "
            "Mount the TOML config before starting the sidecar."
        )
    with _CONFIG_PATH.open("rb") as fh:
        return tomllib.load(fh)


_model: FinBERTModel | None = None
_batcher: DynamicBatcher | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    global _model, _batcher

    cfg = _load_config()
    sidecar_cfg = cfg.get("ml", {}).get("sidecar", {})
    model_path: str = sidecar_cfg.get(
        "model_path", "/opt/temporal/models/finbert_v1.onnx"
    )
    window_ms: float = float(sidecar_cfg.get("batch_window_ms", 8.0))
    max_batch: int = int(sidecar_cfg.get("max_batch_size", 32))

    logger.info("Loading FinBERT model from: %s", model_path)
    _model = FinBERTModel(model_path)
    _batcher = DynamicBatcher(_model, window_ms=window_ms, max_batch_size=max_batch)
    await _batcher.start()

    logger.info(
        "Sidecar ready: model_version=%s window_ms=%.1f max_batch=%d",
        _model.model_version,
        window_ms,
        max_batch,
    )

    yield

    logger.info("Shutting down sidecar...")
    await _batcher.stop()
    logger.info("Sidecar shutdown complete")


app = FastAPI(
    title="Temporal AI ML Sidecar",
    description="FinBERT sentiment inference. Accepts raw article text; returns probabilities.",
    version="1.0.0",
    lifespan=lifespan,
)


class InferRequest(BaseModel):
    request_id: str = Field(..., description="Caller-supplied UUID for correlation")
    text: str = Field(
        ...,
        min_length=1,
        max_length=16_000,
        description=(
            "Raw article text to classify. Typically title + ' ' + body. "
            "Truncated to 512 tokens internally."
        ),
    )

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be blank or whitespace only")
        return v


class InferResponse(BaseModel):
    request_id: str
    bullish_prob: float = Field(..., ge=0.0, le=1.0)
    bearish_prob: float = Field(..., ge=0.0, le=1.0)
    neutral_prob: float = Field(..., ge=0.0, le=1.0)
    model_version: str


class HealthResponse(BaseModel):
    status: str
    model_version: str


class ReloadRequest(BaseModel):
    model_path: str = Field(
        ...,
        description="Absolute path to the new .onnx file on the sidecar container.",
    )


class ReloadResponse(BaseModel):
    status: str
    model_version: str


@app.post(
    "/infer",
    response_model=InferResponse,
    summary="Run FinBERT sentiment inference on a single article",
)
async def infer(req: InferRequest) -> InferResponse:
    """
    Accept raw article text and return sentiment class probabilities.

    Requests are dynamically batched internally — the caller blocks until
    its batch is dispatched and its individual result is ready.

    The text is tokenized inside the sidecar using the HuggingFace
    tokenizer bundled with the model. The Go engine sends plain text.
    """
    if _batcher is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sidecar not yet initialised",
        )

    try:
        result = await _batcher.enqueue(req.text)
    except Exception as exc:
        logger.exception("Inference failed for request_id=%s: %s", req.request_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Inference failed",
        ) from exc

    return InferResponse(
        request_id=req.request_id,
        bullish_prob=result.bullish_prob,
        bearish_prob=result.bearish_prob,
        neutral_prob=result.neutral_prob,
        model_version=result.model_version,
    )


@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness check",
)
async def health() -> HealthResponse:
    """
    Return HTTP 200 when the sidecar is ready to serve requests.

    The Go engine's startup probe and readiness probe both hit this
    endpoint. Returns 503 if the model has not finished loading.
    """
    if _model is None:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "loading", "model_version": ""},
        )
    return HealthResponse(status="ok", model_version=_model.model_version)


@app.post(
    "/reload",
    response_model=ReloadResponse,
    summary="Hot-reload the ONNX model",
)
async def reload(req: ReloadRequest) -> ReloadResponse:
    """
    Atomically replace the active ONNX session without restarting.

    Called by the Go API server's admin handler
    (POST /api/v1/admin/reload-model). The new bundle is fully loaded
    before the swap, so in-flight /infer calls on the old model complete
    normally.

    Returns 400 if the new version string matches the current one (no-op
    protection). Returns 404 if the model file or its metadata is missing.
    """
    if _model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sidecar not yet initialised",
        )

    try:
        new_version = _model.reload(req.model_path)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Model reload failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Reload failed",
        ) from exc

    return ReloadResponse(status="ok", model_version=new_version)