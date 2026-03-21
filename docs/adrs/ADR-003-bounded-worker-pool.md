# ADR-003: Bounded Worker Pool, Not Per-Event Goroutines

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

News articles arrive continuously and each requires a sidecar HTTP call (blocking I/O). Two concurrency models were considered:

1. **Per-event goroutines** — spawn a goroutine for every incoming article.
2. **Bounded worker pool** — a fixed number of worker goroutines consume from a buffered channel.

The sidecar has finite capacity. With unbounded goroutines, a spike in news volume would saturate the sidecar's request queue, cause head-of-line blocking, and allow unbounded memory growth in the Go engine.

## Decision

All article processing goes through a bounded worker pool in `internal/news/`. Workers are fed by a buffered channel. The pool size is controlled by `[ingestion] worker_count` in `temporal_config.toml` and defaults to `runtime.NumCPU()`.

## Consequences

- Backpressure is explicit: when the channel is full, the ingestor blocks rather than spawning new goroutines.
- Memory usage under news spikes is bounded.
- Spawning goroutines per news article is prohibited (see AGENTS.md §3, checklist).
- The pool size is the primary knob for throughput tuning; it should be set based on measured sidecar saturation limits.
