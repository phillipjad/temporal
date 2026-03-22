import { Box, Tooltip, useTheme } from "@mui/material";

interface ConfidenceGaugeProps {
  score: number; // [-1, 1]
  height?: string;
  showLabel?: boolean;
}

export function ConfidenceGauge({
  score,
  height = "0.5rem",
  showLabel = false,
}: ConfidenceGaugeProps) {
  const theme = useTheme();
  const clamped = Math.max(-1, Math.min(1, score));

  const fillColor =
    clamped >= 0.6
      ? theme.palette.success.main
      : clamped <= -0.6
        ? theme.palette.error.main
        : clamped > 0
          ? theme.palette.warning.main
          : theme.palette.warning.dark;

  // Positive: fill right half from center outward
  // Negative: fill left half from center outward
  const fillPercent = Math.abs(clamped) * 50; // 0–50% of the total bar
  const isPositive = clamped >= 0;

  const label = `${clamped >= 0 ? "+" : ""}${(clamped * 100).toFixed(1)}%`;

  return (
    <Tooltip title={`Confidence: ${label}`} placement="top">
      <Box>
        {showLabel && (
          <Box
            className="flex justify-between mb-1"
            sx={{ fontSize: "0.65rem", color: "text.secondary" }}
          >
            <span>−1</span>
            <span
              style={{
                fontWeight: 600,
                color: fillColor,
                fontSize: "0.7rem",
              }}
            >
              {label}
            </span>
            <span>+1</span>
          </Box>
        )}
        {/* Track */}
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height,
            borderRadius: "50vh",
            bgcolor: "divider",
            overflow: "hidden",
          }}
        >
          {/* Center marker */}
          <Box
            sx={{
              position: "absolute",
              left: "50%",
              top: 0,
              bottom: 0,
              width: "0.0625rem",
              bgcolor: "text.disabled",
              zIndex: 1,
            }}
          />
          {/* Fill */}
          {clamped !== 0 && (
            <Box
              sx={{
                position: "absolute",
                top: 0,
                bottom: 0,
                width: `${fillPercent}%`,
                ...(isPositive ? { left: "50%" } : { right: "50%" }),
                bgcolor: fillColor,
                transition: "width 0.3s ease",
              }}
            />
          )}
        </Box>
      </Box>
    </Tooltip>
  );
}
