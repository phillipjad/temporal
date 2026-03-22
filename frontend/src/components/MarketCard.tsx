import { Box, Typography, Chip, useTheme } from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import RemoveIcon from "@mui/icons-material/Remove";
import { ConfidenceGauge } from "./ConfidenceGauge";
import type { components } from "../lib/api.types";

type Market = components["schemas"]["Market"];

interface MarketCardProps {
  market: Market;
  onClick?: (id: string) => void;
}

export function MarketCard({ market, onClick }: MarketCardProps) {
  const theme = useTheme();

  // Map yesPrice [0,1] to a [-1,1] sentiment score for the gauge.
  // yesPrice > 0.5 → net bullish; yesPrice < 0.5 → net bearish.
  const score = (market.yesPrice - 0.5) * 2;

  const signalColor =
    score >= 0.6
      ? theme.palette.success.main
      : score <= -0.6
        ? theme.palette.error.main
        : theme.palette.warning.main;

  const TrendIcon =
    score >= 0.6
      ? TrendingUpIcon
      : score <= -0.6
        ? TrendingDownIcon
        : RemoveIcon;

  const chipColor =
    score >= 0.6 ? "success" : score <= -0.6 ? "error" : "warning";

  const signalLabel = score >= 0.6 ? "BUY" : score <= -0.6 ? "SELL" : "NEUTRAL";

  return (
    <Box
      onClick={() => onClick?.(market.id)}
      className="rounded-lg p-4 transition-all duration-150"
      sx={{
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        cursor: onClick ? "pointer" : "default",
        "&:hover": onClick
          ? {
              borderColor: "primary.main",
              boxShadow: `0 0 0 1px ${theme.palette.primary.main}22`,
            }
          : {},
      }}
    >
      <Box className="flex items-start justify-between gap-2 mb-3">
        <Typography
          variant="body2"
          fontWeight={600}
          sx={{
            color: "text.primary",
            lineHeight: 1.4,
            flex: 1,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {market.title}
        </Typography>
        <Chip
          icon={<TrendIcon sx={{ fontSize: "0.85rem !important" }} />}
          label={signalLabel}
          size="small"
          color={chipColor}
          sx={{ fontWeight: 700, fontSize: "0.65rem", height: "1.375rem" }}
        />
      </Box>

      <ConfidenceGauge score={score} height="0.375rem" showLabel />

      <Box className="flex justify-between items-center mt-2">
        <Typography variant="caption" sx={{ color: "text.disabled" }}>
          {market.id}
        </Typography>
        <Typography
          variant="caption"
          sx={{ color: signalColor, fontWeight: 600 }}
        >
          YES {(market.yesPrice * 100).toFixed(0)}¢
        </Typography>
      </Box>
    </Box>
  );
}
