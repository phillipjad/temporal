# ADR-005: Automated Trading Requires Explicit Dual Opt-In

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

The system can submit real orders to Kalshi autonomously. A single misconfigured flag enabling this behavior could result in unintended real-money trades. Defense in depth is required.

## Decision

Two independent boolean flags must both be `true` before any real (non-simulated) order is submitted:

1. `user.Config.AutoTradingEnabled` — per-user opt-in, set by the user.
2. `systemConfig.AutoTradingSystemEnabled` — system-wide kill switch, set by an administrator.

Both default to `false`. Neither flag alone is sufficient to enable live trading.

This check is enforced inside `RiskGuard.Check()` in `internal/execution/`. No other layer performs this check; no other layer may bypass it.

## Consequences

- Simplifying this to a single flag check is prohibited (see AGENTS.md §3.7 and checklist).
- The `AutoTradingToggle` UI component enforces a two-step confirmation: the user must type an exact confirmation phrase before the confirm button is enabled. This is a safety requirement, not a UX preference (see AGENTS.md §7.6).
- `RiskGuard.Check` must have an explicit test that verifies both flags must be true (see AGENTS.md §8.4).
