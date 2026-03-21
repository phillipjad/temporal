# Architecture Decision Records

This directory contains the ADRs for Temporal. Each decision that meaningfully constrains the system's design is recorded here.

The canonical source for the rationale behind each decision was originally `ARCHITECTURE_PLAN.md §1`. These files are the divorced, standalone form of those records.

## Index

| ADR | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-kalshi-primary-broker-behind-interface.md) | Kalshi as Primary Broker, Behind an Interface | Accepted |
| [ADR-002](ADR-002-ml-inference-fastapi-sidecar.md) | ML Inference Runs in a FastAPI Sidecar with Dynamic Batching | Accepted |
| [ADR-003](ADR-003-bounded-worker-pool.md) | Bounded Worker Pool, Not Per-Event Goroutines | Accepted |
| [ADR-004](ADR-004-two-tier-persistence.md) | Two-Tier Persistence (Redis Hot Path + Postgres Durable) | Accepted |
| [ADR-005](ADR-005-dual-autotrading-opt-in.md) | Automated Trading Requires Explicit Dual Opt-In | Accepted |
| [ADR-006](ADR-006-rss-polygon-news-ingestion.md) | RSS + Polygon Free Tier for News Ingestion | Accepted |
| [ADR-007](ADR-007-contract-first-openapi.md) | Contract-First Development via OpenAPI 3.1 | Accepted |
| [ADR-008](ADR-008-hardcoded-config-path-toml-no-envvars.md) | Hardcoded Config Path, TOML Format, Zero Environment Variables | Accepted |

## Format

Each ADR follows this structure:

- **Status** — `Proposed`, `Accepted`, `Deprecated`, or `Superseded by ADR-NNN`
- **Date** — date the decision was accepted
- **Context** — what problem the decision addresses and what alternatives were considered
- **Decision** — what was decided
- **Consequences** — what the decision enforces, enables, or prohibits
