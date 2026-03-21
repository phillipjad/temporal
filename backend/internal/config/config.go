// Package config provides the typed TOML configuration loader for the
// Temporal AI engine and API server.
//
// The config file path is hardcoded to /opt/temporal/config/temporal_config.toml.
// There are zero environment variables in this system — os.Getenv and
// os.LookupEnv must never be called from this package.
package config

import (
	"errors"
	"fmt"
	"os"

	"github.com/BurntSushi/toml"
)

const configPath = "/opt/temporal/config/temporal_config.toml"

// ---------------------------------------------------------------------------
// Enumerated values and validation bounds — single source of truth.
// ---------------------------------------------------------------------------

// BrokerEnv is the Kalshi deployment environment.
type BrokerEnv string

const (
	BrokerEnvDemo BrokerEnv = "demo"
	BrokerEnvProd BrokerEnv = "prod"
)

// Validation bounds referenced in Validate(). Defined here so they can be
// imported by other packages that enforce the same limits.
const (
	MinPort              = 1
	MaxPort              = 65535
	MaxWorkerCount       = 16
	MaxSubscribedMarkets = 100
)

// Load reads the config from the hardcoded path, resolves all secret file
// paths, validates all constraints, and returns the resolved Config.
// It exits the process with a descriptive message on any failure.
func Load() (*Config, error) {
	return LoadFromPath(configPath)
}

// LoadFromPath reads and validates the config from the given path.
// Secret path strings are resolved to their file contents and are not retained
// in the returned Config struct.
func LoadFromPath(path string) (*Config, error) {
	var raw rawConfig
	if _, err := toml.DecodeFile(path, &raw); err != nil {
		return nil, fmt.Errorf("decode config %s: %w", path, err)
	}

	cfg, err := raw.resolve()
	if err != nil {
		return nil, err
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config validation: %w", err)
	}

	return cfg, nil
}

// ---------------------------------------------------------------------------
// Exported Config types — no secret path strings retained after resolution.
// ---------------------------------------------------------------------------

// Config is the fully resolved, validated application configuration.
type Config struct {
	Server    ServerConfig
	Auth      AuthConfig
	Database  DatabaseConfig
	Redis     RedisConfig
	Broker    BrokerConfig
	ML        MLConfig
	Ingestion IngestionConfig
	System    SystemConfig
}

// ServerConfig holds HTTP server settings.
type ServerConfig struct {
	Port        int
	CORSOrigins []string
	StaticDir   string
}

// AuthConfig holds JWT settings. Secret key bytes are resolved from file paths
// at startup; the path strings are not retained.
type AuthConfig struct {
	JWTPrivateKeyBytes []byte
	JWTPublicKeyBytes  []byte
	AccessTokenTTLSec  int
	RefreshTokenTTLSec int
}

// DatabaseConfig holds PostgreSQL connection settings. The database password
// is resolved from its file path at startup; the path string is not retained.
type DatabaseConfig struct {
	Host           string
	Port           int
	Name           string
	User           string
	Password       []byte
	SSLMode        string
	MaxOpenConns   int
	MaxIdleConns   int
	ConnTimeoutSec int
}

// RedisConfig holds Redis connection settings. The password (if any) is
// resolved from its file path at startup; the path string is not retained.
type RedisConfig struct {
	Host     string
	Port     int
	Password []byte // empty slice means no authentication
	DB       int
}

// BrokerConfig holds broker-specific configuration.
type BrokerConfig struct {
	Kalshi KalshiConfig
}

// KalshiConfig holds Kalshi broker settings. The private key bytes are
// resolved from the key file at startup; the path string is not retained.
type KalshiConfig struct {
	Env             BrokerEnv
	APIKeyID        string
	PrivateKeyBytes []byte
	TimeoutSec      int
}

// MLConfig holds ML subsystem configuration.
type MLConfig struct {
	Sidecar SidecarConfig
}

