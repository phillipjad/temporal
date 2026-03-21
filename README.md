# Temporal

> Automated prediction market trading, driven by news.

Temporal watches the news so you don't have to. It reads thousands of articles a minute, scores them against open prediction market questions, and places trades on your behalf when the evidence is strong enough — all without you lifting a finger.

---

## What it does

1. **Ingests news continuously** — RSS feeds and financial news APIs are polled in real time, deduplicated, and fed into the pipeline.

2. **Understands what it reads** — a lightweight ML model scores each article for relevance and directional signal against every active market question.

3. **Builds conviction over time** — signals from individual articles accumulate into a rolling per-market confidence score that decays as news gets stale.

4. **Trades when it's confident** — when confidence crosses your configured threshold, Temporal submits an order to [Kalshi](https://kalshi.com), a CFTC-regulated prediction market exchange.

5. **Stays out of your way otherwise** — no constant alerts, no dashboards to babysit. It runs, it trades, it logs. You check in when you want to.

---

## Safety first

Real money is involved. Temporal is built with that in mind:

- **Auto-trading is off by default.** Two separate switches — one for you, one system-wide — must both be turned on before a real order is ever submitted.
- **Confirmation required.** Enabling live trading in the UI requires typing an explicit confirmation phrase. There is no one-click enable.
- **Kill switch.** The system-wide flag can be flipped off instantly to halt all trading without touching user settings.
- **Full audit trail.** Every order, signal, and news event is written to a durable database. Nothing is silently discarded.

---

## Stack

| Layer | Technology |
|---|---|
| Engine & API | Go 1.22+ |
| ML inference | Python 3.14 + FastAPI (sidecar) |
| Frontend | React 18 + TypeScript + Vite |
| Databases | Postgres + TimescaleDB, Redis |
| Exchange | Kalshi (CFTC-regulated) |

---

## Status

Early development. The architecture is fully designed; implementation is in progress.
