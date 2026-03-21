# ADR-004: Two-Tier Persistence (Redis Hot Path + Postgres Durable)

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

The system has two classes of data with different access patterns and durability requirements:

- **Operational hot-path data** — live confidence scores, the deduplication bloom filter. Must be accessible in sub-millisecond latency on every article processed.
- **Audit-grade records** — orders, signal events, news events, user data. Must be fully durable and queryable over time.

A single database cannot serve both sets of requirements without compromising one.

## Decision

Two storage tiers are used:

- **Redis** — stores live confidence state (`SignalWeight` lists per market) and the deduplication bloom filter. Confidence score recalculation happens lazily on read in `ConfidenceStore.GetScore()`.
- **Postgres + TimescaleDB** — stores all audit-grade records. `news_events` and `signal_events` are TimescaleDB hypertables for efficient time-series queries. The `orders` table uses full durability (`synchronous_commit=ON`).

## Durability Matrix

| Table | `synchronous_commit` | Rationale |
|---|---|---|
| `orders` | ON (default) | Financial record — must never be lost |
| `news_events` | OFF acceptable | Append-only, high-volume, reconstructible |
| `signal_events` | OFF acceptable | Append-only, high-volume, reconstructible |
| All others | ON (default) | Standard durability |

## Consequences

- `fsync=off` is never permitted anywhere in the system (see AGENTS.md §3.5).
- `synchronous_commit=off` is only permitted on `signal_events` and `news_events`.
- No code path writing to `orders` may set `synchronous_commit=off` at the connection or transaction level (see AGENTS.md §3.6).
- Confidence decay is lazy (on read), not tick-based. A background goroutine that applies decay on a schedule is prohibited (see AGENTS.md §4.4 and checklist).
