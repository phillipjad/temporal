# ADR-002: ML Inference Runs in a FastAPI Sidecar with Dynamic Batching

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

The Go engine must run ML inference on each news article as part of the pipeline. Two approaches were considered:

1. **In-process inference** — embed an ONNX runtime via CGo bindings directly in the Go binary.
2. **Out-of-process sidecar** — run a dedicated Python + FastAPI process co-located in Docker Compose; the Go engine calls it over localhost HTTP.

Throughput matters: under load, sequential per-article inference is slower than vectorized batch inference.

## Decision

ML inference runs in a dedicated Python 3.11 + FastAPI process (`ml/sidecar/`), co-located in Docker Compose. The Go engine communicates with it via localhost HTTP. The `MLModel` interface in Go (`internal/model/`) abstracts the transport entirely. `SidecarMLModel` is the only production implementation.

Dynamic batching is applied in the sidecar: incoming requests are accumulated over a short collection window (5–10ms) and processed as a single vectorized ONNX batch.

## Latency Budget

| Step | Estimate |
|---|---|
| Localhost HTTP round-trip | ~0.2ms |
| JSON serialization (4,104 float32 values) | ~0.5ms |
| Batched LightGBM inference (batch ≤ 32) | ~1–3ms |
| **Total per article** | **~2–4ms** |

This is well within the sub-second decision target.

## Consequences

- The Go binary has zero CGo dependencies and no ONNX or ML libraries. Adding any such dependency violates this decision (see AGENTS.md §3.4).
- The sidecar can be hot-reloaded and scaled independently of the Go engine.
- The sidecar's responsibility boundary is strictly feature vectors in / probability arrays out. It must have no knowledge of markets, orders, users, confidence scores, or trading logic (see AGENTS.md §4.1).
- The `MLModel` interface is the clean seam: replacing the sidecar (e.g. with a gRPC transport or a different runtime) requires only a new implementation of that interface.
