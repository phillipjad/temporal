import { Box, Typography, Divider, Skeleton } from "@mui/material";
import { AutoTradingToggle } from "../components/AutoTradingToggle";
import { useSystemConfig } from "../hooks/useQueries";

export function SettingsPage() {
  const { data: systemConfig, isLoading } = useSystemConfig();

  const toggleAutoTrading = async (status: boolean) => {
    console.log(`Setting system auto-trading to: ${status}`);
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Risk profile and system configuration
        </Typography>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle1" fontWeight={700} mb={1}>
          Auto-Trading
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          Controls whether the engine submits real orders to Kalshi. Both the
          system flag and the per-user flag must be enabled before any real
          order is placed. See Architecture §3.7.
        </Typography>
        {isLoading ? (
          <Skeleton variant="rounded" height="7.5rem" />
        ) : (
          <AutoTradingToggle
            currentStatus={systemConfig?.autoTradingSystemEnabled ?? false}
            onToggle={toggleAutoTrading}
          />
        )}
      </Box>
    </div>
  );
}
