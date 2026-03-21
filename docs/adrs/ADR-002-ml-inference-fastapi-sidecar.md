# ADR-002: ML Inference Runs in a FastAPI Sidecar with Dynamic Batching

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

The Go engine must run ML inference on each news article as part of the pipeline. Two approaches were considered:

1. **In-process inference** — embed an ONNX runtime via CGo bindings directly in the Go binary.
2. **Out-of-process sidecar** — run a dedicated Python + FastAPI process co-located in Docker Compose; the Go engine calls it over localhost HTTP.

Throughput matters: under load, sequential per-article inference is slower than vectorized batch inference. The model is **FinBERT** (`ProsusAI/finbert`), a BERT-based transformer pre-trained on financial news corpora and fine-tuned for three-class sentiment (bullish / bearish / neutral), exported to ONNX for runtime inference.

## Decision

ML inference runs in a dedicated **Python 3.14 (free-threaded) + FastAPI** process (`nlp_sidecar/`), co-located in Docker Compose. The Go engine communicates with it via localhost HTTP. The `MLModel` interface in Go (`internal/model/`) abstracts the transport entirely. `SidecarMLModel` is the only production implementation.

Dynamic batching is applied in the sidecar: incoming requests are accumulated over a short collection window (default 8ms) and processed as a single vectorized ONNX batch of up to 32 articles. Free-threaded Python 3.14 removes the GIL, allowing the ONNX executor threads and the asyncio event loop to run in true parallel without contention.

## Latency Budget (CPU deployment)

| Step | Estimate |
|---|---|
| Localhost HTTP round-trip | ~0.2ms |
| JSON serialisation (text string) | ~0.1ms |
| HuggingFace tokenisation inside sidecar | ~1–2ms |
| Batched FinBERT ONNX inference (batch ≤ 32) | ~15–30ms |
| **Total per article** | **~17–33ms** |

This is well within the sub-second decision target. For GPU-enabled deployments, batched FinBERT inference drops to ~3–8ms, bringing total latency to ~5–11ms.

## Consequences

- The Go binary has zero CGo dependencies and no ONNX or ML libraries. Adding any such dependency violates this decision (see AGENTS.md §3.4).
- The sidecar can be hot-reloaded and scaled independently of the Go engine.
- The sidecar's responsibility boundary is strictly raw text in / probability arrays out. It must have no knowledge of markets, orders, users, confidence scores, or trading logic (see AGENTS.md §4.1).
- The `MLModel` interface is the clean seam: replacing the sidecar (e.g. with a gRPC transport or a different model) requires only a new implementation of that interface.
- Free-threaded Python 3.14 requires that all shared mutable state in the sidecar be protected by explicit locks, not relied-upon GIL serialisation. The `FinBERTModel` bundle swap uses `threading.Lock` for this reason.
