-- Migration: 000001_initial_schema.down
-- Full reversal of the initial schema in reverse FK-dependency order.
-- All drops use IF EXISTS for safety against partial up runs.

-- ── Financial records ─────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS idx_orders_market_id;
DROP INDEX IF EXISTS idx_orders_user_id;
DROP TABLE IF EXISTS orders;

-- ── Append-only ingestion audit ───────────────────────────────────────────────
-- signal_events depends on news_events; drop it first.
DROP INDEX IF EXISTS idx_signal_events_market_created;
DROP TABLE IF EXISTS signal_events;

DROP INDEX IF EXISTS idx_news_events_content_hash;
DROP TABLE IF EXISTS news_events;

-- ── User market subscriptions ─────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_market_subscriptions_market_id;
DROP TABLE IF EXISTS market_subscriptions;

-- ── Admin and auth tables ─────────────────────────────────────────────────────
-- system_config has no FKs into users; either order here is safe.
DROP TABLE IF EXISTS system_config;
DROP TABLE IF EXISTS users;

DROP EXTENSION IF EXISTS timescaledb;
