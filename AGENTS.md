# AGENTS.md

This file is the authoritative guide for any AI agent or automated tool working in this repository. Read it in full before taking any action. The rules here are not suggestions.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Layout](#2-repository-layout)
3. [Non-Negotiable Rules](#3-non-negotiable-rules)
4. [Architecture Constraints](#4-architecture-constraints)
5. [Go Coding Standards](#5-go-coding-standards)
6. [Python Coding Standards (ML Sidecar)](#6-python-coding-standards-ml-sidecar)
7. [TypeScript / React Coding Standards](#7-typescript--react-coding-standards)
8. [Testing Requirements](#8-testing-requirements)
9. [Database & Migration Rules](#9-database--migration-rules)
10. [Configuration Rules](#10-configuration-rules)
11. [Security Rules](#11-security-rules)
12. [Generated Files](#12-generated-files)
13. [Commit & PR Standards](#13-commit--pr-standards)
14. [What Agents Must Never Do](#14-what-agents-must-never-do)

---

## 1. Project Overview

Temporal AI is an automated prediction market trading system. It ingests news from RSS and REST sources, prepares article text, runs ML inference via a FastAPI sidecar, maintains rolling per-market confidence scores, and submits orders to Kalshi when confidence crosses configured thresholds.

The full architecture is documented in `ARCHITECTURE_PLAN.md`. Read it. This file (AGENTS.md) governs *how* to work in the codebase. The architecture document governs *what* the system does and why.

**Language stack:**
- Go 1.22+ — core engine and API server (`cmd/engine`, `cmd/api`, `internal/`)
- Python 3.14 (free-threaded) — ML sidecar only (`nlp_sidecar/`, `ml/training/`)
- TypeScript + React 18 + Vite — frontend (`frontend/`)

---

## 2. Repository Layout

```
temporal-ai/
├── openapi.yaml              ← source of truth for all API contracts
├── ARCHITECTURE_PLAN.md      ← authoritative system design document
├── AGENTS.md                 ← this file
├── CLAUDE.md                 ← points to this file
├── cmd/engine/main.go
├── cmd/api/main.go
├── internal/                 ← all shared Go packages
├── api/generated.go          ← DO NOT EDIT (generated)
├── api/handler/              ← Chi route handler implementations
├── nlp_sidecar/              ← FastAPI inference server
├── ml/training/              ← offline training pipeline
├── frontend/src/
│   ├── lib/api.types.ts      ← DO NOT EDIT (generated)
│   ├── lib/api.client.ts     ← DO NOT EDIT (generated)
│   ├── pages/
│   ├── components/
│   ├── hooks/
│   └── stores/
├── migrations/               ← golang-migrate SQL files
├── models/                   ← .onnx, finbert_vN/tokenizer/, .meta.toml artifacts
├── config/
│   └── temporal_config.example.toml
└── secrets/                  ← gitignored
```

**Before writing any code**, verify that the file you are modifying belongs to the correct layer. Business logic does not go in handlers. Database queries do not go in business logic. Transport types do not go in domain types.

---

## 3. Non-Negotiable Rules

These rules have no exceptions. If a task cannot be completed without violating one of them, stop and report the conflict rather than proceeding.

### 3.1 No Environment Variables
There are zero environment variables in this system. Configuration is read exclusively from `/opt/temporal/config/temporal_config.toml`. This path is hardcoded. Do not add `os.Getenv`, `os.LookupEnv`, `viper`, `godotenv`, or any equivalent. Do not add `.env` files. Do not add environment variable documentation.

### 3.2 No Hand-Written Cross-Boundary Types
Any type that crosses a service boundary (HTTP request/response, WebSocket message payload) must be defined in `openapi.yaml` and regenerated via the generation commands in Section 12. Do not write these types by hand in Go or TypeScript.

### 3.3 No Direct Order Submission Outside ExecutionBroker
Order submission logic must only exist inside an implementation of the `ExecutionBroker` interface. No other code in the system may call a broker API directly.

### 3.4 No In-Process ML Inference
All ML inference goes through the FastAPI sidecar. Do not add ONNX, CGo ML bindings, or any inference library to the Go binary. The `SidecarMLModel` struct in `internal/model/` is the only implementation of `MLModel`.

### 3.5 No fsync=off
Do not set `fsync=off` in Postgres configuration, migration scripts, or connection options. This is never acceptable. `synchronous_commit=off` is acceptable only on `signal_events` and `news_events` tables.

### 3.6 Financial Records Are Always Fully Durable
The `orders` table always uses `synchronous_commit=ON`. Do not add any `SET LOCAL synchronous_commit` or connection-level durability downgrades to code paths that write to `orders`.

### 3.7 AutoTrading Requires Both Flags
Before any real (non-simulated) order is submitted, code must verify that BOTH `user.Config.AutoTradingEnabled` AND `systemConfig.AutoTradingSystemEnabled` are `true`. Do not simplify this to a single flag check.

---

## 4. Architecture Constraints

### 4.1 The ML Sidecar Has a Hard Responsibility Boundary
`nlp_sidecar/` knows about text, tokenisation, and probability arrays. It must not import or reference anything about markets, orders, users, confidence scores, or trading logic. If you find yourself adding market-aware logic to the sidecar, you are in the wrong place.

### 4.2 Tokenisation Is a Sidecar Concern, Not a Go Concern
The Go engine sends raw Unicode-normalised text to the sidecar. All tokenisation (WordPiece segmentation, padding, truncation, attention masks) happens inside `nlp_sidecar/model.py` using the HuggingFace `AutoTokenizer`. Do not add a tokeniser, vocabulary file lookup, or any subword processing to Go code. The `TFIDFVectorizer` interface and `.vocab.toml` artifacts have been removed and must not be re-introduced.

### 4.3 Interfaces Are the Extension Points
Every external dependency is behind a Go interface. When adding a new broker, news source, or storage backend, create a new struct that satisfies the existing interface. Do not modify the interface unless the required functionality cannot be expressed through it — in that case, open a discussion in the PR rather than silently extending it.

### 4.4 Worker Pool, Not Per-Event Goroutines
Do not spawn goroutines per news article. All article processing goes through the bounded worker pool in `internal/news/`. The pool size is controlled by `[ingestion] worker_count` in the config file.

### 4.5 Lazy Confidence Decay
Confidence scores are decayed lazily on read, not on a background tick. The raw `SignalWeight` list is stored in Redis. Score recalculation happens in `ConfidenceStore.GetScore()`. Do not add a background goroutine that ticks through all markets applying decay.

### 4.6 Shutdown Order Is Fixed
The shutdown sequence in `cmd/engine/main.go` must follow the order defined in `ARCHITECTURE_PLAN.md §4.4`. Do not reorder steps. Steps 1–3 (stop ingestion, drain channel, drain workers) must complete before steps 5–9 (flush, close connections).

---

## 5. Go Coding Standards

### 5.1 Style
- `gofmt` and `goimports` are mandatory. Code that does not pass both is not mergeable.
- Follow [Effective Go](https://go.dev/doc/effective_go) and the [Google Go Style Guide](https://google.github.io/styleguide/go/).
- Use `golangci-lint` with the project's `.golangci.yml`. Fix all reported issues; do not add `//nolint` suppressions without a comment explaining why.

### 5.2 Error Handling
- Errors are never silently discarded. `_ = someFunc()` on an error-returning function is prohibited.
- Error wrapping: use `fmt.Errorf("context: %w", err)` so callers can use `errors.Is` / `errors.As`.
- Typed sentinel errors (`RiskViolationError`, etc.) are preferred over string comparison for errors that callers need to act on programmatically.
- `panic` is only acceptable in `init()` and test code. Production code handles all errors explicitly.

### 5.3 Concurrency
- Every goroutine must be reachable by a context cancellation. Goroutines that cannot be stopped are bugs.
- Channel directions must be specified in function signatures (`chan<-`, `<-chan`). Bidirectional `chan` is only used at the creation site.
- Mutexes are used only when a channel cannot solve the problem. Justify mutex usage in a comment.
- `sync.WaitGroup` is used only for waiting on a known, fixed set of goroutines. For dynamic goroutine management, use `errgroup`.

### 5.4 Interfaces
- Interfaces are defined in the **consumer** package, not the provider package (Go convention).
- Interfaces have the smallest surface area needed. Do not add methods to an interface speculatively.
- All interface implementations must include a compile-time assertion:
  ```go
  var _ ExecutionBroker = (*KalshiBroker)(nil)
  ```

### 5.5 JSON Tags
- Every struct field that may be serialized to JSON carries an explicit `json:` tag.
- JSON field names are camelCase. Go field names are PascalCase. No exceptions.
- Fields that must never be serialized are tagged `json:"-"`. The `PasswordHash` field on `User` is the canonical example.
- Optional fields use pointer types with `omitempty`.

### 5.6 Context
- Every function that performs I/O (network, database, Redis) accepts `ctx context.Context` as its first parameter.
- Do not store contexts in structs. Pass them through call chains.
- Do not use `context.Background()` inside business logic. Only `cmd/` entrypoints and test setup create root contexts.

### 5.7 Logging
- Use structured logging (`log/slog`, standard library). No `fmt.Println` in production code.
- Log at the correct level: `Debug` for pipeline internals, `Info` for significant state changes, `Warn` for recoverable errors, `Error` for failures requiring attention.
- Every log entry that relates to a market or order must include `market_id` or `order_id` as a structured field, not interpolated into a string.

### 5.8 Testing
See Section 8 for testing requirements. Test files live alongside the code they test (`foo_test.go` next to `foo.go`). Integration tests that require Redis or Postgres live in `internal/<package>/integration_test.go` and are gated by a `//go:build integration` tag.

---

## 6. Python Coding Standards (ML Sidecar)

The sidecar is a narrow, purpose-built inference server. Keep it that way.

### 6.1 Style
- Python 3.14+ (free-threaded). Managed exclusively with `uv`. Do not use `pip`, `pip-tools`, `poetry`, or `conda` anywhere in the sidecar or training directories.
- `uv run ruff check` (linting) and `uv run ruff format` (formatting) are mandatory. `black` is not used — `ruff format` is the canonical formatter. All code must pass both before merge.
- Type annotations are mandatory on all function signatures. Use `from __future__ import annotations` at the top of every file.
- `mypy --strict` must pass. Invoke as `uv run mypy`. Do not use `# type: ignore` without a comment.

### 6.2 Structure
The sidecar (`nlp_sidecar/`) consists of exactly three modules:
- `main.py` — FastAPI app, endpoint definitions, startup/shutdown lifecycle
- `model.py` — FinBERT ONNX session lifecycle, HuggingFace tokenizer management, hot-reload logic
- `batching.py` — dynamic batch collection and dispatch

The training pipeline consists of exactly two scripts:
- `ml/training/train.py` — fine-tunes `ProsusAI/finbert` on a labelled CSV; saves PyTorch weights and tokenizer
- `ml/training/export.py` — exports fine-tuned weights to ONNX; writes `.meta.toml`; runs verification pass

Do not add modules or expand responsibilities without updating `ARCHITECTURE_PLAN.md`.

### 6.3 Model Artifacts
The sidecar loads two categories of artifact at startup:

| Artifact | Path pattern | Purpose |
|---|---|---|
| ONNX model | `finbert_vN.onnx` | Runtime inference via `onnxruntime` |
| Tokenizer directory | `finbert_vN/tokenizer/` | HuggingFace `AutoTokenizer`; loaded once, never reloaded |
| Metadata TOML | `finbert_vN.meta.toml` | Version, base model, training metrics |

A version mismatch between `finbert_vN.onnx` and `finbert_vN.meta.toml` is a **hard startup error**. The tokenizer is not reloaded during a hot-swap — it is shared across FinBERT versions. Do not add `.vocab.toml` or any TF-IDF vocabulary file — these were part of the removed LightGBM pipeline and must not be re-introduced.

### 6.4 Error Handling
- Inference errors are returned as HTTP 500 with a structured JSON body: `{ "error": "<message>", "request_id": "<uuid>" }`.
- A failed batch does not crash the server. Errors are returned per-request within the batch by resolving each future with the exception.
- Startup validation failures (model/metadata version mismatch, ONNX session load failure, missing tokenizer directory) must exit with a non-zero code and a clear stderr message.

### 6.5 Concurrency
- The sidecar is async throughout. Do not mix sync and async code in the hot path.
- ONNX `InferenceSession.run()` is synchronous and CPU-bound. It must be called via `asyncio.get_event_loop().run_in_executor()` to avoid blocking the event loop. See `model.py::run_infer_in_executor`.

---

## 7. TypeScript / React Coding Standards

### 7.1 Style
- `pnpm` is the only permitted package manager for the frontend. Do not use `npm`, `yarn`, or `npx` anywhere in the `frontend/` directory or in any script that touches it.
- `eslint` and `prettier` are mandatory. Both are invoked via `pnpm` (e.g. `pnpm eslint src/`, `pnpm prettier --check src/`). Config files are `eslint.config.js` (flat config) and `.prettierrc`.
- `pnpm tsc --noEmit` must pass with zero errors. Do not use `@ts-ignore` or `@ts-expect-error` without a comment.
- No `any`. Use `unknown` and narrow it.

### 7.2 Generated Files
`frontend/src/lib/api.types.ts` and `frontend/src/lib/api.client.ts` are generated. Do not edit them. If a type is wrong, fix `openapi.yaml` and re-run the generation commands from Section 12.

### 7.3 Server State vs Client State
- **TanStack Query** manages all server state. Do not put server data in Zustand stores.
- **Zustand** manages client-only state: auth token, UI visibility flags, active filters.
- Do not use `useState` for data that comes from the server.

### 7.4 WebSocket Handling
- All WebSocket logic lives in `frontend/src/hooks/useWs.ts`.
- WS events must not call `setState` directly. They are buffered in a `useRef` and flushed to state in a 200ms batched interval. See `ARCHITECTURE_PLAN.md §13.6`.
- WS events that invalidate server state call `queryClient.setQueryData()` or `queryClient.invalidateQueries()` — they do not duplicate data into a separate Zustand slice.

### 7.5 Memory Management
- No unbounded arrays are stored in React state. All real-time series use `useCircularBuffer` from `frontend/src/hooks/useCircularBuffer.ts`.
- The Page Visibility API must be respected in `useWs.ts`: when `document.hidden` is `true`, WS flush is suspended and REST queries are invalidated on restore.

### 7.6 AutoTrading Toggle
The `AutoTradingToggle` component must always require a two-step confirmation. Do not simplify this interaction. The user must type the exact confirmation phrase before the confirm button is enabled. This is not a UX concern — it is a safety requirement.

### 7.7 Component Responsibilities
- Pages fetch data and compose components. They do not contain business logic.
- Components render and handle local UI interaction. They do not fetch data directly (use hooks).
- Hooks encapsulate data-fetching and side effects. They do not render anything.

---

### 8.0 TDD Workflow (Required)

All feature and bug-fix work follows a strict test-driven development cycle:

1. **Write tests first.** Before writing any implementation code, write a comprehensive test suite that covers:
   - **Happy paths** — the expected behaviour under normal inputs
   - **Edge cases** — boundary values, empty inputs, off-by-one conditions, nil/zero values, maximum allowed values
   - **Error paths** — invalid inputs, dependency failures, context cancellation
   - **Benchmarks (Go)** — `Benchmark*` functions for any hot-path code (ingestion pipeline, confidence scoring, sidecar calls)

2. **Confirm tests fail.** Run the suite and verify every new test fails before implementation exists. A test that passes before implementation is not testing anything real.

3. **Implement to satisfy the tests.** Write the minimum implementation needed to make the full suite pass. Do not write implementation beyond what the tests require.

4. **All tests must pass before a PR is opened.** No failing tests, no skipped tests without an explicit `t.Skip` comment explaining why.

**"Within reason"** means: trivial one-liner wrappers, scaffolding commits, and pure data-structure definitions do not require a test-first cycle. When in doubt, write the test first.

---

## 8. Testing Requirements

### 8.1 Go
- All public functions in `internal/` must have unit tests.
- All interface implementations must have a mock generated via `mockery` or hand-written, stored in `internal/<package>/mocks/`.
- Unit tests must not make network calls, open database connections, or read from the filesystem (except embedded test fixtures).
- Integration tests (tagged `//go:build integration`) may use real Redis and Postgres via Docker Compose test services.
- Minimum coverage target: 80% per package. Coverage below this blocks merge.
- Test table-driven patterns with `t.Run` sub-tests for functions with multiple input conditions.

### 8.2 Python (Sidecar)
- `uv run pytest` for all tests. Tests live in `ml/sidecar/tests/`.
- The ONNX session and HuggingFace tokenizer must be mockable in unit tests — do not construct a real session or load real model weights in unit tests.
- Test the batch collector logic (`DynamicBatcher`) independently of the ONNX session.
- Test that `FinBERTModel.reload()` atomically swaps the session without raising on in-flight calls.

### 8.3 TypeScript
- `pnpm vitest` for unit tests. `@testing-library/react` for component tests.
- All custom hooks must have unit tests.
- The `WsProvider` must be testable with a mock WebSocket.
- Do not write Playwright/E2E tests unless specifically requested.

### 8.4 What Must Always Be Tested
Regardless of coverage percentage, these specific behaviors must have explicit tests:

| Behavior | Location |
|---|---|
| `RiskGuard.Check` blocks orders when kill switch is active | `internal/execution/` |
| `RiskGuard.Check` blocks orders when both auto-trading flags are not both true | `internal/execution/` |
| `ConfidenceStore.AddSignal` Lua script atomicity (concurrent writes) | `internal/confidence/` |
| Shutdown sequence drains the worker channel before closing Postgres | `cmd/engine/` |
| Config loader returns hard error on missing required key paths | `internal/config/` |
| Config loader returns hard error on model/metadata version mismatch | `internal/config/` |
| Config loader returns hard error on missing tokenizer directory | `internal/config/` |
| `DynamicBatcher` resolves all pending futures with an error when the batch processor crashes | `ml/sidecar/tests/` |
| `FinBERTModel.reload()` swaps session atomically without interrupting in-flight calls | `ml/sidecar/tests/` |
| `AutoTradingToggle` confirm button is disabled until exact phrase is typed | `frontend/src/components/` |
| WS batched flush does not trigger while `document.hidden` is true | `frontend/src/hooks/` |

---

## 9. Database & Migration Rules

### 9.1 Migration Files
- All schema changes go through `golang-migrate` SQL files in `migrations/`.
- Files are numbered sequentially: `000001_initial_schema.up.sql`, `000001_initial_schema.down.sql`.
- Every `up` migration must have a corresponding `down` migration that fully reverses it.
- Migrations are append-only. Never edit an existing migration file that has been merged to `main`.

### 9.2 Schema Change Rules
- Adding a nullable column or a column with a default value: allowed in a migration.
- Adding a NOT NULL column without a default: **requires a three-step migration** (add nullable, backfill, add constraint) to avoid locking the table.
- Dropping a column: requires a deprecation period (mark the column unused in code first, drop in a subsequent PR).
- Renaming a column: prohibited. Add a new column, migrate data, drop the old one in separate steps.

### 9.3 Durability Rules in Migrations
Do not include `SET synchronous_commit = off` or any durability-downgrade statement in migration files. Migration scripts run to completion under the default (safe) Postgres settings.

### 9.4 Hypertable Rules
`news_events` and `signal_events` are TimescaleDB hypertables. Any index added to these tables must account for the fact that hypertable indexes are applied per-chunk. Consult the TimescaleDB documentation before adding compound indexes to hypertables.

---

## 10. Configuration Rules

### 10.1 The Config Path Is Fixed
The config file path `/opt/temporal/config/temporal_config.toml` is hardcoded. Do not add a flag, argument, or any mechanism to change it at runtime.

### 10.2 The Config Struct Is the Schema
`internal/config/config.go` defines the `Config` struct. The TOML file is validated by unmarshalling into this struct at startup. Adding a new config value means:
1. Add the field to the appropriate nested struct in `Config`.
2. Add a validation rule in `Config.Validate()` if the field has constraints.
3. Add the field to `config/temporal_config.example.toml` with a descriptive comment.
4. Document the field in `ARCHITECTURE_PLAN.md §12.2`.

### 10.3 Secrets Are File Paths, Not Inline Values
Sensitive values (private keys, database passwords) are specified as file paths in the TOML (`password_path`, `private_key_path`). The config loader reads the file contents at startup. The raw secret value is never stored in the `Config` struct — only the resolved bytes are passed to the component that needs them.

### 10.4 No Default Fallbacks for Required Fields
If a required field is absent or its referenced file does not exist, the process exits with a descriptive error. Do not silently fall back to hardcoded defaults for security-sensitive fields.

---

## 11. Security Rules

### 11.1 Credentials
- API keys, private keys, and passwords are stored only in `secrets/` (gitignored) and mounted into containers. They never appear in source files, config examples (use placeholder strings), or log output.
- The Kalshi private key is loaded once at startup and held as a parsed `*rsa.PrivateKey` in memory. The file path string is not retained in application state after startup.
- `User.PasswordHash` is tagged `json:"-"`. It is never included in any API response. Any code that inadvertently returns a password hash is a critical security bug.

### 11.2 JWT
- Access tokens are RS256 signed. HS256 is not acceptable.
- Refresh tokens are stored in `httpOnly Secure SameSite=Strict` cookies only. Never in `localStorage`.
- The refresh token revocation list in Redis must be checked on every `/auth/refresh` call.

### 11.3 Input Validation
- All handler inputs are validated against the OpenAPI spec constraints before being passed to business logic. `oapi-codegen`-generated validators handle this for request bodies. URL path parameters are validated explicitly in handlers.
- User-supplied strings that appear in log output are sanitized (no control characters, bounded length) before logging to prevent log injection.

### 11.4 SQL
- All database queries use parameterized statements. String interpolation into SQL is prohibited without exception.
- Repository methods accept typed parameters. They do not accept raw SQL fragments from callers.

---

## 12. Generated Files

The following files are generated and must not be edited by hand:

| File | Generator | Regenerate with |
|---|---|---|
| `api/generated.go` | `oapi-codegen` | `cd backend && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest -config ../oapi-codegen.yaml ../openapi.yaml` |
| `frontend/src/lib/api.types.ts` | `openapi-typescript` | `pnpm dlx openapi-typescript openapi.yaml -o frontend/src/lib/api.types.ts` (run from repo root) |
| `frontend/src/lib/api.client.ts` | `openapi-fetch` | regenerated alongside `api.types.ts` (same invocation) |

If a type in a generated file appears incorrect, the fix goes in `openapi.yaml`. Do not patch the generated file.

CI re-runs the generation commands above and fails the build if the output differs from the committed files. Generated files must be regenerated and committed whenever `openapi.yaml` changes.

---

## 13. Commit & PR Standards

### 13.1 Commit Messages
Follow the Conventional Commits specification:

```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`
Scopes: `engine`, `api`, `sidecar`, `frontend`, `config`, `db`, `infra`

Examples:
```
feat(sidecar): replace LightGBM with FinBERT ONNX inference
fix(api): return 403 instead of 500 for role-insufficient admin requests
refactor(confidence): replace background decay goroutine with lazy read calculation
test(execution): add RiskGuard test for dual auto-trading flag requirement
```

### 13.2 Local CI Verification (Required Before Every Push)

All CI checks must be run and pass locally before pushing any commit to the remote. Do not push code that has not been verified locally. Pushing unverified code that breaks CI is not acceptable.

Run the full check suite for the layers you touched:

**Go (backend)**
```bash
golangci-lint run ./...
go vet ./...
go test ./...
```

**TypeScript / React (frontend)** — run from `frontend/`
```bash
pnpm tsc --noEmit
pnpm eslint src/
pnpm prettier --check src/
pnpm vitest run
```

**Python (sidecar / training)** — run from `ml/`
```bash
uv run ruff check
uv run ruff format --check
uv run mypy .
uv run pytest
```

Only push after every applicable check above exits with zero errors.

### 13.3 PR Requirements
Every PR must:
- Pass `golangci-lint run ./...` with zero warnings
- Pass `go vet ./...` with zero errors
- Pass `go test ./...` with zero failures
- Pass `pnpm tsc --noEmit` with zero errors
- Pass `pnpm eslint src/` with zero errors (run from `frontend/`)
- Pass `uv run ruff check` and `uv run ruff format --check` with zero errors (run from `ml/`)
- Pass `uv run mypy .` with zero errors (run from `ml/sidecar/` and `ml/training/`)
- Not decrease per-package coverage below 80%
- Include updated `ARCHITECTURE_PLAN.md` if any architectural decision has changed
- Regenerate and commit generated files if `openapi.yaml` changed

### 13.4 PR Size
PRs should be focused. A PR that touches the ingestion layer, the confidence model, the execution layer, and the frontend simultaneously will be rejected. Decompose large changes into sequential, reviewable units.

### 13.5 PR Creation
When opening a PR, always:
1. Assign the PR to the author (`--assignee @me`).
2. Query all repository collaborators via `gh api repos/{owner}/{repo}/collaborators`.
3. Filter out any accounts of type `Bot` (including GitHub Copilot).
4. Request a review from every remaining collaborator (`--reviewer <login>`).

---

## 14. What Agents Must Never Do

This section is a checklist. Before submitting any change, verify that none of these are true:

- [ ] Added `os.Getenv`, `os.LookupEnv`, or any environment variable read
- [ ] Added a `.env` file or reference to one
- [ ] Edited `api/generated.go`, `api.types.ts`, or `api.client.ts` by hand
- [ ] Added cross-boundary type definitions outside `openapi.yaml`
- [ ] Added order-submission logic outside an `ExecutionBroker` implementation
- [ ] Added inference logic outside `nlp_sidecar/`
- [ ] Added ONNX, CGo ML bindings, or any ML library to the Go binary
- [ ] Added a TF-IDF vectorizer, vocabulary file (`.vocab.toml`), or any tokenisation logic to Go code
- [ ] Added market/user/order awareness to the ML sidecar
- [ ] Set `fsync=off` anywhere
- [ ] Downgraded durability on the `orders` table
- [ ] Simplified the auto-trading check to a single flag
- [ ] Added an unbounded array to React state for a real-time data series
- [ ] Called `setState` directly from a WebSocket `onmessage` handler
- [ ] Stored a secret value inline in a config file, source file, or log statement
- [ ] Spawned a goroutine per news article
- [ ] Added a background goroutine that applies confidence score decay on a tick
- [ ] Modified an existing merged migration file
- [ ] Used `panic` in production (non-test, non-init) code
- [ ] Stored a context in a struct
- [ ] Used `context.Background()` in business logic (outside `cmd/` and tests)
- [ ] Silently discarded an error return value
- [ ] Used `any` in TypeScript without narrowing
- [ ] Allowed the confirmation phrase check in `AutoTradingToggle` to be bypassed
- [ ] Modified any files in the `backend/` directory when assigned a frontend-scoped task. Frontend work must strictly be confined to the `frontend/` folder.
