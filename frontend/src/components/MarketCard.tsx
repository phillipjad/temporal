import {
  Card,
  CardContent,
  Box,
  Typography,
  Chip,
  LinearProgress,
} from "@mui/material";
import type { components } from "../lib/api.types";

type Market = components["schemas"]["Market"];

export function MarketCard({ market }: { market: Market }) {
  const confidenceScore = market.confidenceScore ?? 0;
  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
          <Typography variant="h6" fontWeight="medium">
            {market.question}
          </Typography>
          <Chip
            label={`${(confidenceScore * 100).toFixed(1)}%`}
            color={
              confidenceScore >= 0.7
                ? "success"
                : confidenceScore <= 0.3
                  ? "error"
                  : "warning"
            }
            variant="filled"
          />
        </Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Current Confidence Level
        </Typography>
        <LinearProgress
          variant="determinate"
          value={confidenceScore * 100}
          sx={{ height: "0.5rem", borderRadius: "0.25rem", bgcolor: "divider" }}
          color={
            confidenceScore >= 0.7
              ? "success"
              : confidenceScore <= 0.3
                ? "error"
                : "warning"
          }
        />
      </CardContent>
    </Card>
  );
}
