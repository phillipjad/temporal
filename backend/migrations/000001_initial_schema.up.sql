-- Migration: 000001_initial_schema.up
-- Applies the complete initial schema for Temporal AI.
--
-- Durability note: synchronous_commit and fsync settings are applied at the Go
-- connection-pool level (per AGENTS.md §9.3) and must never appear here.
-- fsync=off is never used in this system.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── Auth and user configuration ───────────────────────────────────────────────
-- synchronous_commit = ON at connection level. fsync = ON always.

CREATE TABLE users (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email                      TEXT        UNIQUE NOT NULL,
    password_hash              TEXT        NOT NULL,
    role                       TEXT        NOT NULL
                                           CHECK (role IN ('admin', 'trader', 'viewer')),
    auto_trading_enabled       BOOLEAN     NOT NULL DEFAULT false,
    max_risk_per_trade         REAL        NOT NULL DEFAULT 0.05,
    max_daily_loss             REAL        NOT NULL DEFAULT 0.10,
    max_open_positions         INT         NOT NULL DEFAULT 5,
    buy_threshold              REAL        NOT NULL DEFAULT 0.65,
    sell_threshold             REAL        NOT NULL DEFAULT 0.65,
    signal_decay_half_life_sec INT         NOT NULL DEFAULT 3600,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Admin-owned system toggles ────────────────────────────────────────────────
-- Singleton row enforced by CHECK (id = 1) and column DEFAULT 1.
-- synchronous_commit = ON at connection level. fsync = ON always.

CREATE TABLE system_config (
    id                          INT         PRIMARY KEY DEFAULT 1
                                            CHECK (id = 1),
    auto_trading_system_enabled BOOLEAN     NOT NULL DEFAULT false,
    kill_switch_active          BOOLEAN     NOT NULL DEFAULT false,
    max_global_open_positions   INT         NOT NULL DEFAULT 50,
    model_version               TEXT        NOT NULL DEFAULT '',
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the singleton row; Go code always expects exactly one row with id = 1.
INSERT INTO system_config (id, auto_trading_system_enabled, kill_switch_active,
    max_global_open_positions, model_version, updated_at)
VALUES (1, false, false, 50, '', now());

-- ── User market subscriptions ─────────────────────────────────────────────────
-- synchronous_commit = ON at connection level. fsync = ON always.

CREATE TABLE market_subscriptions (
    user_id      UUID        NOT NULL,
    market_id    TEXT        NOT NULL,
    keyword_tags TEXT[]      NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, market_id),
    CONSTRAINT fk_market_subscriptions_user_id
        FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX idx_market_subscriptions_market_id
    ON market_subscriptions (market_id);

-- ── Append-only ingestion audit ───────────────────────────────────────────────
-- synchronous_commit = OFF acceptable at connection level. fsync = ON always.

CREATE TABLE news_events (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source       TEXT        NOT NULL,
    title        TEXT        NOT NULL,
    url          TEXT        NOT NULL,
    content_hash BYTEA       NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ NOT NULL
);

-- Promote to hypertable partitioned by fetched_at.
-- TimescaleDB automatically creates and propagates the time-column index
-- to new chunks; it does not need to be declared here.
SELECT create_hypertable('news_events', 'fetched_at');

-- Supports deduplication lookup by content hash.
CREATE INDEX idx_news_events_content_hash ON news_events (content_hash);

CREATE TABLE signal_events (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    news_event_id UUID        NOT NULL,
    market_id     TEXT        NOT NULL,
    bullish_prob  REAL        NOT NULL,
    bearish_prob  REAL        NOT NULL,
    neutral_prob  REAL        NOT NULL,
    net_signal    REAL        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_signal_events_news_event_id
        FOREIGN KEY (news_event_id) REFERENCES news_events (id)
);

-- Promote to hypertable partitioned by created_at.
SELECT create_hypertable('signal_events', 'created_at');

-- Compound index for the common query pattern: signals for a given market
-- within a time range. market_id leads (equality filter); TimescaleDB chunk
-- exclusion handles the time dimension independently.
-- Per AGENTS.md §9.4, TimescaleDB propagates this index to each new chunk.
CREATE INDEX idx_signal_events_market_created
    ON signal_events (market_id, created_at DESC);

-- ── Financial records ─────────────────────────────────────────────────────────
-- synchronous_commit = ON at connection level. fsync = ON always. No exceptions.

CREATE TABLE orders (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID          NOT NULL,
    market_id       TEXT          NOT NULL,
    side            TEXT          NOT NULL
                                  CHECK (side IN ('yes', 'no')),
    size            NUMERIC(18,6) NOT NULL,
    limit_price     NUMERIC(18,6) NOT NULL,
    status          TEXT          NOT NULL
                                  CHECK (status IN
                                      ('pending', 'submitted', 'filled',
                                       'cancelled', 'failed')),
    simulated       BOOLEAN       NOT NULL DEFAULT true,
    broker_order_id TEXT,
    failure_reason  TEXT,
    source_signal   JSONB,
    created_at      TIMESTAMPTZ   NOT NULL,
    submitted_at    TIMESTAMPTZ,
    filled_at       TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    CONSTRAINT fk_orders_user_id
        FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX idx_orders_user_id   ON orders (user_id);
CREATE INDEX idx_orders_market_id ON orders (market_id);
CREATE INDEX idx_orders_status    ON orders (status);
