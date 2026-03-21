"""
Dynamic batching for the FinBERT inference sidecar.

Design (from ARCHITECTURE_PLAN.md §6.4):
  - Each call to `enqueue()` places a (text, Future) pair on an asyncio queue
    and then awaits its Future.
  - A single background `_batch_loop` task collects items for up to
    `window_ms` milliseconds or until `max_batch_size` is reached, then
    calls `FinBERTModel.infer_batch()` and resolves each Future.
  - The caller's coroutine unblocks as soon as its individual result is ready.
  - Go workers see a standard synchronous HTTP POST; batching is invisible.

Threading note:
  FinBERTModel.infer_batch() is a blocking CPU call. It is dispatched via
  `asyncio.get_running_loop().run_in_executor(None, ...)` so it runs on a
  ThreadPoolExecutor thread, keeping the event loop free to accept new
  requests during inference.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

from nlp_sidecar.model import FinBERTModel, InferenceResult

logger = logging.getLogger(__name__)

_DEFAULT_WINDOW_MS: float = 8.0
_DEFAULT_MAX_BATCH: int = 32


@dataclass
class _QueueItem:
    text: str
    future: asyncio.Future[InferenceResult]


class DynamicBatcher:
    """
    Collects concurrent /infer requests and dispatches them as a single
    vectorized ONNX batch.

    Usage:
        batcher = DynamicBatcher(model, window_ms=8, max_batch_size=32)
        await batcher.start()          # call once at app startup
        result = await batcher.enqueue("Fed raises rates by 50bps")
        await batcher.stop()           # call once at shutdown

    The `start()` / `stop()` lifecycle is designed to be driven by
    FastAPI's lifespan context manager.
    """

    def __init__(
        self,
        model: FinBERTModel,
        window_ms: float = _DEFAULT_WINDOW_MS,
        max_batch_size: int = _DEFAULT_MAX_BATCH,
    ) -> None:
        self._model = model
        self._window_s = window_ms / 1000.0
        self._max_batch_size = max_batch_size
        self._queue: asyncio.Queue[_QueueItem] = asyncio.Queue()
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Spawn the background batch-collection loop. Call once at startup."""
        if self._task is not None:
            raise RuntimeError("DynamicBatcher.start() called twice")
        self._task = asyncio.create_task(
            self._batch_loop(), name="finbert-batch-loop"
        )
        logger.info(
            "DynamicBatcher started: window_ms=%.1f max_batch=%d",
            self._window_s * 1000,
            self._max_batch_size,
        )

    async def stop(self) -> None:
        """
        Cancel the batch loop and drain any queued items with an error.

        Called during graceful shutdown. Any requests still in the queue
        (i.e. arrived after the engine started draining) receive a
        CancelledError so their HTTP responses complete with a 503.
        """
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None

        while not self._queue.empty():
            item = self._queue.get_nowait()
            if not item.future.done():
                item.future.cancel()

        logger.info("DynamicBatcher stopped")

    async def enqueue(self, text: str) -> InferenceResult:
        """
        Submit a single article text for inference.

        Blocks until the batch containing this request is processed and
        the individual result is available.

        Args:
            text: Raw article text (title + body, concatenated by caller).

        Returns:
            InferenceResult with bullish/bearish/neutral probabilities.

        Raises:
            RuntimeError: If called before start() or after stop().
            Exception:    If batch inference fails; propagated to caller.
        """
        if self._task is None or self._task.done():
            raise RuntimeError(
                "DynamicBatcher is not running. Call start() first."
            )

        loop = asyncio.get_running_loop()
        future: asyncio.Future[InferenceResult] = loop.create_future()
        await self._queue.put(_QueueItem(text=text, future=future))
        return await future

    async def _batch_loop(self) -> None:
        """
        Core collection-and-dispatch loop.

        Each iteration:
          1. Block until at least one item arrives.
          2. Collect additional items until the window expires or the
             batch is full.
          3. Run FinBERTModel.infer_batch() off the event loop thread.
          4. Resolve each item's Future with its individual result.
        """
        loop = asyncio.get_running_loop()

        while True:
            batch: list[_QueueItem] = []

            first = await self._queue.get()
            batch.append(first)

            deadline = loop.time() + self._window_s
            while len(batch) < self._max_batch_size:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    break
                try:
                    item = await asyncio.wait_for(
                        self._queue.get(), timeout=remaining
                    )
                    batch.append(item)
                except asyncio.TimeoutError:
                    break

            texts = [item.text for item in batch]

            t0 = time.perf_counter()
            try:
                results: list[InferenceResult] = await loop.run_in_executor(
                    None, self._model.infer_batch, texts
                )
            except Exception as exc:
                logger.exception(
                    "Batch inference failed (batch_size=%d): %s",
                    len(batch),
                    exc,
                )
                for item in batch:
                    if not item.future.done():
                        item.future.set_exception(exc)
                continue

            elapsed_ms = (time.perf_counter() - t0) * 1000
            logger.debug(
                "Batch dispatched: size=%d inference_ms=%.2f",
                len(batch),
                elapsed_ms,
            )

            for item, result in zip(batch, results):
                if not item.future.done():
                    item.future.set_result(result)