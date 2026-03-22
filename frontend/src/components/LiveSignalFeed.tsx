import { Box, Typography, Chip, Divider, useTheme } from "@mui/material";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import RemoveIcon from "@mui/icons-material/Remove";
import type { components } from "../lib/api.types";

type WsSignalEvent = components["schemas"]["WsSignalEvent"];

const SOURCE_COLORS: Record<string, "primary" | "secondary" | "default"> = {
  Bloomberg: "primary",
  Reuters: "secondary",
  CoinDesk: "default",
  "AP News": "default",
};

interface LiveSignalFeedProps {
  signals: WsSignalEvent[];
}

export function LiveSignalFeed({ signals }: LiveSignalFeedProps) {
  const theme = useTheme();

  return (
    <Box
      className="flex flex-col h-full"
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        className="flex items-center justify-between px-4 py-3"
        sx={{ borderBottom: "1px solid", borderColor: "divider" }}
      >
        <Box className="flex items-center gap-2">
          <FiberManualRecordIcon
            sx={{
              fontSize: "0.625rem",
              color: "success.main",
              animation: "pulse 2s infinite",
            }}
          />
          <Typography variant="subtitle2" fontWeight={700}>
            Live Signal Feed
          </Typography>
        </Box>
        <Chip
          label={`${signals.length} events`}
          size="small"
          sx={{
            height: "1.25rem",
            fontSize: "0.65rem",
            bgcolor: "action.hover",
          }}
        />
      </Box>

      {/* Feed items */}
      <Box className="flex-1 overflow-y-auto">
        {signals.length === 0 ? (
          <Box className="flex flex-col items-center justify-center py-10">
            <Typography variant="caption" color="text.disabled">
              Awaiting signal events…
            </Typography>
          </Box>
        ) : (
          signals.map((item, idx) => {
            const signal = item.netSignal;
            const SignalIcon =
              signal > 0.1
                ? TrendingUpIcon
                : signal < -0.1
                  ? TrendingDownIcon
                  : RemoveIcon;
            const signalColor =
              signal > 0.1
                ? theme.palette.success.main
                : signal < -0.1
                  ? theme.palette.error.main
                  : theme.palette.warning.main;

            return (
              <Box key={`${item.marketId}-${idx}`}>
                <Box className="px-4 py-3">
                  <Box className="flex items-center justify-between mb-1">
                    <Chip
                      label={item.source}
                      size="small"
                      color={SOURCE_COLORS[item.source] ?? "default"}
                      variant="outlined"
                      sx={{ height: "1.125rem", fontSize: "0.6rem" }}
                    />
                    <Box className="flex items-center gap-1">
                      <SignalIcon
                        sx={{ fontSize: "0.75rem", color: signalColor }}
                      />
                      <Typography
                        variant="caption"
                        sx={{ color: signalColor, fontWeight: 600 }}
                      >
                        {signal > 0 ? "+" : ""}
                        {(signal * 100).toFixed(0)}%
                      </Typography>
                    </Box>
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{ color: "text.secondary", lineHeight: 1.4 }}
                  >
                    {item.marketId}
                  </Typography>
                </Box>
                {idx < signals.length - 1 && <Divider sx={{ mx: 2 }} />}
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
