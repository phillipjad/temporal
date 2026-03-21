# ADR-008: Hardcoded Config Path, TOML Format, Zero Environment Variables

**Status:** Accepted
**Date:** 2026-03-21

---

## Context

The system requires a configuration strategy. Common options:

1. **Environment variables** — widely used in 12-factor apps, but stringly-typed, schemaless, cannot express nested structure, and difficult to validate comprehensively at startup.
2. **Config file with a configurable path** — more structured, but the path itself becomes a source of deployment ambiguity.
3. **Config file at a fixed path** — fully deterministic deployment; all containers mount config from the same well-known location.

## Decision

All configuration lives in a single TOML file at the fixed path `/opt/temporal/config/temporal_config.toml`. This path is hardcoded in the binary. There are zero environment variables in this system.

The `Config` struct in `internal/config/config.go` is the schema. At startup, the TOML file is unmarshalled into this struct and validated via `Config.Validate()`. Any missing required field or invalid value is a hard startup error.

Sensitive values (passwords, private keys) are specified as file paths in the TOML (e.g. `password_path`, `private_key_path`). The config loader reads the file contents at startup; the raw secret is never stored in the `Config` struct.

## Consequences

- `os.Getenv`, `os.LookupEnv`, `viper`, `godotenv`, and equivalent are prohibited (see AGENTS.md §3.1 and checklist).
- `.env` files are prohibited.
- The config path `/opt/temporal/config/temporal_config.toml` cannot be changed at runtime via a flag or argument (see AGENTS.md §10.1).
- A misconfigured field is a hard startup error, not a runtime surprise (see AGENTS.md §10.4).
- All containers in Docker Compose mount the config volume at `/opt/temporal/config/`. This is the only supported deployment pattern.
- Adding a new config value requires updating the `Config` struct, `Config.Validate()`, `config/temporal_config.example.toml`, and `ARCHITECTURE_PLAN.md §12.2` (see AGENTS.md §10.2).
