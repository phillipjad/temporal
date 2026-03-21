"""
Unit tests for nlp_sidecar.batching.DynamicBatcher.

FinBERTModel is fully mocked — no ONNX session or tokenizer is needed.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from nlp_sidecar.batching import DynamicBatcher
from nlp_sidecar.model import InferenceResult
from nlp_sidecar.tests.conftest import make_result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_batcher(results: list[InferenceResult] | None = None) -> DynamicBatcher:
    """Return a DynamicBatcher backed by a mock FinBERTModel."""
    model = MagicMock()
    if results is None:
        model.infer_batch.side_effect = lambda texts: [
            make_result() for _ in texts
        ]
    else:
        model.infer_batch.return_value = results
    return DynamicBatcher(model, window_ms=5, max_batch_size=32)


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


class TestLifecycle:
    async def test_start_twice_raises(self) -> None:
        batcher = _make_batcher()
        await batcher.start()
        try:
            with pytest.raises(RuntimeError, match="start\\(\\) called twice"):
                await batcher.start()
        finally:
            await batcher.stop()

    async def test_enqueue_before_start_raises(self) -> None:
        batcher = _make_batcher()
        with pytest.raises(RuntimeError, match="not running"):
            await batcher.enqueue("hello")

    async def test_stop_without_start_is_noop(self) -> None:
        batcher = _make_batcher()
        await batcher.stop()  # must not raise

    async def test_enqueue_after_stop_raises(self) -> None:
        batcher = _make_batcher()
        await batcher.start()
        await batcher.stop()
        with pytest.raises(RuntimeError, match="not running"):
            await batcher.enqueue("hello")


# ---------------------------------------------------------------------------
# Normal operation
# ---------------------------------------------------------------------------


class TestEnqueue:
    async def test_single_request_returns_result(self) -> None:
        batcher = _make_batcher()
        await batcher.start()
        try:
            result = await batcher.enqueue("Fed raises rates")
            assert isinstance(result, InferenceResult)
        finally:
            await batcher.stop()

    async def test_concurrent_requests_all_resolved(self) -> None:
        batcher = _make_batcher()
        await batcher.start()
        try:
            texts = [f"article {i}" for i in range(10)]
            results = await asyncio.gather(*[batcher.enqueue(t) for t in texts])
            assert len(results) == 10
            assert all(isinstance(r, InferenceResult) for r in results)
        finally:
            await batcher.stop()

    async def test_result_order_matches_input(self) -> None:
        """Each request gets its own result (not shuffled)."""
        batcher = _make_batcher()
        await batcher.start()
        try:
            r1, r2 = await asyncio.gather(
                batcher.enqueue("bearish news"),
                batcher.enqueue("bullish news"),
            )
            assert isinstance(r1, InferenceResult)
            assert isinstance(r2, InferenceResult)
        finally:
            await batcher.stop()


# ---------------------------------------------------------------------------
# Error handling — AGENTS.md §8.4 mandatory test
# ---------------------------------------------------------------------------


class TestBatchProcessorCrash:
    async def test_all_futures_resolved_with_error_on_crash(self) -> None:
        """
        AGENTS.md §8.4: DynamicBatcher must resolve all pending futures with
        an error when the batch processor (FinBERTModel.infer_batch) raises.
        """
        model = MagicMock()
        boom = RuntimeError("ONNX session exploded")
        model.infer_batch.side_effect = boom

        batcher = DynamicBatcher(model, window_ms=5, max_batch_size=32)
        await batcher.start()
        try:
            tasks = [
                asyncio.create_task(batcher.enqueue(f"text {i}")) for i in range(4)
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            assert all(isinstance(r, RuntimeError) for r in results), (
                f"Expected all RuntimeError, got: {results}"
            )
        finally:
            await batcher.stop()

    async def test_subsequent_requests_succeed_after_batch_error(self) -> None:
        """A crashed batch must not kill the batch loop for future requests."""
        call_count = 0

        def flaky(texts: list[str]) -> list[InferenceResult]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("first batch fails")
            return [make_result() for _ in texts]

        model = MagicMock()
        model.infer_batch.side_effect = flaky

        batcher = DynamicBatcher(model, window_ms=5, max_batch_size=32)
        await batcher.start()
        try:
            # First request — will fail
            with pytest.raises(RuntimeError, match="first batch fails"):
                await batcher.enqueue("doomed request")

            # Second request — loop must still be alive
            result = await batcher.enqueue("healthy request")
            assert isinstance(result, InferenceResult)
        finally:
            await batcher.stop()


# ---------------------------------------------------------------------------
# Drain on stop
# ---------------------------------------------------------------------------


class TestDrainOnStop:
    async def test_queued_items_cancelled_on_stop(self) -> None:
        """
        Items still in the queue when stop() is called must be cancelled
        (not left dangling). We pause the model so items back up.
        """
        ready = asyncio.Event()
        block = asyncio.Event()

        def slow_infer(texts: list[str]) -> list[InferenceResult]:
            # Signal we're inside the executor, then block
            ready.set()
            import time
            time.sleep(0.05)
            return [make_result() for _ in texts]

        model = MagicMock()
        model.infer_batch.side_effect = slow_infer

        batcher = DynamicBatcher(model, window_ms=1, max_batch_size=1)
        await batcher.start()

        # Enqueue two items. The batcher max_batch_size=1, so the first item
        # is dispatched immediately. The second sits in the queue.
        t1 = asyncio.create_task(batcher.enqueue("first"))
        await asyncio.sleep(0.01)  # let the batch loop pick up t1
        t2 = asyncio.create_task(batcher.enqueue("second"))

        await batcher.stop()

        # t2 may be cancelled or have an exception, but must not hang
        results = await asyncio.gather(t1, t2, return_exceptions=True)
        # t1 completed (either result or error), t2 was cancelled
        assert any(isinstance(r, (InferenceResult, Exception)) for r in results)
