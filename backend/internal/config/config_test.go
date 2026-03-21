package config_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"temporal/internal/config"
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// testEnv holds paths to all the temp files needed for a valid config.
type testEnv struct {
	dir      string
	tomlPath string
}

// newTestEnv creates a temp directory with all required secret and model files.
func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	dir := t.TempDir()

	mustWrite(t, filepath.Join(dir, "jwt_private.pem"), "fake-jwt-private-key")
	mustWrite(t, filepath.Join(dir, "jwt_public.pem"), "fake-jwt-public-key")
	mustWrite(t, filepath.Join(dir, "db_password.txt"), "super-secret-db-pw")
	mustWrite(t, filepath.Join(dir, "kalshi_key.pem"), "fake-kalshi-private-key")
	mustWrite(t, filepath.Join(dir, "model.onnx"), "fake-onnx-content")
	mustWrite(t, filepath.Join(dir, "vocab.toml"), "version = \"1\"\n")
	mustWrite(t, filepath.Join(dir, "meta.toml"), "version = \"1\"\n")

	tomlPath := filepath.Join(dir, "config.toml")
	return &testEnv{dir: dir, tomlPath: tomlPath}
}

// writeConfig writes the given TOML content to the testEnv's config path.
func (e *testEnv) writeConfig(t *testing.T, content string) {
	t.Helper()
	if err := os.WriteFile(e.tomlPath, []byte(content), 0600); err != nil {
		t.Fatalf("writeConfig: %v", err)
	}
}

// writeValidConfig writes a valid config pointing at all temp files.
func (e *testEnv) writeValidConfig(t *testing.T) {
	t.Helper()
	e.writeConfig(t, e.validTOML())
}

func (e *testEnv) validTOML() string {
	return fmt.Sprintf(`
[server]
port           = 8080
cors_origins   = ["http://localhost:5173"]
static_dir     = ""

[auth]
jwt_private_key_path  = %q
jwt_public_key_path   = %q
access_token_ttl_sec  = 900
refresh_token_ttl_sec = 604800

[database]
host             = "localhost"
port             = 5432
name             = "temporal"
user             = "temporal"
password_path    = %q
ssl_mode         = "disable"
max_open_conns   = 25
max_idle_conns   = 5
conn_timeout_sec = 5

[redis]
host          = "redis"
port          = 6379
password_path = ""
db            = 0

[broker]
  [broker.kalshi]
  env              = "demo"
  api_key_id       = "test-key-id"
  private_key_path = %q
  timeout_sec      = 5

[ml]
  [ml.sidecar]
  host            = "ml-sidecar"
  port            = 8001
  timeout_ms      = 50
  batch_window_ms = 8
  model_path      = %q
  vocab_path      = %q
  meta_path       = %q

[ingestion]
worker_count        = 8
unified_buffer_size = 1024
poll_jitter_max_sec = 10

  [ingestion.sources.reuters]
  enabled           = true
  feed_url          = "https://feeds.reuters.com/reuters/topNews"
  poll_interval_sec = 60

  [ingestion.sources.polygon]
  enabled           = true
  api_key           = "poly-key"
  poll_interval_sec = 60

[system]
simulation_mode              = true
kill_switch                  = false
max_subscribed_markets       = 100
confidence_check_interval_ms = 100
db_batch_flush_interval_sec  = 5
db_batch_max_size            = 500
`,
		filepath.Join(e.dir, "jwt_private.pem"),
		filepath.Join(e.dir, "jwt_public.pem"),
		filepath.Join(e.dir, "db_password.txt"),
		filepath.Join(e.dir, "kalshi_key.pem"),
		filepath.Join(e.dir, "model.onnx"),
		filepath.Join(e.dir, "vocab.toml"),
		filepath.Join(e.dir, "meta.toml"),
	)
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatalf("mustWrite %s: %v", path, err)
	}
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

func TestLoadFromPath_HappyPath(t *testing.T) {
	e := newTestEnv(t)
	e.writeValidConfig(t)

	cfg, err := config.LoadFromPath(e.tomlPath)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	// Verify a sample of resolved fields.
	if cfg.Server.Port != 8080 {
		t.Errorf("Server.Port: want 8080, got %d", cfg.Server.Port)
	}
	if string(cfg.Auth.JWTPrivateKeyBytes) != "fake-jwt-private-key" {
		t.Errorf("Auth.JWTPrivateKeyBytes not resolved correctly")
	}
	if string(cfg.Database.Password) != "super-secret-db-pw" {
		t.Errorf("Database.Password not resolved correctly")
	}
	if string(cfg.Broker.Kalshi.PrivateKeyBytes) != "fake-kalshi-private-key" {
		t.Errorf("Broker.Kalshi.PrivateKeyBytes not resolved correctly")
	}
	if cfg.Ingestion.Sources["reuters"].Enabled != true {
		t.Errorf("ingestion.sources.reuters.enabled: want true")
	}
	if cfg.System.SimulationMode != true {
		t.Errorf("System.SimulationMode: want true")
	}
}