// SidecarConfig holds FastAPI ML sidecar connection and model settings.
// Model paths are retained because they are not secrets and are needed
// by the model-loading code at runtime.
type SidecarConfig struct {
	Host          string
	Port          int
	TimeoutMS     int
	BatchWindowMS int
	ModelPath     string
	VocabPath     string
	MetaPath      string
}

// IngestionConfig holds news ingestion pipeline settings.
type IngestionConfig struct {
	WorkerCount       int
	UnifiedBufferSize int
	PollJitterMaxSec  int
	Sources           map[string]SourceConfig
}

// SourceConfig holds per-source ingestion settings.
type SourceConfig struct {
	Enabled         bool
	FeedURL         string
	APIKey          string
	PollIntervalSec int
}

// SystemConfig holds system-wide operational flags.
type SystemConfig struct {
	SimulationMode            bool
	KillSwitch                bool
	MaxSubscribedMarkets      int
	ConfidenceCheckIntervalMS int
	DBBatchFlushIntervalSec   int
	DBBatchMaxSize            int
}

// Validate checks all logical constraints on the resolved Config.
// It returns a joined error listing every violation found.
func (c *Config) Validate() error {
	var errs []error

	// Server
	if c.Server.Port < MinPort || c.Server.Port > MaxPort {
		errs = append(errs, fmt.Errorf("server.port %d is not in range [%d, %d]", c.Server.Port, MinPort, MaxPort))
	}

	// Auth
	if len(c.Auth.JWTPrivateKeyBytes) == 0 {
		errs = append(errs, errors.New("auth.jwt_private_key_path: resolved file is empty"))
	}
	if len(c.Auth.JWTPublicKeyBytes) == 0 {
		errs = append(errs, errors.New("auth.jwt_public_key_path: resolved file is empty"))
	}
	if c.Auth.AccessTokenTTLSec <= 0 {
		errs = append(errs, fmt.Errorf("auth.access_token_ttl_sec must be > 0, got %d", c.Auth.AccessTokenTTLSec))
	}
	if c.Auth.RefreshTokenTTLSec <= 0 {
		errs = append(errs, fmt.Errorf("auth.refresh_token_ttl_sec must be > 0, got %d", c.Auth.RefreshTokenTTLSec))
	}

	// Database
	if c.Database.Host == "" {
		errs = append(errs, errors.New("database.host is required"))
	}
	if c.Database.Port < MinPort || c.Database.Port > MaxPort {
		errs = append(errs, fmt.Errorf("database.port %d is not in range [%d, %d]", c.Database.Port, MinPort, MaxPort))
	}
	if c.Database.Name == "" {
		errs = append(errs, errors.New("database.name is required"))
	}
	if c.Database.User == "" {
		errs = append(errs, errors.New("database.user is required"))
	}
	if c.Database.SSLMode == "" {
		errs = append(errs, errors.New("database.ssl_mode is required"))
	}

	// Redis
	if c.Redis.Host == "" {
		errs = append(errs, errors.New("redis.host is required"))
	}
	if c.Redis.Port < MinPort || c.Redis.Port > MaxPort {
		errs = append(errs, fmt.Errorf("redis.port %d is not in range [%d, %d]", c.Redis.Port, MinPort, MaxPort))
	}

	// Broker
	if c.Broker.Kalshi.Env != BrokerEnvDemo && c.Broker.Kalshi.Env != BrokerEnvProd {
		errs = append(errs, fmt.Errorf("broker.kalshi.env must be %q or %q, got %q", BrokerEnvDemo, BrokerEnvProd, c.Broker.Kalshi.Env))
	}
	if c.Broker.Kalshi.APIKeyID == "" {
		errs = append(errs, errors.New("broker.kalshi.api_key_id is required"))
	}
	if c.Broker.Kalshi.TimeoutSec <= 0 {
		errs = append(errs, fmt.Errorf("broker.kalshi.timeout_sec must be > 0, got %d", c.Broker.Kalshi.TimeoutSec))
	}

	// ML Sidecar
	if c.ML.Sidecar.Host == "" {
		errs = append(errs, errors.New("ml.sidecar.host is required"))
	}
	if c.ML.Sidecar.Port < MinPort || c.ML.Sidecar.Port > MaxPort {
		errs = append(errs, fmt.Errorf("ml.sidecar.port %d is not in range [%d, %d]", c.ML.Sidecar.Port, MinPort, MaxPort))
	}
	if c.ML.Sidecar.TimeoutMS <= 0 {
		errs = append(errs, fmt.Errorf("ml.sidecar.timeout_ms must be > 0, got %d", c.ML.Sidecar.TimeoutMS))
	}

	// Ingestion
	if c.Ingestion.WorkerCount > MaxWorkerCount {
		errs = append(errs, fmt.Errorf("ingestion.worker_count must be in [0, %d], got %d", MaxWorkerCount, c.Ingestion.WorkerCount))
	}

	// System
	if c.System.MaxSubscribedMarkets > MaxSubscribedMarkets {
		errs = append(errs, fmt.Errorf("system.max_subscribed_markets must be <= %d, got %d", MaxSubscribedMarkets, c.System.MaxSubscribedMarkets))
	}

	// Broker env vs simulation mode (§12.3): simulation=false + env=demo is invalid.
	if !c.System.SimulationMode && c.Broker.Kalshi.Env == BrokerEnvDemo {
		errs = append(errs, fmt.Errorf(
			"simulation_mode=false with broker.kalshi.env=%q is not permitted; "+
				"use env=%q for live trading or keep simulation_mode=true",
			BrokerEnvDemo, BrokerEnvProd,
		))
	}

	return errors.Join(errs...)
}

