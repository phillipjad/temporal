import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Box, Typography, useTheme } from "@mui/material";

export interface ConfidenceDatapoint {
  timestamp: string;
  score: number;
}

interface ConfidenceChartProps {
  data: ConfidenceDatapoint[];
  threshold?: number;
}

export function ConfidenceChart({
  data,
  threshold = 0.8,
}: ConfidenceChartProps) {
  const theme = useTheme();

  return (
    <Box sx={{ width: "100%", height: "18.75rem", mt: 2 }}>
      <Typography variant="h6" gutterBottom>
        Rolling Confidence
      </Typography>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
          <XAxis
            dataKey="timestamp"
            stroke={theme.palette.text.secondary}
            tick={{ fill: theme.palette.text.secondary }}
          />
          <YAxis
            domain={[-1, 1]}
            stroke={theme.palette.text.secondary}
            tick={{ fill: theme.palette.text.secondary }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.palette.background.paper,
              borderColor: theme.palette.divider,
              color: theme.palette.text.primary,
            }}
          />
          <ReferenceLine
            y={threshold}
            label={{
              position: "top",
              value: "Buy Trigger",
              fill: theme.palette.success.main,
            }}
            stroke={theme.palette.success.main}
            strokeDasharray="3 3"
          />
          <ReferenceLine
            y={-threshold}
            label={{
              position: "bottom",
              value: "Sell Trigger",
              fill: theme.palette.error.main,
            }}
            stroke={theme.palette.error.main}
            strokeDasharray="3 3"
          />
          <Line
            type="stepAfter"
            dataKey="score"
            stroke={theme.palette.primary.main}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}