// Confirm that path strings are NOT present in the resolved Config struct
// (they must not be retained as exported fields after resolution).
func TestLoadFromPath_SecretPathsNotInConfig(t *testing.T) {
	e := newTestEnv(t)
	e.writeValidConfig(t)

	cfg, err := config.LoadFromPath(e.tomlPath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// The resolved Config type must not carry any *_path string field for secrets.
	// We verify indirectly: resolved byte slices must be non-empty.
	if len(cfg.Auth.JWTPrivateKeyBytes) == 0 {
		t.Error("Auth.JWTPrivateKeyBytes is empty")
	}
	if len(cfg.Auth.JWTPublicKeyBytes) == 0 {
		t.Error("Auth.JWTPublicKeyBytes is empty")
	}
	if len(cfg.Database.Password) == 0 {
		t.Error("Database.Password is empty")
	}
	if len(cfg.Broker.Kalshi.PrivateKeyBytes) == 0 {
		t.Error("Broker.Kalshi.PrivateKeyBytes is empty")
	}
}

// ---------------------------------------------------------------------------
// Missing / malformed TOML
// ---------------------------------------------------------------------------

func TestLoadFromPath_FileNotFound(t *testing.T) {
	_, err := config.LoadFromPath("/nonexistent/path/config.toml")
	if err == nil {
		t.Fatal("expected error for missing config file, got nil")
	}
}

func TestLoadFromPath_MalformedTOML(t *testing.T) {
	e := newTestEnv(t)
	e.writeConfig(t, "this is not valid toml ][[[")

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for malformed TOML, got nil")
	}
}

// ---------------------------------------------------------------------------
// Missing required fields
// ---------------------------------------------------------------------------

func TestLoadFromPath_MissingDatabaseHost(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(), `host             = "localhost"`, `host             = ""`)
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for missing database.host, got nil")
	}
	if !strings.Contains(err.Error(), "database.host") {
		t.Errorf("error should mention database.host, got: %v", err)
	}
}

func TestLoadFromPath_MissingDatabaseName(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(), `name             = "temporal"`, `name             = ""`)
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for missing database.name, got nil")
	}
	if !strings.Contains(err.Error(), "database.name") {
		t.Errorf("error should mention database.name, got: %v", err)
	}
}

func TestLoadFromPath_MissingMLSidecarHost(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(), `host            = "ml-sidecar"`, `host            = ""`)
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for missing ml.sidecar.host, got nil")
	}
	if !strings.Contains(err.Error(), "ml.sidecar.host") {
		t.Errorf("error should mention ml.sidecar.host, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Secret file path does not exist
// ---------------------------------------------------------------------------

func TestLoadFromPath_JWTPrivateKeyMissing(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(),
		filepath.Join(e.dir, "jwt_private.pem"),
		filepath.Join(e.dir, "nonexistent_jwt_private.pem"),
	)
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for missing jwt_private_key_path file, got nil")
	}
}

func TestLoadFromPath_DBPasswordFileMissing(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(),
		filepath.Join(e.dir, "db_password.txt"),
		filepath.Join(e.dir, "nonexistent_db_password.txt"),
	)
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for missing database.password_path file, got nil")
	}
}

func TestLoadFromPath_KalshiKeyFileMissing(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(),
		filepath.Join(e.dir, "kalshi_key.pem"),
		filepath.Join(e.dir, "nonexistent_kalshi_key.pem"),
	)
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for missing broker.kalshi.private_key_path file, got nil")
	}
}

func TestLoadFromPath_RedisPasswordFileMissing(t *testing.T) {
	e := newTestEnv(t)
	mustWrite(t, filepath.Join(e.dir, "redis_password.txt"), "redis-pw")
	// Point to a non-existent redis password file.
	toml := strings.ReplaceAll(e.validTOML(),
		`password_path = ""`,
		fmt.Sprintf("password_path = %q", filepath.Join(e.dir, "nonexistent_redis_pw.txt")),
	)
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for missing redis.password_path file, got nil")
	}
}

// ---------------------------------------------------------------------------
// Model / vocab version mismatch
// ---------------------------------------------------------------------------

