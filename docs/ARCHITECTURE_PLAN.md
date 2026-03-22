# Temporal AI — Architecture Plan

> **Language stack:** Go 1.22+ (backend) · Python 3.14 (free-threaded) + FastAPI (ML sidecar) · React 18 + TypeScript + Vite (frontend)
> **Deployment target:** Containerized (Docker Compose local, OCI-compatible for cloud registries)
> **Design philosophy:** Interfaces first, implementations second. Every external dependency sits behind an abstraction boundary. All safety controls are non-bypassable at the type-system level.

---

## Table of Contents

1. [Key Architectural Decisions (ADRs)](#1-key-architectural-decisions)
2. [System Overview](#2-system-overview)
3. [News Ingestion Layer](#3-news-ingestion-layer)
4. [Concurrency Model & Batching](#4-concurrency-model--batching)
5. [Feature Extraction & NLP Pipeline](#5-feature-extraction--nlp-pipeline)
6. [ML Strategy Engine (FastAPI Sidecar)](#6-ml-strategy-engine-fastapi-sidecar)
7. [Rolling Confidence Model](#7-rolling-confidence-model)
8. [Execution Layer](#8-execution-layer)
9. [Persistence Layer](#9-persistence-layer)
10. [API Server & Auth](#10-api-server--auth)
11. [Contract-First Development (OpenAPI)](#11-contract-first-development-openapi)
12. [Configuration (TOML)](#12-configuration-toml)
13. [Frontend Architecture](#13-frontend-architecture)
14. [Component Interfaces (Go Headers)](#14-component-interfaces-go-headers)
15. [Data Structures](#15-data-structures)
16. [Deployment & Container Layout](#16-deployment--container-layout)
17. [Open Questions / Future Work](#17-open-questions--future-work)

---

## 1. Key Architectural Decisions

### ADR-001: Kalshi as Primary Broker, Behind an Interface
**Decision:** Kalshi is the first-class broker target. All broker communication flows through an `ExecutionBroker` interface.
**Rationale:** Kalshi is CFTC-regulated, transacts in standard USD (no crypto wallet complexity), and exposes a well-documented REST + WebSocket API. Polymarket requires USDC and on-chain wallet integration — significantly higher operational risk for v1. The `ExecutionBroker` interface makes any future broker a drop-in without touching core logic.

### ADR-002: ML Inference Runs in a FastAPI Sidecar Using FinBERT
**Decision:** ML inference runs in a dedicated Python 3.14 (free-threaded) + FastAPI process, co-located in Docker Compose. The Go engine communicates with it over localhost HTTP. The `MLModel` interface in Go abstracts the transport entirely. The model is **FinBERT** (`ProsusAI/finbert`), a BERT-based transformer pre-trained on financial news corpora and fine-tuned for three-class sentiment (bullish / bearish / neutral), exported to ONNX for runtime inference.
**Rationale:** FinBERT provides strong domain-specific semantic understanding that TF-IDF bag-of-words models cannot match. It handles negation, paraphrase, and financial terminology correctly out of the box due to its pre-training corpus. The sidecar accumulates requests over a short collection window (5–10ms) and processes them as a single vectorised ONNX batch. This also allows independent model hot-reload, independent scaling, and keeps the Go binary free of CGo dependencies. The `MLModel` interface is the clean boundary should the sidecar ever need to be replaced.

**Latency budget for the sidecar path (CPU deployment):**
- Localhost HTTP round-trip: ~0.2ms
- JSON serialisation (text string): ~0.1ms
- HuggingFace tokenisation inside sidecar: ~1–2ms
- Batched FinBERT ONNX inference (batch of up to 32): ~15–30ms
- **Total: ~17–33ms per article** — well within the sub-second decision target.

> For GPU-enabled deployments, batched FinBERT inference drops to ~3–8ms, bringing total latency close to the original LightGBM budget.

### ADR-003: Bounded Worker Pool, Not Per-Event Goroutines
**Decision:** News events are processed by a fixed-size worker pool fed by a buffered channel, not by spawning a goroutine per article.
**Rationale:** A bounded pool provides explicit backpressure. Workers block on the sidecar HTTP call; unbounded goroutines would saturate the sidecar's request queue with no flow control, producing head-of-line blocking and unbounded memory growth during news spikes. The pool size is configurable and defaults to `runtime.NumCPU()`.

### ADR-004: Two-Tier Persistence (Redis Hot Path + Postgres Durable)
**Decision:** Redis stores live confidence state and the deduplication bloom. Postgres + TimescaleDB stores all audit-grade records.
**Rationale:** Redis provides sub-millisecond access to the operational hot path. Postgres provides durability and time-series query capability via the TimescaleDB extension. `fsync=off` is never used. `synchronous_commit=off` is acceptable only on explicitly listed append-only tables. See Section 9 for the full durability matrix.

### ADR-005: Automated Trading Requires Explicit Dual Opt-In
**Decision:** `AutoTradingEnabled` defaults to `false` at the type level. Both the user-level flag (`UserConfig.AutoTradingEnabled`) and the admin-level system flag (`SystemConfig.AutoTradingSystemEnabled`) must be `true` for real orders to be submitted. Neither alone is sufficient.
**Rationale:** Defense in depth. A single misconfigured field must not be sufficient to submit real orders.

### ADR-006: RSS + Polygon Free Tier for News Ingestion
**Decision:** Poll-based ingestion via RSS/Atom feeds and the Polygon.io free REST tier. No webhook-based ingestion.
**Rationale:** The target sources do not offer authenticated webhook delivery on their free tiers. RSS polling with configurable intervals and per-source token bucket rate limiting achieves near-real-time ingestion at zero cost.

### ADR-007: Contract-First Development via OpenAPI 3.0.3
**Decision:** All HTTP and WebSocket message shapes are defined in a single `openapi.yaml` (OpenAPI 3.0.3) committed at the repository root. Go server types and TypeScript client types are both generated from this spec. Hand-written type definitions for cross-service data are prohibited.
**Rationale:** Eliminates the entire class of client/server type-drift bugs. The spec is the authoritative source of truth; generated code is an artifact, never a source file. OpenAPI 3.0.3 is used instead of 3.1 because `oapi-codegen` does not yet fully support 3.1 (specifically the `type: [string, "null"]` nullable array syntax). Nullable fields use `nullable: true` (3.0 convention). See ADR-007 for the full rationale.

### ADR-008: Hardcoded Config Path, TOML Format, Zero Environment Variables
**Decision:** All configuration lives in a single TOML file at the fixed path `/opt/temporal/config/temporal_config.toml`. This path is hardcoded in the binary. There are no environment variables in this system.
**Rationale:** Environment variables are stringly-typed, schemaless, cannot express nested structure cleanly, and are difficult to validate at startup. TOML is Go's native config format, supports nested tables, is human-readable, and is validated against a struct at process startup — a misconfigured field is a hard startup error, not a runtime surprise. Fixing the config path eliminates an entire class of deployment ambiguity; all containers mount the config from a well-known location.

### ADR-009: Go Sends Raw Text to Sidecar; Tokenisation Is a Sidecar Concern
**Decision:** The Go engine performs only Unicode NFKC normalisation and concatenates article title and body before sending the result as a plain text string to the sidecar's `/infer` endpoint. The sidecar owns all tokenisation and truncation logic using the HuggingFace `AutoTokenizer` for the FinBERT vocabulary.
**Rationale:** FinBERT's WordPiece tokeniser is a Python-native component with no clean Go port. Keeping tokenisation in the sidecar avoids duplicating vocabulary management across languages, ensures tokenisation is always consistent with the model that consumes it, and removes the need for any model-specific artifact (`.vocab.toml`) to be loaded by the Go engine. The Go feature-extraction layer is now model-agnostic.

> See standalone record: [`docs/adrs/ADR-009-go-sends-raw-text-tokenisation-is-sidecar-concern.md`](adrs/ADR-009-go-sends-raw-text-tokenisation-is-sidecar-concern.md)

---

## 2. System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Docker Network                             │
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────────┐  │
│  │  News        │    │  Go Engine   │    │  Execution Broker  │  │
│  │  Ingestion   │───▶│  (core)      │───▶│  (Kalshi REST/WS)  │  │
│  │  (Go)        │    │              │    └────────────────────┘  │
│  └──────────────┘    └──────┬───────┘                            │
│                             │ localhost HTTP                      │
│                      ┌──────▼───────┐                            │
│                      │  ML Sidecar  │                            │
│                      │  (FastAPI)   │                            │
│                      └──────────────┘                            │
│                             │                                     │
│                      ┌──────▼───────┐                            │
│                      │  API Server  │                            │
│                      │  (Go / Chi)  │                            │
│                      └──────┬───────┘                            │
│                             │                                     │
│  ┌──────────────┐    ┌──────▼───────┐    ┌──────────────────┐   │
│  │  Redis       │    │  Frontend    │    │  Postgres        │   │
│  │  (hot state) │    │  (React/Vite)│    │  + TimescaleDB   │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Process Boundaries
- The Go `engine` and `api` compile to **separate binaries** (separate `cmd/` entrypoints) sharing `internal/` packages.
- The **ML sidecar** is a separate Python process. It receives raw article text and returns probability arrays. It has no awareness of markets, users, or trading logic — this boundary is intentional and must not be violated.
- The **frontend** is a pure static SPA served by the API server in production, or `vite dev` in development.
- Redis and Postgres are managed services within Docker Compose.

---

## 3. News Ingestion Layer

### 3.1 Source Selection

| Source | Method | Update Cadence | Cost | Bias Risk | Priority |
|---|---|---|---|---|---|
| Reuters RSS | RSS/Atom | ~2–5 min | Free | Very Low | P0 |
| AP News RSS | RSS/Atom | ~2–5 min | Free | Very Low | P0 |
| Google News RSS | RSS/Atom | ~1–3 min | Free | Medium (aggregator) | P1 |
| Polygon.io News | REST polling | ~1 min | Free tier (5 req/min) | Low | P1 |
| GDELT | REST polling | 15-min batches | Free | Low | P2 — deferred |

> **GDELT is deferred to v2.** Its 15-minute update interval is too coarse for the confidence model, and its noise-to-signal ratio requires filtering infrastructure not worth building before the core pipeline is proven.

### 3.2 Deduplication Strategy

A single Reuters story frequently surfaces across Google News and Polygon simultaneously. Without deduplication, this generates three independent signals for the same event — artificially inflating confidence. Two deduplication layers are applied in order before any article reaches the worker pool:

1. **URL normalization hash:** SHA-256 of the canonical URL with tracking parameters stripped. Catches exact republications.
2. **Title SimHash:** 64-bit SimHash of normalized headline tokens. Hamming distance ≤ 3 bits = duplicate. Catches near-duplicate rewordings.

Both hashes are stored in Redis with a 24-hour TTL. The Redis lookup is the gate — no article passes downstream without clearing it.

### 3.3 Rate Limiting

Each `NewsPoller` owns a `golang.org/x/time/rate` token bucket. Limits:

| Source | Limit |
|---|---|
| Reuters RSS | 1 req / 60s |
| AP RSS | 1 req / 60s |
| Google News RSS | 1 req / 30s |
| Polygon.io | 5 req / 60s (free tier hard cap) |

Pollers are jitter-delayed at startup by a random interval in `[0, poll_jitter_max_sec]` to prevent synchronized thundering-herd bursts on container restart.

### 3.4 Ingestion Pipeline

```
[RSS Feed / REST endpoint]
        │
        ▼  (HTTP GET, token bucket gated)
[RawFeedParser]  — validates, normalises to RawNewsItem
        │
        ▼
[DeduplicationFilter]  — Redis bloom check (URL hash + SimHash)
        │  drops duplicates
        ▼
chan<- RawNewsItem  (buffered, size=512, per-source)
        │
        ▼  (fan-in goroutine)
chan<- RawNewsItem  (unified, buffered, size=1024)
        │
        ▼
[WorkerPool]
```

### 3.5 Expected News Volume

| Condition | Articles / 5 min | Peak articles / sec |
|---|---|---|
| Normal market hours | 10–40 | ~0.1 |
| Active news cycle | 40–100 | ~0.3 |
| Breaking event (e.g. election night) | 100–300 | ~1.0 |

The unified channel buffer (1,024 items) absorbs breaking-event spikes without blocking pollers. A worker pool of 8 handles peak load with headroom.

---

## 4. Concurrency Model & Batching

### 4.1 Bounded Worker Pool

```
Unified news channel (buffered, 1024)
        │
        ▼
WorkerPool  (N workers; default = runtime.NumCPU(), configurable, max 16)
   Worker 1 ──┐
   Worker 2 ──┤──▶  [Text Preparation]
   Worker N ──┘            │
                    [Relevance Filter]  ── no market match ──▶  discard + log
                            │
                    [Sidecar HTTP POST /infer]
                            │
                    [Confidence Update → Redis]
                            │
                    [Threshold Check emit]  ──▶  chan<- StrategyOutput
```

### 4.2 No Pre-Inference Batching in Go

The rolling confidence model accumulates signal incrementally. Batching articles before sending to the sidecar would introduce an artificial latency floor of `(batch_size − 1) × mean_interarrival_time`. At normal volume (0.1 articles/sec), a batch of 10 adds ~90 seconds of latency — incompatible with the sub-second decision target.

**Dynamic batching is the sidecar's responsibility, not the pipeline's.** From the Go worker's perspective, every sidecar call is a synchronous single-item HTTP POST. The sidecar collects concurrent requests internally and dispatches them as a vectorised batch. This is transparent to Go callers.

**Batching is used in exactly two places:**
- **Redis writes:** Confidence updates are pipelined (multiple commands per round-trip) but not delayed.
- **Postgres inserts:** Append-only audit records (`news_events`, `signal_events`) are batch-inserted on a 5-second flush interval with a max batch size of 500. Latency here is irrelevant.

### 4.3 Goroutine Inventory

| Goroutine | Count | Lifecycle |
|---|---|---|
| RSS Poller | 1 per source (4–5 total) | Long-lived; context-cancelled on shutdown |
| Feed Fan-In Merger | 1 | Long-lived |
| Worker Pool Worker | N (configurable) | Long-lived |
| Confidence Threshold Monitor | 1 per subscribed market (max 100) | Created/destroyed on subscription change |
| Kalshi WebSocket Listener | 1 | Long-lived; reconnects on disconnect |
| Postgres Batch Flusher | 1 | Long-lived |
| HTTP Server (net/http) | Managed by runtime | Long-lived |

**Maximum goroutines at steady state (100 markets subscribed): ~115.** Well within Go's comfortable operating range.

### 4.4 Shutdown Sequencing

Shutdown follows a strict ordered sequence to prevent orphaned orders or data loss:

```
1. Cancel ingestion context      → stops all pollers; no new articles enter the pipeline
2. Drain unified news channel    → all buffered articles complete processing
3. Signal worker pool            → workers finish in-flight sidecar calls and exit
4. Flush pending confidence updates to Redis
5. Execution layer enters drain mode (no new orders accepted)
6. Flush Postgres batch buffer
7. Close Redis connection pool
8. Close Postgres connection pool
9. Exit 0
```

Enforced via `errgroup` with a structured context cancellation tree — not ad hoc `sync.WaitGroup` usage.

---

## 5. Feature Extraction & NLP Pipeline

### 5.1 Text Preparation (Pure Go)

With FinBERT as the inference model, the Go feature-extraction layer is intentionally minimal. The sidecar owns all tokenisation; Go is responsible only for preparing clean text to send.

Applied in sequence to both title and body of every article:

1. Unicode normalisation (NFKC)
2. HTML entity decoding
3. Title and body concatenated with a single space separator

The resulting string is sent directly to the sidecar as the `text` field in the `/infer` request body. No stemming, no stopword removal, no vocabulary lookup — FinBERT's WordPiece tokeniser handles subword segmentation internally.

> **Note for future contributors:** The previous pipeline included Porter stemming, stopword removal, and TF-IDF vectorisation against a 4,096-term vocabulary (`.vocab.toml`). These are no longer present. The `TFIDFVectorizer` interface and `FeatureVector.TFIDF` field have been removed. See ADR-009.

### 5.2 Relevance Filtering (Pre-Inference Gate)

Before making any HTTP call to the sidecar, each article is checked for relevance to the currently subscribed markets. Each market carries a user-configured set of keyword tags (e.g. `["federal reserve", "FOMC", "rate hike"]`). The filter checks the normalised article text against all subscribed markets.

If no market matches: the article is discarded and logged. No sidecar call is made. This keeps sidecar load proportional to meaningful signal volume, not raw news throughput.

---

## 6. ML Strategy Engine (FastAPI Sidecar)

### 6.1 Sidecar Responsibility Boundary

The sidecar has exactly one responsibility: **accept raw article text, run FinBERT ONNX inference, return a probability array.** It handles tokenisation internally. It has zero knowledge of markets, users, confidence state, trading logic, or order management. This boundary is a hard architectural constraint and must not be relaxed.

### 6.2 Model Choice: FinBERT → ONNX

**Selected model:** FinBERT (`ProsusAI/finbert`), a BERT-base model pre-trained on financial news corpora, fine-tuned on labelled financial news for three-class sentiment classification, exported to ONNX via `torch.onnx.export`.

| Option | Batched Inference Latency (CPU) | Semantic Understanding | Domain Tuning | Notes |
|---|---|---|---|---|
| LightGBM → ONNX | ~1–3ms | ❌ Bag-of-words only | ❌ Generic | Previous v1 model; replaced |
| XGBoost → ONNX | ~2–5ms | ❌ Bag-of-words only | ❌ Generic | No meaningful improvement over LightGBM |
| DistilBERT → ONNX | ~10–25ms | ✅ Transformer | ❌ Generic | General-purpose; weaker on financial text |
| **FinBERT → ONNX** | **~15–30ms** | **✅ Transformer** | **✅ Finance-domain** | **Selected** |

FinBERT hits the right tradeoff for this domain: strong semantic understanding of financial terminology and market-relevant language, correct handling of negation and paraphrase, and a clean ONNX export path. The latency increase over LightGBM (~15–30ms vs ~1–3ms) is acceptable given the sub-second decision target.

**Training pipeline (offline, Python in `ml/training/`):**

```
Labelled financial news CSV  (columns: text, label)
    → train.py: fine-tune ProsusAI/finbert  →  finbert_ft/  (PyTorch weights + tokenizer)
    → export.py: torch.onnx.export         →  finbert_vN.onnx
                 ONNX verification pass    →  finbert_vN.meta.toml
                 tokenizer copy            →  tokenizer/  (shared; not version-specific)
```

Two artifacts are versioned together (`finbert_vN.onnx`, `finbert_vN.meta.toml`). A version mismatch between these is a **hard startup error** in the sidecar.

The tokenizer lives at a single shared path (configured via `[ml.sidecar] tokenizer_path`, default: `/opt/temporal/models/tokenizer/`). It is loaded once at sidecar startup and is not reloaded during hot-swap — the tokenizer vocabulary is stable across FinBERT model versions. The tokenizer path is independent of the versioned ONNX filename.

**Training data schema (`news_labelled.csv`):**

| Column | Type | Values |
|---|---|---|
| `text` | string | Article title + " " + body |
| `label` | string | `"bullish"` \| `"bearish"` \| `"neutral"` |

### 6.3 Sidecar API Contract

The sidecar exposes three endpoints. All shapes are also reflected in `openapi.yaml` as schema components.

```
POST /infer
Request:  { "request_id": "<uuid>", "text": "<unicode-normalised article text>" }
Response: { "request_id": "<uuid>", "bullish_prob": 0.72, "bearish_prob": 0.18,
            "neutral_prob": 0.10, "model_version": "2.0.0" }

GET /health
Response: { "status": "ok", "model_version": "2.0.0" }

POST /reload
Request:  { "model_path": "/opt/temporal/models/finbert_v3.onnx" }
Response: { "status": "ok", "model_version": "3.0.0" }
```

The `/reload` endpoint is called by the Go API server's admin handler (`POST /api/v1/admin/reload-model`). The sidecar atomically replaces the ONNX session without interrupting in-flight requests. The tokenizer is **not** reloaded during a hot-swap.

### 6.4 Dynamic Batching

The sidecar collects concurrent `/infer` requests for a configurable window (default: 8ms, configurable in `temporal_config.toml` under `[ml.sidecar]`), then dispatches them as a single ONNX batch. Individual requests block on an `asyncio.Future` until their batch result is available.

```python
# Structural pseudocode — see ml/sidecar/batching.py for implementation
async def infer(req: InferRequest) -> InferResponse:
    future = asyncio.get_event_loop().create_future()
    await request_queue.put((req, future))
    return await future  # blocks until batch dispatched

async def batch_processor():
    while True:
        batch = await collect_batch(max_size=32, window_ms=8)
        texts = [req.text for req, _ in batch]
        inputs = tokenizer(texts, padding=True, truncation=True, max_length=512)
        outputs = onnx_session.run(None, inputs)
        for i, (_, fut) in enumerate(batch):
            fut.set_result(parse_output(outputs, i))
```

Go callers see a standard synchronous HTTP POST. Batching and tokenisation are entirely internal to the sidecar.

### 6.5 `MLModel` Go Interface

The Go engine never imports anything Python-specific. All sidecar interaction is behind the `MLModel` interface defined in Section 14. The `SidecarMLModel` struct is the sole implementation. It sends the prepared text string and receives probability floats — it has no awareness of tokenisation or model internals.

---

## 7. Rolling Confidence Model

### 7.1 Score Formula

Each subscribed market maintains a confidence score — a **decayed weighted sum of all signal contributions** received since the market was subscribed:

```
Score(t) = Σᵢ [ wᵢ × signalᵢ × exp(−λ × (t − tᵢ)) ]

  wᵢ       = relevance weight of article i  [0.0, 1.0]  (keyword match strength)
  signalᵢ  = P(BULLISH)ᵢ − P(BEARISH)ᵢ    [−1.0, 1.0]
  λ        = ln(2) / half_life_seconds       (default half-life: 3600s)
  t − tᵢ   = seconds elapsed since signal i was generated
```

**Score range: [−1.0, 1.0].** Positive = net bullish conviction. Negative = net bearish. Near zero = insufficient signal.

Decay is applied **lazily on read** — raw signals are stored in Redis, and the score is recalculated from them each time it is read. This avoids a background decay goroutine and keeps the signal list auditable.

### 7.2 Action Thresholds

| Band | Condition | Action |
|---|---|---|
| Strong Buy | `score ≥ +BUY_THRESHOLD` | Emit `BUY` `StrategyOutput` |
| Strong Sell | `score ≤ −SELL_THRESHOLD` | Emit `SELL` `StrategyOutput` |
| Neutral | Between thresholds | `NO_TRADE` (no emission) |

Both thresholds are user-configurable per `UserConfig`. Defaults: `BUY_THRESHOLD = 0.65`, `SELL_THRESHOLD = 0.65`.

### 7.3 Threshold Monitoring

One goroutine per subscribed market runs a tight poll loop (100ms interval) reading the market's current score from Redis. Redis read latency is ~0.1ms on localhost; 100 markets consume ~10ms/second of total compute — negligible.

**Re-entry prevention:** After a market triggers a BUY or SELL, it enters a configurable cooldown period (default: 5 minutes, stored as a Redis key with TTL) before it can trigger again. This prevents rapid oscillation at the threshold boundary.

### 7.4 Confidence State Lifecycle

```
Market subscribed    →  InitMarket: score=0.0, empty signal list written to Redis
Article processed    →  AddSignal: Lua script atomically appends signal weight
Score read           →  Lazy decay recalculated from raw signal list on every read
Market unsubscribed  →  Redis keys TTL set to 1 hour (grace), then evicted
```

Score updates use a Lua script executed atomically on Redis — no Go-level read-modify-write race is possible.

---

## 8. Execution Layer

### 8.1 Broker Interface

The `ExecutionBroker` interface is the **sole boundary between the strategy engine and real money.** No order-submission logic exists outside of an implementation of this interface. Adding a future broker (Polymarket, Kalshi v2, Manifold) means writing a new implementation — nothing else in the codebase changes.

### 8.2 Kalshi Integration

| Feature | API Type | Purpose |
|---|---|---|
| Market search / detail | REST GET | Subscription catalog |
| Order submission | REST POST | BUY / SELL execution |
| Order cancellation | REST DELETE | Kill switch, risk management |
| Position query | REST GET | Exposure check |
| Market event stream | WebSocket | Real-time price updates |

**Authentication:** Kalshi uses RSA private key signing (PKCS#8). The private key file path is specified in `temporal_config.toml` under `[broker.kalshi]`. The parsed key is held in memory only for the process lifetime; the path string is never stored in application state after startup.

### 8.3 Order Lifecycle

```
StrategyOutput received
        │
        ▼
[Pre-flight checks]  ─── FAIL ───▶  log RiskViolationError + NO_TRADE
  ✓  UserConfig.AutoTradingEnabled == true
  ✓  SystemConfig.AutoTradingSystemEnabled == true
  ✓  Market is in user's subscribed set
  ✓  Per-trade risk limit not breached
  ✓  Daily loss limit not breached
  ✓  Open position count below maximum
  ✓  Kill switch not active
  ✓  No open order already exists for this market
        │ ALL PASS
        ▼
[Order sizing]
  size = user_capital × UserConfig.MaxRiskPerTrade
  round to Kalshi minimum contract size
        │
        ▼
[Simulation mode?]
  simulation_mode = true  →  log SimulatedOrder; update paper portfolio in Redis
  simulation_mode = false →  submit to Kalshi REST API
        │
        ▼
[Order record written to Postgres]
  (synchronous_commit=ON, fsync=ON — always, no exceptions)
```

### 8.4 Kill Switch

The kill switch is a single Redis key `system:kill_switch` (boolean). It is checked at two independent points:

1. **In the pre-flight check** — every order request reads the key before proceeding.
2. **By a background monitor goroutine** (500ms poll interval) — if the key transitions to `true`, all open orders are cancelled via the Kalshi REST API immediately.

**Activation paths (any of these sets the key):**
- Admin API: `POST /api/v1/admin/kill-switch`
- Config file at startup: `[system] kill_switch = true`
- Direct Redis SET (ops emergency access, bypasses the API server entirely)

---

## 9. Persistence Layer

### 9.1 Redis (Operational Hot Path)

| Key Pattern | Value Type | TTL | Purpose |
|---|---|---|---|
| `confidence:{market_id}` | float64 | 48h | Current decayed score |
| `signals:{market_id}` | JSON list of SignalWeight | 48h | Raw signals for lazy decay recalc |
| `dedup:url:{sha256}` | 1 | 24h | URL deduplication |
| `dedup:sim:{simhash}` | 1 | 24h | SimHash deduplication |
| `cooldown:{market_id}` | 1 | configurable | Post-trigger re-entry prevention |
| `system:kill_switch` | bool | no TTL | Persists until explicitly cleared |
| `positions:{user_id}` | JSON | no TTL | Paper portfolio state |
| `refresh_revoked:{jti}` | 1 | 7d | JWT refresh token revocation list |

### 9.2 Postgres + TimescaleDB Schema

```sql
-- ── Append-only ingestion audit ──────────────────────────────────────────────
-- synchronous_commit = off acceptable. fsync = on always.

CREATE TABLE news_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source       TEXT NOT NULL,
    title        TEXT NOT NULL,
    url          TEXT NOT NULL,
    content_hash BYTEA NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ NOT NULL
);
SELECT create_hypertable('news_events', 'fetched_at');

CREATE TABLE signal_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    news_event_id UUID NOT NULL REFERENCES news_events(id),
    market_id     TEXT NOT NULL,
    bullish_prob  REAL NOT NULL,
    bearish_prob  REAL NOT NULL,
    neutral_prob  REAL NOT NULL,
    net_signal    REAL NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL
);
SELECT create_hypertable('signal_events', 'created_at');

-- ── Financial records ─────────────────────────────────────────────────────────
-- synchronous_commit = ON. fsync = ON. No exceptions, ever.

CREATE TABLE orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    market_id       TEXT NOT NULL,
    side            TEXT NOT NULL CHECK (side IN ('yes', 'no')),
    size            NUMERIC(18, 6) NOT NULL,
    limit_price     NUMERIC(18, 6) NOT NULL,
    status          TEXT NOT NULL CHECK (status IN
                        ('pending','submitted','filled','cancelled','failed')),
    simulated       BOOLEAN NOT NULL DEFAULT true,
    broker_order_id TEXT,
    failure_reason  TEXT,
    source_signal   JSONB,         -- serialized StrategyOutput; full audit trail
    created_at      TIMESTAMPTZ NOT NULL,
    submitted_at    TIMESTAMPTZ,
    filled_at       TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ
);

-- ── Auth and user configuration ───────────────────────────────────────────────
-- synchronous_commit = ON. fsync = ON.

CREATE TABLE users (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                       TEXT UNIQUE NOT NULL,
    password_hash               TEXT NOT NULL,   -- bcrypt cost 12
    role                        TEXT NOT NULL CHECK (role IN ('admin','trader','viewer')),
    auto_trading_enabled        BOOLEAN NOT NULL DEFAULT false,
    max_risk_per_trade          REAL NOT NULL DEFAULT 0.05,
    max_daily_loss              REAL NOT NULL DEFAULT 0.10,
    max_open_positions          INT NOT NULL DEFAULT 5,
    buy_threshold               REAL NOT NULL DEFAULT 0.65,
    sell_threshold              REAL NOT NULL DEFAULT 0.65,
    signal_decay_half_life_sec  INT NOT NULL DEFAULT 3600,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE market_subscriptions (
    user_id      UUID NOT NULL REFERENCES users(id),
    market_id    TEXT NOT NULL,
    keyword_tags TEXT[] NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, market_id)
);

-- Singleton row (enforced by CHECK). Admin-owned system toggles.
CREATE TABLE system_config (
    id                          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    auto_trading_system_enabled BOOLEAN NOT NULL DEFAULT false,
    kill_switch_active          BOOLEAN NOT NULL DEFAULT false,
    max_global_open_positions   INT NOT NULL DEFAULT 50,
    model_version               TEXT NOT NULL DEFAULT '',
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 9.3 Durability Matrix

| Table | `synchronous_commit` | `fsync` | Rationale |
|---|---|---|---|
| `orders` | **ON** | **ON** | Financial records. Zero data loss acceptable. |
| `users` | **ON** | **ON** | Authentication-critical. |
| `market_subscriptions` | **ON** | **ON** | User configuration. |
| `system_config` | **ON** | **ON** | Admin safety controls. |
| `signal_events` | OFF | **ON** | Losing ≤200ms of signals on crash is acceptable. |
| `news_events` | OFF | **ON** | Same as above. |

> **`fsync=off` is never used in this system.** It risks whole-database corruption on kernel crash and is categorically incompatible with a financial application. `synchronous_commit=off` is the only acceptable performance lever, and only on the two explicitly listed append-only tables.

---

## 10. API Server & Auth

### 10.1 Framework

Go + `github.com/go-chi/chi/v5` — lightweight, idiomatic, no reflection magic.

### 10.2 Authentication

**JWT RS256 with access token + refresh token:**
- **Access token:** 15-minute TTL, RS256 signed, payload carries `user_id`, `role`, `jti`.
- **Refresh token:** 7-day TTL, delivered in an `httpOnly Secure SameSite=Strict` cookie, server-side revocation via Redis TTL key keyed on `jti`.
- All `/api/v1/` routes require a valid access token except `/auth/login` and `/auth/refresh`.
- Admin routes (`/api/v1/admin/`) additionally require `role = admin` in the JWT claim.

### 10.3 Route Map

```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

GET    /api/v1/markets
GET    /api/v1/markets/{id}

GET    /api/v1/subscriptions
POST   /api/v1/subscriptions
DELETE /api/v1/subscriptions/{market_id}

GET    /api/v1/confidence
GET    /api/v1/confidence/{market_id}

GET    /api/v1/orders
GET    /api/v1/orders/{id}

GET    /api/v1/positions

GET    /api/v1/config
PUT    /api/v1/config

# ── Admin only ────────────────────────────────────────────────────
GET    /api/v1/admin/users
POST   /api/v1/admin/users
PUT    /api/v1/admin/users/{id}
DELETE /api/v1/admin/users/{id}
POST   /api/v1/admin/kill-switch
GET    /api/v1/admin/system-status
POST   /api/v1/admin/reload-model

# ── WebSocket ─────────────────────────────────────────────────────
WS     /ws/feed
```

### 10.4 WebSocket Feed

A single multiplexed WebSocket connection per client carries all real-time events. The TypeScript client deserializes each message as a discriminated union (see Section 11.3). Message types:

| `type` field | Payload |
|---|---|
| `confidence_update` | `{ market_id, score, ts }` |
| `strategy_output` | `{ market_id, decision, confidence, ts }` |
| `order_update` | `{ order_id, status, ts }` |
| `signal_event` | `{ market_id, net_signal, source, ts }` |
| `system_alert` | `{ level, message, ts }` |

---

## 11. Contract-First Development (OpenAPI)

### 11.1 Philosophy

`openapi.yaml` at the repository root is the **single source of truth** for every data shape that crosses a service boundary. This covers REST request/response bodies, error envelopes, and WebSocket message payloads (defined as named schema components). No developer writes a cross-boundary type by hand — all are generated.

### 11.2 Code Generation

| Artifact | Tool | Output path |
|---|---|---|
| Go server handler interfaces + request/response types | `oapi-codegen` | `api/generated.go` |
| TypeScript type definitions | `openapi-typescript` | `frontend/src/lib/api.types.ts` |
| TypeScript fetch client | `openapi-fetch` | `frontend/src/lib/api.client.ts` |

Generated files are committed to the repository. The generation commands below regenerate them. CI enforces that generated files are not out of sync with `openapi.yaml` — a diff fails the build.

```sh
# Run from the backend/ directory
cd backend && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest \
    -config ../oapi-codegen.yaml ../openapi.yaml

# Run from the repo root
pnpm dlx openapi-typescript openapi.yaml -o frontend/src/lib/api.types.ts
```

### 11.3 WebSocket Types in the Spec

WebSocket message payloads are defined as named schema components in `openapi.yaml`, giving TypeScript a proper exhaustive discriminated union for the WS message dispatcher:

```yaml
# openapi.yaml — excerpt
components:
  schemas:
    WsMessage:
      oneOf:
        - $ref: '#/components/schemas/WsConfidenceUpdate'
        - $ref: '#/components/schemas/WsStrategyOutput'
        - $ref: '#/components/schemas/WsOrderUpdate'
        - $ref: '#/components/schemas/WsSignalEvent'
        - $ref: '#/components/schemas/WsSystemAlert'
      discriminator:
        propertyName: type
        mapping:
          confidence_update: '#/components/schemas/WsConfidenceUpdate'
          strategy_output:   '#/components/schemas/WsStrategyOutput'
          order_update:      '#/components/schemas/WsOrderUpdate'
          signal_event:      '#/components/schemas/WsSignalEvent'
          system_alert:      '#/components/schemas/WsSystemAlert'

    WsConfidenceUpdate:
      type: object
      required: [type, marketId, score, ts]
      properties:
        type:     { type: string, enum: [confidence_update] }
        marketId: { type: string }
        score:    { type: number, format: float, minimum: -1.0, maximum: 1.0 }
        ts:       { type: string, format: date-time }
    # ... one schema per message type
```

The explicit `mapping` block is required — `openapi-typescript` 7.x needs it to generate narrowed string literal types for the discriminator field rather than a plain `string`.

The TypeScript compiler enforces that every `switch (message.type)` in the frontend handles all variants exhaustively.

### 11.4 JSON Tag Convention on Go Structs

Every Go struct serialized for transport — HTTP bodies, WS messages, Redis JSON values — carries explicit `json:` tags. Field names follow **camelCase in JSON** (matching the OpenAPI spec and TypeScript convention) and **snake_case in Go**. No exceptions.

`oapi-codegen`-generated types carry correct tags automatically from the spec. Hand-written internal structs that are also serialized (e.g. `SignalWeight` stored in Redis) are tagged manually and reviewed in PR.

Optional fields use pointer types with `omitempty`:

```go
BrokerOrderID *string `json:"brokerOrderId,omitempty"`
FilledAt      *time.Time `json:"filledAt,omitempty"`
```

The `PasswordHash` field on `User` is tagged `json:"-"` and is never serialized under any circumstances.

---

## 12. Configuration (TOML)

### 12.1 Fixed Config Path

The config file path is **hardcoded** in all binaries as:

```
/opt/temporal/config/temporal_config.toml
```

There are no environment variables. All containers mount the config file at this path via Docker volume.

### 12.2 Full Config Schema

```toml
# /opt/temporal/config/temporal_config.toml

[server]
port           = 8080
cors_origins   = ["http://localhost:5173"]
static_dir     = "/opt/temporal/frontend/dist"  # empty string disables static serving

[auth]
jwt_private_key_path  = "/opt/temporal/secrets/jwt_key.pem"
jwt_public_key_path   = "/opt/temporal/secrets/jwt_key.pub"
access_token_ttl_sec  = 900      # 15 minutes
refresh_token_ttl_sec = 604800   # 7 days

[database]
host             = "postgres"
port             = 5432
name             = "temporal"
user             = "temporal"
password_path    = "/opt/temporal/secrets/db_password.txt"  # read from file
ssl_mode         = "disable"   # "require" in production
max_open_conns   = 25
max_idle_conns   = 5
conn_timeout_sec = 5

[redis]
host          = "redis"
port          = 6379
password_path = ""    # empty = no auth
db            = 0

[broker]
  [broker.kalshi]
  env              = "demo"   # "demo" | "prod"
  api_key_id       = "your-key-id-here"
  private_key_path = "/opt/temporal/secrets/kalshi_key.pem"
  timeout_sec      = 5

[ml]
  [ml.sidecar]
  host              = "ml-sidecar"
  port              = 8001
  timeout_ms        = 200   # hard per-call timeout; increased from 50ms for FinBERT inference latency
  batch_window_ms   = 8     # dynamic batching collection window inside sidecar
  max_batch_size    = 32    # maximum articles per ONNX batch call
  model_path        = "/opt/temporal/models/finbert_v1.onnx"
  tokenizer_path    = "/opt/temporal/models/tokenizer"  # shared across model versions; not version-specific
  meta_path         = "/opt/temporal/models/finbert_v1.meta.toml"

[ingestion]
worker_count        = 8     # 0 = runtime.NumCPU()
unified_buffer_size = 1024
poll_jitter_max_sec = 10

  [ingestion.sources.reuters]
  enabled           = true
  feed_url          = "https://feeds.reuters.com/reuters/topNews"
  poll_interval_sec = 60

  [ingestion.sources.ap]
  enabled           = true
  feed_url          = "https://rsshub.app/apnews/topics/apf-topnews"
  poll_interval_sec = 60

  [ingestion.sources.google_news]
  enabled           = true
  feed_url          = "https://news.google.com/rss"
  poll_interval_sec = 30

  [ingestion.sources.polygon]
  enabled           = true
  api_key           = "your-polygon-key-here"
  poll_interval_sec = 60

[system]
simulation_mode             = true    # locks out real order submission at binary level
kill_switch                 = false
max_subscribed_markets      = 100
confidence_check_interval_ms = 100
db_batch_flush_interval_sec = 5
db_batch_max_size           = 500
```

### 12.3 Startup Validation Rules

Config is parsed and validated immediately after process start. Any failure below is a **hard startup error** — the process exits with a descriptive message before accepting any connections or beginning any work.

| Check | Error condition |
|---|---|
| Required key paths | File does not exist at stated path |
| Sidecar reachability | `GET /health` on sidecar does not return 200 within 5 seconds |
| Model/metadata version consistency | `meta_path` version does not match the version embedded in `model_path` filename |
| Tokenizer directory | `tokenizer_path` directory does not exist or is missing `tokenizer_config.json` |
| Broker env vs simulation mode | `simulation_mode = false` AND `broker.kalshi.env = "demo"` → hard error |
| Broker env + live trading | `simulation_mode = false` AND `broker.kalshi.env = "prod"` → 10-second countdown warning before startup (intentional friction) |
| Worker count range | `worker_count > 16` → hard error |
| Market subscription cap | `max_subscribed_markets > 100` → hard error (v1 limit) |

---

## 13. Frontend Architecture

### 13.1 Stack

| Concern | Library | Rationale |
|---|---|---|
| Package manager | **pnpm** | Strict, fast, correct hoisting; the only permitted package manager for `frontend/` |
| Build | Vite 5 + React 18 + TypeScript | Fast HMR, native ESM, minimal configuration |
| Server state | **TanStack Query v5** | Caching, background refetch, stale-while-revalidate for all REST data |
| Client state | **Zustand** | Auth token, kill-switch banner, active filters — thin slice only |
| Routing | **TanStack Router** | File-based, fully type-safe route params and search params |
| Charts | **Recharts** | Composable, well-maintained, sufficient for confidence time-series |
| UI primitives | **shadcn/ui** | Headless Radix primitives; imports only what is used |
| API client | **openapi-fetch** | Type-safe fetch client generated from `openapi.yaml`; zero hand-written API calls |
| WS types | Generated from `openapi.yaml` | `WsMessage` is a TypeScript discriminated union; all variants compiler-enforced |

### 13.2 TanStack Query vs Redux

These solve different problems. Redux is a general-purpose client state container. TanStack Query is specifically designed for *server state* — data that lives on the server, is fetched asynchronously, and needs caching, background refetch, and cache invalidation.

For this dashboard, approximately 90% of state is server state: markets, confidence scores, orders, positions, user config. TanStack Query handles all of this with automatic caching and stale-while-revalidate — code that would be hundreds of lines of Redux reducer/thunk/selector boilerplate becomes a single `useQuery` call.

The remaining ~10% is genuine client state: is the user logged in, which markets are filtered in the grid, is the kill-switch banner visible. Zustand handles this in roughly 50 lines total.

WebSocket events invalidate TanStack Query cache entries via `queryClient.setQueryData()` — the WS connection is the push-update mechanism; TanStack Query is the cache layer. Redux would require replicating this integration manually.

### 13.3 Page Map

```
/login            — Unauthenticated only; redirects to /dashboard if already logged in
/dashboard        — Primary monitoring view (default post-login)
/markets          — Browse and subscribe to Kalshi markets
/markets/:id      — Single market: confidence history, signal feed, order history
/orders           — Full order history with filter controls
/settings         — Risk profile, auto-trading toggle, subscription management
/admin            — Admin panel (role-gated: admin role required)
```

### 13.4 Component Tree

```
App
├── AuthProvider          — Zustand auth store; JWT refresh scheduling
├── WsProvider            — Singleton WebSocket; reconnect logic; batched event dispatch
│
├── DashboardPage
│   ├── MarketConfidenceGrid    — up to 100 cells; color-coded [-1, 1] gauge per market
│   ├── LiveSignalFeed          — windowed event log (circular buffer; see §13.6)
│   ├── RecentOrdersList        — last 10 orders via TanStack Query
│   └── KillSwitchBanner        — conditionally rendered from Zustand kill-switch state
│
├── MarketDetailPage
│   ├── ConfidenceChart         — Recharts time-series; windowed data (see §13.6)
│   ├── ContributingSignalList  — raw signals driving current score
│   ├── OrderHistoryTable       — market-scoped; TanStack Query
│   └── SubscriptionConfigPanel — keyword tags editor
│
├── SettingsPage
│   ├── RiskProfileForm
│   └── AutoTradingToggle       — two-step confirmation modal (see §13.5)
│
└── AdminPage  (role-gated)
    ├── UserTable               — full CRUD
    ├── SystemStatusPanel       — goroutine counts, queue depths, model version
    ├── ModelReloadPanel        — POST /admin/reload-model
    └── KillSwitchControl       — POST /admin/kill-switch
```

### 13.5 AutoTrading Confirmation Modal

The `AutoTradingToggle` component does not allow a single interaction to enable live trading. Toggling it open triggers a modal that requires the user to type the exact phrase `"I understand this will submit real orders"` before the confirm button becomes enabled. The toggle is a read-only indicator of current state; the modal is the only code path to enabling it. This is enforced in the component, not by convention.

### 13.6 Frontend Memory Management

Without explicit management, a long-running dashboard tab will grow its JavaScript heap unboundedly as WebSocket messages accumulate. Three strategies are applied together:

**Fixed-size circular buffers.** No unbounded array is stored in React state. Every real-time series is capped:

```typescript
const MAX_CONFIDENCE_POINTS = 500;   // per market (~8 hours at 1 update/min)
const MAX_SIGNAL_FEED_EVENTS = 200;  // global live feed
const MAX_ORDER_EVENTS       = 100;  // live order updates

// Pattern applied on every WS push to a time-series:
setHistory(prev => {
    const next = [...prev, newPoint];
    return next.length > MAX_CONFIDENCE_POINTS
        ? next.slice(next.length - MAX_CONFIDENCE_POINTS)
        : next;
});
```

**Batched React state updates on a 200ms timer.** At peak volume (~1 article/sec), calling `setState` per WS message would trigger a React render per message. Instead, incoming events are buffered in a `useRef` (no render on append) and flushed to state in a single `setState` call every 200ms via `setInterval`. React renders are capped at 5/sec regardless of WS message rate.

```typescript
// In WsProvider:
const pending = useRef<WsMessage[]>([]);

useEffect(() => {
    const id = setInterval(() => {
        if (pending.current.length === 0) return;
        dispatchBatch(pending.current.splice(0));  // single setState
    }, 200);
    return () => clearInterval(id);
}, []);

ws.onmessage = (e) => {
    pending.current.push(JSON.parse(e.data) as WsMessage);  // no setState
};
```

**Page Visibility API — pause updates when the tab is hidden.** The browser throttles `setInterval` for hidden tabs, but the WS connection continues delivering messages. The `pending` ref grows uncontrolled and then flushes as a large spike on tab restore. When `document.hidden` becomes `true`, flushing is suspended. On restore, `queryClient.invalidateQueries()` re-fetches REST state that may have gone stale.

---

## 14. Component Interfaces (Go Headers)

```go
// ─── News Ingestion ───────────────────────────────────────────────────────────

// NewsPoller fetches articles from a single source.
// Each implementation is driven by exactly one goroutine.
type NewsPoller interface {
    // Poll returns all articles published after sinceTime.
    // The caller enforces RateLimit(); the implementation does not.
    Poll(ctx context.Context, sinceTime time.Time) ([]RawNewsItem, error)
    Source() NewsSource
    RateLimit() time.Duration
}

// Deduplicator gates articles before they enter the worker pool.
type Deduplicator interface {
    IsDuplicate(ctx context.Context, item RawNewsItem) (bool, error)
    MarkSeen(ctx context.Context, item RawNewsItem) error
}

// ─── Feature Extraction ───────────────────────────────────────────────────────

// TextPreparer performs the minimal Go-side text preparation before sidecar dispatch:
// Unicode NFKC normalisation, HTML entity decoding, and title+body concatenation.
// All tokenisation is handled by the sidecar.
type TextPreparer interface {
    Prepare(item RawNewsItem) (text string, err error)
}

// RelevanceFilter checks whether an article is relevant to any subscribed market.
type RelevanceFilter interface {
    MatchingMarkets(ctx context.Context, item RawNewsItem, marketIDs []MarketID) ([]MarketID, error)
}

// ─── ML Strategy ──────────────────────────────────────────────────────────────

// MLModel abstracts the FastAPI sidecar. The sole implementation is SidecarMLModel.
// Infer accepts the prepared article text; all tokenisation occurs inside the sidecar.
type MLModel interface {
    // Infer is safe for concurrent use from multiple goroutines.
    Infer(ctx context.Context, text string) (ModelOutput, error)

    // Reload triggers a model hot-swap on the sidecar.
    // Must not interrupt in-flight Infer calls.
    Reload(ctx context.Context, modelPath string) error

    Metadata() ModelMetadata
    HealthCheck(ctx context.Context) error
}

// ─── Confidence State ─────────────────────────────────────────────────────────

type ConfidenceStore interface {
    // AddSignal atomically appends a signal weight and updates the stored score.
    // The update is performed via a Redis Lua script to prevent race conditions.
    AddSignal(ctx context.Context, marketID MarketID, signal SignalWeight) error

    // GetScore returns the lazily decayed confidence score for a market.
    GetScore(ctx context.Context, marketID MarketID) (float32, error)

    // GetSignals returns the raw signal list for audit and UI display.
    GetSignals(ctx context.Context, marketID MarketID) ([]SignalWeight, error)

    InitMarket(ctx context.Context, marketID MarketID) error
    RemoveMarket(ctx context.Context, marketID MarketID) error
}

// ThresholdMonitor watches a market's confidence score and emits StrategyOutputs
// when thresholds are crossed.
type ThresholdMonitor interface {
    // Watch starts monitoring. Emits to the returned channel when a threshold fires.
    // Closing ctx stops the monitor and closes the channel.
    Watch(ctx context.Context, marketID MarketID, profile UserConfig) (<-chan StrategyOutput, error)
}

// ─── Execution ────────────────────────────────────────────────────────────────

// ExecutionBroker is the sole boundary between the strategy engine and real money.
// All order-submission logic must go through an implementation of this interface.
type ExecutionBroker interface {
    SubmitOrder(ctx context.Context, req OrderRequest) (Order, error)
    CancelOrder(ctx context.Context, orderID uuid.UUID) error
    GetPosition(ctx context.Context, marketID MarketID) (Position, error)
    ListPositions(ctx context.Context) ([]Position, error)
    IsSimulated() bool
}

// RiskGuard validates OrderRequests against all configured risk limits.
type RiskGuard interface {
    // Check returns a *RiskViolationError describing the violated limit, or nil.
    Check(ctx context.Context, req OrderRequest, user User) error
}

// ─── Market Provider ──────────────────────────────────────────────────────────

type MarketProvider interface {
    GetMarket(ctx context.Context, id MarketID) (Market, error)
    SearchMarkets(ctx context.Context, query string, limit int) ([]Market, error)
    StreamEvents(ctx context.Context, marketIDs []MarketID) (<-chan MarketEvent, error)
}

// ─── Repositories ─────────────────────────────────────────────────────────────

type OrderRepository interface {
    Insert(ctx context.Context, order Order) error
    UpdateStatus(ctx context.Context, orderID uuid.UUID, status OrderStatus, at time.Time) error
    ListByUser(ctx context.Context, userID uuid.UUID, filter OrderFilter) ([]Order, error)
    GetByID(ctx context.Context, orderID uuid.UUID) (Order, error)
}

type UserRepository interface {
    Create(ctx context.Context, user User) error
    GetByID(ctx context.Context, userID uuid.UUID) (User, error)
    GetByEmail(ctx context.Context, email string) (User, error)
    UpdateConfig(ctx context.Context, userID uuid.UUID, config UserConfig) error
    ListAll(ctx context.Context) ([]User, error)
}

type SignalRepository interface {
    InsertBatch(ctx context.Context, events []SignalEvent) error
    ListByMarket(ctx context.Context, marketID MarketID, since time.Time, limit int) ([]SignalEvent, error)
}

type NewsRepository interface {
    InsertBatch(ctx context.Context, items []NewsEvent) error
}

// ─── Internal Event Bus ───────────────────────────────────────────────────────

// EventBus connects pipeline stages to the WebSocket broadcaster.
type EventBus interface {
    Publish(event SystemEvent) error
    // Subscribe returns a receive channel and an unsubscribe function.
    Subscribe(eventType SystemEventType) (<-chan SystemEvent, func())
}

// ─── Configuration ────────────────────────────────────────────────────────────

// ConfigLoader parses and validates the TOML file at the hardcoded path.
// Load returns a hard error on any validation failure; callers must treat it as fatal.
type ConfigLoader interface {
    Load() (Config, error)
}
```

---

## 15. Data Structures

```go
// ─── Type Aliases (named for clarity and type safety) ────────────────────────

type MarketID        string
type NewsSource      string
type OrderStatus     string
type UserRole        string
type Decision        string
type SystemEventType string

const (
    SourceReutersRSS NewsSource = "reuters_rss"
    SourceAPRSS      NewsSource = "ap_rss"
    SourceGoogleNews NewsSource = "google_news"
    SourcePolygon    NewsSource = "polygon"
)

const (
    OrderStatusPending   OrderStatus = "pending"
    OrderStatusSubmitted OrderStatus = "submitted"
    OrderStatusFilled    OrderStatus = "filled"
    OrderStatusCancelled OrderStatus = "cancelled"
    OrderStatusFailed    OrderStatus = "failed"
)

const (
    RoleAdmin  UserRole = "admin"
    RoleTrader UserRole = "trader"
    RoleViewer UserRole = "viewer"
)

const (
    DecisionBuy     Decision = "BUY"
    DecisionSell    Decision = "SELL"
    DecisionNoTrade Decision = "NO_TRADE"
)

// ─── News ─────────────────────────────────────────────────────────────────────

type RawNewsItem struct {
    ID           uuid.UUID  `json:"id"`
    Source       NewsSource `json:"source"`
    Title        string     `json:"title"`
    Body         string     `json:"body"`
    URL          string     `json:"url"`
    URLHash      [32]byte   `json:"-"`  // internal dedup only; never serialized
    TitleSimHash uint64     `json:"-"`  // internal dedup only; never serialized
    PublishedAt  time.Time  `json:"publishedAt"`
    FetchedAt    time.Time  `json:"fetchedAt"`
}

// PreparedText is the output of TextPreparer: Unicode-normalised, HTML-decoded,
// title and body concatenated. This string is sent directly to the sidecar /infer
// endpoint. No vocabulary lookup or vectorisation is performed in Go.
type PreparedText struct {
    Text        string    `json:"text"`
    NewsEventID uuid.UUID `json:"newsEventId"`
}

// ─── ML ───────────────────────────────────────────────────────────────────────

type ModelOutput struct {
    BullishProb  float32 `json:"bullishProb"`
    BearishProb  float32 `json:"bearishProb"`
    NeutralProb  float32 `json:"neutralProb"`
    NetSignal    float32 `json:"netSignal"`    // BullishProb - BearishProb ∈ [-1.0, 1.0]
    ModelVersion string  `json:"modelVersion"`
}

type ModelMetadata struct {
    Version            string    `json:"version"`
    BaseModel          string    `json:"baseModel"`          // e.g. "ProsusAI/finbert"
    TrainedAt          time.Time `json:"trainedAt"`
    InputShape         []int64   `json:"inputShape"`
    OutputShape        []int64   `json:"outputShape"`
    DatasetFingerprint string    `json:"datasetFingerprint"`
}

// ─── Signals & Confidence ─────────────────────────────────────────────────────

type SignalWeight struct {
    ID          uuid.UUID  `json:"id"`
    NewsEventID uuid.UUID  `json:"newsEventId"`
    MarketID    MarketID   `json:"marketId"`
    Weight      float32    `json:"weight"`     // relevance [0.0, 1.0]
    NetSignal   float32    `json:"netSignal"`  // [-1.0, 1.0]
    Source      NewsSource `json:"source"`
    CreatedAt   time.Time  `json:"createdAt"`
}

type MarketConfidence struct {
    MarketID    MarketID  `json:"marketId"`
    Score       float32   `json:"score"`       // current lazily-decayed score [-1.0, 1.0]
    SignalCount int       `json:"signalCount"`
    LastUpdated time.Time `json:"lastUpdated"`
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

type StrategyOutput struct {
    MarketID         MarketID    `json:"marketId"`
    Decision         Decision    `json:"decision"`
    Confidence       float32     `json:"confidence"`
    TriggeringSignal SignalWeight `json:"triggeringSignal"`
    GeneratedAt      time.Time   `json:"generatedAt"`
}

// ─── Execution ────────────────────────────────────────────────────────────────

type OrderRequest struct {
    UserID     uuid.UUID      `json:"userId"`
    MarketID   MarketID       `json:"marketId"`
    Side       string         `json:"side"`        // "yes" | "no" (Kalshi convention)
    Size       float64        `json:"size"`        // number of contracts
    LimitPrice float64        `json:"limitPrice"`  // cents [0.01, 0.99]
    Source     StrategyOutput `json:"source"`
}

type Order struct {
    ID            uuid.UUID      `json:"id"`
    UserID        uuid.UUID      `json:"userId"`
    MarketID      MarketID       `json:"marketId"`
    Side          string         `json:"side"`
    Size          float64        `json:"size"`
    LimitPrice    float64        `json:"limitPrice"`
    Status        OrderStatus    `json:"status"`
    Simulated     bool           `json:"simulated"`
    BrokerOrderID *string        `json:"brokerOrderId,omitempty"`
    FailureReason *string        `json:"failureReason,omitempty"`
    Source        StrategyOutput `json:"source"`
    CreatedAt     time.Time      `json:"createdAt"`
    SubmittedAt   *time.Time     `json:"submittedAt,omitempty"`
    FilledAt      *time.Time     `json:"filledAt,omitempty"`
    CancelledAt   *time.Time     `json:"cancelledAt,omitempty"`
}

type Position struct {
    MarketID     MarketID  `json:"marketId"`
    Side         string    `json:"side"`
    Contracts    float64   `json:"contracts"`
    AvgPrice     float64   `json:"avgPrice"`
    CurrentValue float64   `json:"currentValue"`
    PnL          float64   `json:"pnl"`
    OpenedAt     time.Time `json:"openedAt"`
}

// ─── Market ───────────────────────────────────────────────────────────────────

type Market struct {
    ID          MarketID  `json:"id"`
    Title       string    `json:"title"`
    Description string    `json:"description"`
    Category    string    `json:"category"`
    CloseTime   time.Time `json:"closeTime"`
    Status      string    `json:"status"`    // "open" | "closed" | "resolved"
    YesPrice    float64   `json:"yesPrice"`
    NoPrice     float64   `json:"noPrice"`
    Volume      float64   `json:"volume"`
    LastUpdated time.Time `json:"lastUpdated"`
}

type MarketEvent struct {
    MarketID  MarketID  `json:"marketId"`
    YesPrice  float64   `json:"yesPrice"`
    NoPrice   float64   `json:"noPrice"`
    Volume    float64   `json:"volume"`
    Timestamp time.Time `json:"timestamp"`
}

// ─── Users & Config ───────────────────────────────────────────────────────────

type User struct {
    ID           uuid.UUID  `json:"id"`
    Email        string     `json:"email"`
    PasswordHash string     `json:"-"`  // bcrypt cost 12; never serialized
    Role         UserRole   `json:"role"`
    Config       UserConfig `json:"config"`
    CreatedAt    time.Time  `json:"createdAt"`
    UpdatedAt    time.Time  `json:"updatedAt"`
}

type UserConfig struct {
    // AutoTradingEnabled requires both this field AND SystemConfig.AutoTradingSystemEnabled
    // to be true. Neither flag alone is sufficient to submit real orders.
    AutoTradingEnabled      bool    `json:"autoTradingEnabled"`
    MaxRiskPerTrade         float64 `json:"maxRiskPerTrade"`         // [0.001, 0.10]
    MaxDailyLoss            float64 `json:"maxDailyLoss"`            // [0.01, 0.50]
    MaxOpenPositions        int     `json:"maxOpenPositions"`        // [1, 20]
    BuyThreshold            float32 `json:"buyThreshold"`            // default 0.65
    SellThreshold           float32 `json:"sellThreshold"`           // default 0.65
    SignalDecayHalfLifeSecs int     `json:"signalDecayHalfLifeSecs"` // default 3600
}

type MarketSubscription struct {
    UserID      uuid.UUID `json:"userId"`
    MarketID    MarketID  `json:"marketId"`
    KeywordTags []string  `json:"keywordTags"`
    CreatedAt   time.Time `json:"createdAt"`
}

type SystemConfig struct {
    // AutoTradingSystemEnabled is the admin-level gate.
    // Must be true AND UserConfig.AutoTradingEnabled must be true for real orders.
    AutoTradingSystemEnabled bool      `json:"autoTradingSystemEnabled"`
    KillSwitchActive         bool      `json:"killSwitchActive"`
    MaxGlobalOpenPositions   int       `json:"maxGlobalOpenPositions"`
    ModelVersion             string    `json:"modelVersion"`
    UpdatedAt                time.Time `json:"updatedAt"`
}

// ─── Internal Bus ─────────────────────────────────────────────────────────────

type SystemEvent struct {
    Type    SystemEventType `json:"type"`
    Payload interface{}     `json:"payload"`
}

// WsMessage is the wire format for all WebSocket messages.
// The frontend decodes this as the generated TypeScript discriminated union WsMessage.
type WsMessage struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
    Ts      time.Time       `json:"ts"`
}

// ─── Errors ───────────────────────────────────────────────────────────────────

// RiskViolationError is returned by RiskGuard.Check when an order is blocked.
// It is structured so the caller can log the specific violation without string parsing.
type RiskViolationError struct {
    Violation string  // e.g. "max_risk_per_trade", "daily_loss_limit", "kill_switch"
    Limit     float64
    Actual    float64
}

func (e *RiskViolationError) Error() string {
    return fmt.Sprintf("risk violation [%s]: limit=%.4f actual=%.4f",
        e.Violation, e.Limit, e.Actual)
}

// OrderFilter is the query filter passed to OrderRepository.ListByUser.
type OrderFilter struct {
    MarketID  *MarketID
    Status    *OrderStatus
    Simulated *bool
    Since     *time.Time
    Limit     int
    Offset    int
}
```

---

## 16. Deployment & Container Layout

### 16.1 Docker Compose Services

```yaml
services:
  engine:       # Go binary: news ingestion + strategy + execution
  api:          # Go binary: HTTP/WS API server + static frontend serving
  ml-sidecar:   # Python FastAPI: FinBERT ONNX inference + dynamic batching
  redis:        # redis:7-alpine
  postgres:     # timescale/timescaledb:latest-pg16
  migrate:      # golang-migrate one-shot; runs migrations, exits 0
```

All services share a single named Docker network. The config file is bind-mounted into every service at `/opt/temporal/config/temporal_config.toml`. Secrets are bind-mounted into `/opt/temporal/secrets/` (gitignored on the host). Model artifacts (`.onnx`, `.meta.toml`, `tokenizer/`) are bind-mounted into `/opt/temporal/models/`.

### 16.2 Directory Structure

```
temporal-ai/
├── openapi.yaml                     ← single source of truth for all API contracts
│
├── cmd/
│   ├── engine/
│   │   └── main.go                  # ingestion + strategy + execution binary
│   └── api/
│       └── main.go                  # HTTP/WS API server binary
│
├── internal/
│   ├── news/                        # pollers, dedup, fan-in merger
│   ├── features/                    # text preparation (Unicode normalisation only)
│   ├── model/                       # MLModel interface + SidecarMLModel implementation
│   ├── confidence/                  # ConfidenceStore (Redis), ThresholdMonitor
│   ├── execution/                   # ExecutionBroker interface, Kalshi client, RiskGuard
│   ├── repository/                  # Postgres repositories (orders, users, signals, news)
│   ├── eventbus/                    # internal pub/sub
│   ├── auth/                        # JWT, bcrypt, Chi middleware
│   └── config/                      # TOML loader, Config struct, startup validation
│
├── api/
│   ├── generated.go                 ← DO NOT EDIT — generated by oapi-codegen
│   └── handler/                     # Chi route handler implementations
│
├── ml/
│   ├── sidecar/
│   │   ├── main.py                  # FastAPI app entrypoint
│   │   ├── model.py                 # FinBERT ONNX session management + hot reload
│   │   ├── batching.py              # dynamic batching logic
│   │   └── pyproject.toml           # uv-managed dependencies
│   └── training/
│       ├── train.py                 # FinBERT fine-tuning pipeline
│       ├── export.py                # ONNX + metadata export + verification
│       └── pyproject.toml           # uv-managed dependencies
│
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── api.types.ts         ← DO NOT EDIT — generated by openapi-typescript
│   │   │   └── api.client.ts        ← DO NOT EDIT — generated by openapi-fetch
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   │   ├── useWs.ts             # singleton WS + batched dispatch
│   │   │   ├── useCircularBuffer.ts # fixed-size series state hook
│   │   │   └── useConfidence.ts     # market confidence queries + WS invalidation
│   │   └── stores/
│   │       ├── authStore.ts         # Zustand: JWT + login state
│   │       └── uiStore.ts           # Zustand: kill-switch banner, active filters
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── migrations/                      # golang-migrate SQL files (sequential numbered)
│
├── models/                          # .onnx, finbert_vN/tokenizer/, .meta.toml artifacts
│                                    # large files tracked via Git LFS
│
├── config/
│   └── temporal_config.example.toml # committed example with placeholder values
│
├── secrets/                         # gitignored; bind-mounted into containers
│
├── docker-compose.yml
└── docker-compose.dev.yml
```

### 16.3 Common Commands

**Go — build:**
```sh
go build ./cmd/engine
go build ./cmd/api
```

**Go — test:**
```sh
go test ./...
go test -tags integration ./...          # integration tests (requires Docker services)
go test -cover -coverprofile=cover.out ./...
go tool cover -html=cover.out            # view coverage report
```

**Go — vet and lint:**
```sh
go vet ./...
golangci-lint run ./...
```

**TypeScript — type-check:**
```sh
cd frontend && pnpm tsc --noEmit
```

**TypeScript — lint and format:**
```sh
cd frontend && pnpm eslint src/
cd frontend && pnpm prettier --check src/
```

**Code generation (run after editing openapi.yaml):**
```sh
# Go types — run from backend/ so the module and relative output path resolve correctly
cd backend && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest \
    -config ../oapi-codegen.yaml ../openapi.yaml

# TypeScript types — run from repo root
pnpm dlx openapi-typescript openapi.yaml -o frontend/src/lib/api.types.ts
```

**Database migrations:**
```sh
migrate -path migrations -database "postgres://..." up
migrate -path migrations -database "postgres://..." down 1
```

**ML sidecar:**
```sh
cd ml/sidecar && uv sync
cd ml/sidecar && uv run uvicorn main:app --host 0.0.0.0 --port 8001
```

**ML sidecar — lint and format:**
```sh
cd ml/sidecar && uv run ruff check .
cd ml/sidecar && uv run ruff format .
cd ml/sidecar && uv run mypy .
```

**ML training:**
```sh
cd ml/training && uv sync
cd ml/training && uv run python train.py \
    --data /opt/temporal/data/news_labelled.csv \
    --output-dir /opt/temporal/models \
    --version 2 \
    --epochs 4

cd ml/training && uv run python export.py \
    --model-dir /opt/temporal/models/finbert_v2 \
    --output-dir /opt/temporal/models \
    --version 2
```

---

## 17. Open Questions / Future Work

These items are explicitly out of scope for v1. The architecture is designed not to block any of them.

| Item | Extension point |
|---|---|
| Polymarket support | New `ExecutionBroker` implementation; nothing else changes |
| Correlated market clustering | New pipeline stage between `ThresholdMonitor` and execution; `ConfidenceStore` unchanged |
| Quantized FinBERT (INT8) | Swap ONNX artifact in sidecar; reduces CPU inference latency to ~8–15ms; same `/infer` contract |
| GPU inference | Add `CUDAExecutionProvider` to `ort.InferenceSession` providers list in `model.py`; no other changes |
| DistilBERT / larger transformer | Swap `SidecarMLModel` target; same `/infer` contract; tokenizer path changes |
| Social signal cross-referencing (X/Twitter) | New `NewsPoller` implementation |
| Backtesting engine | Reads `signal_events` + `orders` tables; no pipeline changes |
| GDELT integration | New `NewsPoller` implementation; higher `Deduplicator` load expected |
| Reinforcement learning strategy | New sidecar with stateful inference; `MLModel` interface may require extension |
| Multi-user capital isolation | `RiskGuard` + `UserConfig` already model per-user limits; full isolation is an execution-layer concern |