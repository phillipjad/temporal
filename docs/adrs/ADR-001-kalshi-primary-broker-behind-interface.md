# ADR-001: Kalshi as Primary Broker, Behind an Interface

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

The system must submit orders to a prediction market exchange. Two candidates were evaluated: Kalshi and Polymarket.

- **Kalshi** is CFTC-regulated, transacts in standard USD, and exposes a well-documented REST + WebSocket API.
- **Polymarket** requires USDC and on-chain wallet integration, adding significant operational risk for an initial version.

The system must also be designed so that adding a second broker in the future does not require changes to core business logic.

## Decision

Kalshi is the first-class broker target for v1. All broker communication flows through an `ExecutionBroker` interface defined in the consumer package (`internal/execution/`). `KalshiBroker` is the only production implementation.

## Consequences

- All order submission logic is isolated behind the `ExecutionBroker` interface. No code outside an `ExecutionBroker` implementation may call a broker API directly (see AGENTS.md §3.3).
- Adding a future broker (e.g. Polymarket) requires only a new struct satisfying the existing interface, with no changes to core logic.
- A compile-time assertion `var _ ExecutionBroker = (*KalshiBroker)(nil)` is required in the implementation file.
