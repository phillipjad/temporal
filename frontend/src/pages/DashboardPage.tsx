import { useEffect } from "react";
import { Box, Typography, Chip, Skeleton } from "@mui/material";
import StorefrontIcon from "@mui/icons-material/Storefront";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import MemoryIcon from "@mui/icons-material/Memory";
import { useMarkets, useSystemConfig } from "../hooks/useQueries";
import { useCircularBuffer } from "../hooks/useCircularBuffer";
import { useWs } from "../hooks/useWs";
import { MarketConfidenceGrid } from "../components/MarketConfidenceGrid";
import { LiveSignalFeed } from "../components/LiveSignalFeed";
import { AutoTradingToggle } from "../components/AutoTradingToggle";
import { useConfigStore } from "../stores/useConfigStore";
import { mockSignals } from "../lib/mockData";
import type { components } from "../lib/api.types";

type WsSignalEvent = components["schemas"]["WsSignalEvent"];

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: "success" | "warning" | "error" | "primary";
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent = "primary",
}: StatCardProps) {
  const accentColors: Record<string, string> = {
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    primary: "#aa3bff",
  };

  return (
    <Box
      className="flex items-center gap-4 p-4 rounded-lg"
      sx={{
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Box
        className="flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0"
        sx={{
          bgcolor: `${accentColors[accent]}18`,
          color: accentColors[accent],
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="h6" fontWeight={700} lineHeight={1}>
          {value}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        {sub && (
          <Typography
            variant="caption"
            display="block"
            sx={{
              color: accentColors[accent],
              fontWeight: 600,
              fontSize: "0.6rem",
            }}
          >
            {sub}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export function DashboardPage() {
  const { data: markets = [], isLoading: loadingMarkets } = useMarkets();
  const { data: systemConfig, isLoading: loadingConfig } = useSystemConfig();
  const { killSwitchActive, setActivePage } = useConfigStore();
  const { buffer: newsFeed, push: pushNews } =
    useCircularBuffer<WsSignalEvent>(200);

  useWs(
    window.location.protocol === "https:"
      ? `wss://${window.location.host}/ws`
      : `ws://${window.location.host}/ws`,
  );

  useEffect(() => {
    const handleNews = (e: Event) => {
      const customEvent = e as CustomEvent<WsSignalEvent[]>;
      pushNews(customEvent.detail);
    };
    window.addEventListener("temporal:signal_event", handleNews);
    return () =>
      window.removeEventListener("temporal:signal_event", handleNews);
  }, [pushNews]);

  // Fall back to mock news when no real WS data arrives
  useEffect(() => {
    let index = 0;
    const interval = window.setInterval(() => {
      if (newsFeed.length === 0) {
        pushNews([mockSignals[index % mockSignals.length]]);
        index++;
      }
    }, 4000);
    return () => window.clearInterval(interval);
  }, [newsFeed.length, pushNews]);

  const toggleAutoTrading = async (status: boolean) => {
    console.log(`Setting system auto-trading to: ${status}`);
  };

  const autoTradingEnabled = systemConfig?.autoTradingSystemEnabled ?? false;

  return (
    <div className="flex flex-col gap-6">
      {/* Page title */}
      <Box className="flex items-center justify-between">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Real-time market confidence monitoring
          </Typography>
        </Box>
        {killSwitchActive && (
          <Chip
            label="KILL SWITCH ACTIVE"
            color="error"
            size="small"
            sx={{ fontWeight: 700, letterSpacing: 0.5 }}
          />
        )}
      </Box>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {loadingMarkets ? (
          <>
            <Skeleton variant="rounded" height="4.5rem" />
            <Skeleton variant="rounded" height="4.5rem" />
            <Skeleton variant="rounded" height="4.5rem" />
          </>
        ) : (
          <>
            <StatCard
              icon={<StorefrontIcon fontSize="small" />}
              label="Active Markets"
              value={markets.length}
              sub="subscribed"
              accent="primary"
            />
            <StatCard
              icon={<ShowChartIcon fontSize="small" />}
              label="Auto-Trading"
              value={autoTradingEnabled ? "LIVE" : "PAPER"}
              sub={
                autoTradingEnabled ? "Real orders enabled" : "Simulation only"
              }
              accent={autoTradingEnabled ? "error" : "success"}
            />
            <StatCard
              icon={<MemoryIcon fontSize="small" />}
              label="Signal Events"
              value={newsFeed.length}
              sub="in buffer"
              accent="warning"
            />
          </>
        )}
      </div>

      {/* Main content: market grid + signal feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Market confidence grid — 2/3 width */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Box className="flex items-center justify-between">
            <Typography variant="subtitle1" fontWeight={700}>
              Market Confidence
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ cursor: "pointer", "&:hover": { color: "primary.main" } }}
              onClick={() => setActivePage("markets")}
            >
              View all →
            </Typography>
          </Box>
          <MarketConfidenceGrid markets={markets} loading={loadingMarkets} />

          {/* Risk controls */}
          <Box className="mt-2">
            <Typography variant="subtitle1" fontWeight={700} mb={2}>
              Risk Controls
            </Typography>
            {loadingConfig ? (
              <Skeleton variant="rounded" height="7.5rem" />
            ) : (
              <AutoTradingToggle
                currentStatus={autoTradingEnabled}
                onToggle={toggleAutoTrading}
              />
            )}
          </Box>
        </div>

        {/* Live signal feed — 1/3 width */}
        <div className="lg:col-span-1 min-h-96">
          <LiveSignalFeed signals={newsFeed} />
        </div>
      </div>
    </div>
  );
}