// ---------------------------------------------------------------------------
// Raw TOML structs — unexported, used only during parsing.
// ---------------------------------------------------------------------------

type rawConfig struct {
	Server    rawServerConfig    `toml:"server"`
	Auth      rawAuthConfig      `toml:"auth"`
	Database  rawDatabaseConfig  `toml:"database"`
	Redis     rawRedisConfig     `toml:"redis"`
	Broker    rawBrokerConfig    `toml:"broker"`
	ML        rawMLConfig        `toml:"ml"`
	Ingestion rawIngestionConfig `toml:"ingestion"`
	System    rawSystemConfig    `toml:"system"`
}

type rawServerConfig struct {
	Port        int      `toml:"port"`
	CORSOrigins []string `toml:"cors_origins"`
	StaticDir   string   `toml:"static_dir"`
}

type rawAuthConfig struct {
	JWTPrivateKeyPath  string `toml:"jwt_private_key_path"`
	JWTPublicKeyPath   string `toml:"jwt_public_key_path"`
	AccessTokenTTLSec  int    `toml:"access_token_ttl_sec"`
	RefreshTokenTTLSec int    `toml:"refresh_token_ttl_sec"`
}

type rawDatabaseConfig struct {
	Host           string `toml:"host"`
	Port           int    `toml:"port"`
	Name           string `toml:"name"`
	User           string `toml:"user"`
	PasswordPath   string `toml:"password_path"`
	SSLMode        string `toml:"ssl_mode"`
	MaxOpenConns   int    `toml:"max_open_conns"`
	MaxIdleConns   int    `toml:"max_idle_conns"`
	ConnTimeoutSec int    `toml:"conn_timeout_sec"`
}

type rawRedisConfig struct {
	Host         string `toml:"host"`
	Port         int    `toml:"port"`
	PasswordPath string `toml:"password_path"`
	DB           int    `toml:"db"`
}

type rawBrokerConfig struct {
	Kalshi rawKalshiConfig `toml:"kalshi"`
}

type rawKalshiConfig struct {
	Env            string `toml:"env"`
	APIKeyID       string `toml:"api_key_id"`
	PrivateKeyPath string `toml:"private_key_path"`
	TimeoutSec     int    `toml:"timeout_sec"`
}

type rawMLConfig struct {
	Sidecar rawSidecarConfig `toml:"sidecar"`
}