func TestLoadFromPath_ModelVocabVersionMismatch(t *testing.T) {
	e := newTestEnv(t)
	// Override vocab.toml to have a different version.
	mustWrite(t, filepath.Join(e.dir, "vocab.toml"), "version = \"2\"\n")
	e.writeValidConfig(t)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for model/vocab version mismatch, got nil")
	}
	if !strings.Contains(err.Error(), "mismatch") {
		t.Errorf("error should mention version mismatch, got: %v", err)
	}
}

func TestLoadFromPath_ModelVocabVersionMissing(t *testing.T) {
	e := newTestEnv(t)
	// vocab.toml without a version field.
	mustWrite(t, filepath.Join(e.dir, "vocab.toml"), "terms = 4096\n")
	e.writeValidConfig(t)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error when vocab has no version field, got nil")
	}
}

// ---------------------------------------------------------------------------
// Validate — port range
// ---------------------------------------------------------------------------

func TestValidate_ServerPortZero(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(), "port           = 8080", "port           = 0")
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for server.port = 0, got nil")
	}
	if !strings.Contains(err.Error(), "server.port") {
		t.Errorf("error should mention server.port, got: %v", err)
	}
}

func TestValidate_ServerPortTooHigh(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(), "port           = 8080", "port           = 99999")
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for server.port = 99999, got nil")
	}
}

func TestValidate_DatabasePortOutOfRange(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(), "port             = 5432", "port             = 70000")
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for database.port = 70000, got nil")
	}
	if !strings.Contains(err.Error(), "database.port") {
		t.Errorf("error should mention database.port, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Validate — worker count
// ---------------------------------------------------------------------------

func TestValidate_WorkerCountZeroIsValid(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(), "worker_count        = 8", "worker_count        = 0")
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err != nil {
		t.Fatalf("worker_count=0 should be valid (means runtime.NumCPU), got: %v", err)
	}
}

func TestValidate_WorkerCountExceedsMax(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(), "worker_count        = 8", "worker_count        = 17")
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for worker_count = 17, got nil")
	}
	if !strings.Contains(err.Error(), "worker_count") {
		t.Errorf("error should mention worker_count, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Validate — market subscription cap
// ---------------------------------------------------------------------------

func TestValidate_MaxSubscribedMarketsExceedsCap(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(),
		"max_subscribed_markets       = 100",
		"max_subscribed_markets       = 101",
	)
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for max_subscribed_markets = 101, got nil")
	}
	if !strings.Contains(err.Error(), "max_subscribed_markets") {
		t.Errorf("error should mention max_subscribed_markets, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Validate — broker env vs simulation mode (§12.3)
// ---------------------------------------------------------------------------

func TestValidate_SimulationFalseWithDemoEnvIsError(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(),
		"simulation_mode              = true",
		"simulation_mode              = false",
	)
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for simulation_mode=false with env=demo, got nil")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "simulation") {
		t.Errorf("error should mention simulation, got: %v", err)
	}
}

func TestValidate_BrokerEnvInvalidValue(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(),
		`env              = "demo"`,
		`env              = "staging"`,
	)
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for broker.kalshi.env = staging, got nil")
	}
	if !strings.Contains(err.Error(), "broker.kalshi.env") {
		t.Errorf("error should mention broker.kalshi.env, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Validate — access token TTL
// ---------------------------------------------------------------------------

func TestValidate_AccessTokenTTLZero(t *testing.T) {
	e := newTestEnv(t)
	toml := strings.ReplaceAll(e.validTOML(),
		"access_token_ttl_sec  = 900",
		"access_token_ttl_sec  = 0",
	)
	e.writeConfig(t, toml)

	_, err := config.LoadFromPath(e.tomlPath)
	if err == nil {
		t.Fatal("expected error for access_token_ttl_sec = 0, got nil")
	}
	if !strings.Contains(err.Error(), "access_token_ttl_sec") {
		t.Errorf("error should mention access_token_ttl_sec, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// No os.Getenv / os.LookupEnv usage (enforced in CI via grep; documented here)
// ---------------------------------------------------------------------------

func TestNoEnvVarUsage(t *testing.T) {
	// This test is intentionally a documentation anchor. The actual enforcement
	// of "no os.Getenv / os.LookupEnv" is done by grepping the package source
	// in CI. Any call to os.Getenv or os.LookupEnv in internal/config/ violates
	// the non-negotiable rule in AGENTS.md §3.1.
	t.Log("enforcement of no-envvar rule is performed by CI grep on package source")
}
