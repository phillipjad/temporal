# ADR-007: Contract-First Development via OpenAPI 3.1

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

The system has two consumers of its HTTP/WebSocket API: the Go engine itself (internal use) and the React frontend. Historically, type drift between server and client is a common source of runtime bugs: the server changes a field name or type, and the client silently breaks.

## Decision

All HTTP request/response shapes and WebSocket message payloads are defined in a single `openapi.yaml` committed at the repository root. This file is the authoritative source of truth.

Types are generated from this spec:

| Generated File | Generator | Command |
|---|---|---|
| `api/generated.go` | `oapi-codegen` | `go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest -config oapi-codegen.yaml openapi.yaml` |
| `frontend/src/lib/api.types.ts` | `openapi-typescript` | `pnpm dlx openapi-typescript openapi.yaml -o frontend/src/lib/api.types.ts` |
| `frontend/src/lib/api.client.ts` | `openapi-fetch` | Same invocation as above |

Hand-writing cross-boundary type definitions in Go or TypeScript is prohibited.

## Consequences

- `api/generated.go`, `frontend/src/lib/api.types.ts`, and `frontend/src/lib/api.client.ts` must never be edited by hand (see AGENTS.md §3.2 and §12).
- If a generated type appears incorrect, the fix goes in `openapi.yaml`. The generated files are re-derived.
- CI re-runs generation and fails if the committed output differs from the freshly generated output. Generated files must be committed whenever `openapi.yaml` changes.
- Client/server type-drift bugs are eliminated at the source: a mismatch in `openapi.yaml` is caught at generation time, not at runtime.