type rawSidecarConfig struct {
	Host          string `toml:"host"`
	Port          int    `toml:"port"`
	TimeoutMS     int    `toml:"timeout_ms"`
	BatchWindowMS int    `toml:"batch_window_ms"`
	ModelPath     string `toml:"model_path"`
	VocabPath     string `toml:"vocab_path"`
	MetaPath      string `toml:"meta_path"`
}

type rawIngestionConfig struct {
	WorkerCount       int                        `toml:"worker_count"`
	UnifiedBufferSize int                        `toml:"unified_buffer_size"`
	PollJitterMaxSec  int                        `toml:"poll_jitter_max_sec"`
	Sources           map[string]rawSourceConfig `toml:"sources"`
}

type rawSourceConfig struct {
	Enabled         bool   `toml:"enabled"`
	FeedURL         string `toml:"feed_url"`
	APIKey          string `toml:"api_key"`
	PollIntervalSec int    `toml:"poll_interval_sec"`
}

type rawSystemConfig struct {
	SimulationMode            bool `toml:"simulation_mode"`
	KillSwitch                bool `toml:"kill_switch"`
	MaxSubscribedMarkets      int  `toml:"max_subscribed_markets"`
	ConfidenceCheckIntervalMS int  `toml:"confidence_check_interval_ms"`
	DBBatchFlushIntervalSec   int  `toml:"db_batch_flush_interval_sec"`
	DBBatchMaxSize            int  `toml:"db_batch_max_size"`
}

// versionFile is used to read the version field from vocab/meta TOML files.
type versionFile struct {
	Version string `toml:"version"`
}

// ---------------------------------------------------------------------------
// Resolution logic
// ---------------------------------------------------------------------------

