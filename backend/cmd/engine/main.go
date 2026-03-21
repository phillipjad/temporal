package main

import (
	"log/slog"
	"os"

	"temporal/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	slog.Info("config loaded",
		"server_port", cfg.Server.Port,
		"simulation_mode", cfg.System.SimulationMode,
	)

	// TODO: initialize components and start engine (issues #4–#11).
	_ = cfg
}
