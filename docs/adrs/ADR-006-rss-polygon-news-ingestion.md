# ADR-006: RSS + Polygon Free Tier for News Ingestion

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

The system requires a near-real-time stream of news articles to feed the ML pipeline. Two ingestion models were considered:

1. **Webhook-based push** — sources push events to the system as they occur.
2. **Poll-based pull** — the system periodically pulls from source APIs.

The target sources (RSS/Atom feeds and Polygon.io) do not offer authenticated webhook delivery on their free tiers.

## Decision

Poll-based ingestion is used exclusively:

- **RSS/Atom feeds** — polled at configurable intervals per source.
- **Polygon.io REST API** — free tier, polled at configurable intervals.

Each source is rate-limited with a per-source token bucket. No webhook receivers are implemented.

## Consequences

- Ingestion latency is bounded by the poll interval, not event-driven. The interval is a configuration knob under `[ingestion]` in `temporal_config.toml`.
- Rate limiting is mandatory per source to avoid free-tier throttling.
- If a source later offers webhook delivery, a new `NewsSource` interface implementation can be added without changes to the worker pool or downstream pipeline (see ADR-001 for the interface pattern).
- No additional cost is incurred from ingestion at free-tier volumes.