// resolve reads secret files, checks model/vocab version consistency, and
// builds the exported Config. Path strings for secrets are not retained.
func (raw *rawConfig) resolve() (*Config, error) {
	jwtPrivKey, err := readRequiredFile(raw.Auth.JWTPrivateKeyPath, "auth.jwt_private_key_path")
	if err != nil {
		return nil, err
	}

	jwtPubKey, err := readRequiredFile(raw.Auth.JWTPublicKeyPath, "auth.jwt_public_key_path")
	if err != nil {
		return nil, err
	}

	dbPassword, err := readRequiredFile(raw.Database.PasswordPath, "database.password_path")
	if err != nil {
		return nil, err
	}

	kalshiKey, err := readRequiredFile(raw.Broker.Kalshi.PrivateKeyPath, "broker.kalshi.private_key_path")
	if err != nil {
		return nil, err
	}

	// Redis password is optional: empty path means no authentication.
	var redisPassword []byte
	if raw.Redis.PasswordPath != "" {
		redisPassword, err = readRequiredFile(raw.Redis.PasswordPath, "redis.password_path")
		if err != nil {
			return nil, err
		}
	}

	// Model paths must be non-empty and version-consistent.
	if raw.ML.Sidecar.VocabPath == "" {
		return nil, errors.New("ml.sidecar.vocab_path is required")
	}
	if raw.ML.Sidecar.MetaPath == "" {
		return nil, errors.New("ml.sidecar.meta_path is required")
	}
	if raw.ML.Sidecar.ModelPath == "" {
		return nil, errors.New("ml.sidecar.model_path is required")
	}
	if err := checkModelVersions(raw.ML.Sidecar.VocabPath, raw.ML.Sidecar.MetaPath); err != nil {
		return nil, err
	}

	sources := make(map[string]SourceConfig, len(raw.Ingestion.Sources))
	for name, s := range raw.Ingestion.Sources {
		sources[name] = SourceConfig{
			Enabled:         s.Enabled,
			FeedURL:         s.FeedURL,
			APIKey:          s.APIKey,
			PollIntervalSec: s.PollIntervalSec,
		}
	}

	return &Config{
		Server: ServerConfig{
			Port:        raw.Server.Port,
			CORSOrigins: raw.Server.CORSOrigins,
			StaticDir:   raw.Server.StaticDir,
		},
		Auth: AuthConfig{
			JWTPrivateKeyBytes: jwtPrivKey,
			JWTPublicKeyBytes:  jwtPubKey,
			AccessTokenTTLSec:  raw.Auth.AccessTokenTTLSec,
			RefreshTokenTTLSec: raw.Auth.RefreshTokenTTLSec,
		},
		Database: DatabaseConfig{
			Host:           raw.Database.Host,
			Port:           raw.Database.Port,
			Name:           raw.Database.Name,
			User:           raw.Database.User,
			Password:       dbPassword,
			SSLMode:        raw.Database.SSLMode,
			MaxOpenConns:   raw.Database.MaxOpenConns,
			MaxIdleConns:   raw.Database.MaxIdleConns,
			ConnTimeoutSec: raw.Database.ConnTimeoutSec,
		},
		Redis: RedisConfig{
			Host:     raw.Redis.Host,
			Port:     raw.Redis.Port,
			Password: redisPassword,
			DB:       raw.Redis.DB,
		},
		Broker: BrokerConfig{
			Kalshi: KalshiConfig{
				Env:             BrokerEnv(raw.Broker.Kalshi.Env),
				APIKeyID:        raw.Broker.Kalshi.APIKeyID,
				PrivateKeyBytes: kalshiKey,
				TimeoutSec:      raw.Broker.Kalshi.TimeoutSec,
			},
		},
		ML: MLConfig{
			Sidecar: SidecarConfig{
				Host:          raw.ML.Sidecar.Host,
				Port:          raw.ML.Sidecar.Port,
				TimeoutMS:     raw.ML.Sidecar.TimeoutMS,
				BatchWindowMS: raw.ML.Sidecar.BatchWindowMS,
				ModelPath:     raw.ML.Sidecar.ModelPath,
				VocabPath:     raw.ML.Sidecar.VocabPath,
				MetaPath:      raw.ML.Sidecar.MetaPath,
			},
		},
		Ingestion: IngestionConfig{
			WorkerCount:       raw.Ingestion.WorkerCount,
			UnifiedBufferSize: raw.Ingestion.UnifiedBufferSize,
			PollJitterMaxSec:  raw.Ingestion.PollJitterMaxSec,
			Sources:           sources,
		},
		System: SystemConfig{
			SimulationMode:            raw.System.SimulationMode,
			KillSwitch:                raw.System.KillSwitch,
			MaxSubscribedMarkets:      raw.System.MaxSubscribedMarkets,
			ConfidenceCheckIntervalMS: raw.System.ConfidenceCheckIntervalMS,
			DBBatchFlushIntervalSec:   raw.System.DBBatchFlushIntervalSec,
			DBBatchMaxSize:            raw.System.DBBatchMaxSize,
		},
	}, nil
}

// readRequiredFile reads the file at path and returns its contents.
// It returns a descriptive error if path is empty or the file cannot be read.
func readRequiredFile(path, fieldName string) ([]byte, error) {
	if path == "" {
		return nil, fmt.Errorf("%s is required (path is empty)", fieldName)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", fieldName, err)
	}
	return data, nil
}

// checkModelVersions reads the version field from both TOML files and
// returns an error if they are missing or do not match.
func checkModelVersions(vocabPath, metaPath string) error {
	var vocab versionFile
	if _, err := toml.DecodeFile(vocabPath, &vocab); err != nil {
		return fmt.Errorf("read vocab version from %s: %w", vocabPath, err)
	}
	if vocab.Version == "" {
		return fmt.Errorf("vocab file %s has no version field", vocabPath)
	}

	var meta versionFile
	if _, err := toml.DecodeFile(metaPath, &meta); err != nil {
		return fmt.Errorf("read meta version from %s: %w", metaPath, err)
	}
	if meta.Version == "" {
		return fmt.Errorf("meta file %s has no version field", metaPath)
	}

	if vocab.Version != meta.Version {
		return fmt.Errorf(
			"model version mismatch: vocab=%s meta=%s — regenerate or update both artifacts together",
			vocab.Version, meta.Version,
		)
	}
	return nil
}
