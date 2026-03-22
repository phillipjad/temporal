import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { ConfidenceChart } from "../components/ConfidenceChart";
import type { ConfidenceDatapoint } from "../components/ConfidenceChart";
import { ContributingSignalList } from "../components/ContributingSignalList";
import type { Signal } from "../components/ContributingSignalList";
import { useCircularBuffer } from "../hooks/useCircularBuffer";

export function MarketDetailPage({ marketId }: { marketId: string }) {
  const { buffer: chartData, push } =
    useCircularBuffer<ConfidenceDatapoint>(500);
  const [signals, setSignals] = useState<Signal[]>([]);

  // Simulated data stream for the UI update
  useEffect(() => {
    let score = 0;
    const interval = setInterval(() => {
      // simulate random walk with some boundaries
      score += (Math.random() - 0.5) * 0.1;
      score = Math.max(-1, Math.min(1, score));

      push([
        {
          timestamp: new Date().toLocaleTimeString(),
          score,
        },
      ]);

      if (Math.random() > 0.8) {
        setSignals((prev) => [
          {
            id: Math.random().toString(36).substring(7),
            timestamp: new Date().toLocaleTimeString(),
            source: "Mock Source",
            impact: score > 0 ? 0.05 : -0.05,
            textSnippet:
              "A mock news article snippet driving the score change.",
          },
          ...prev.slice(0, 9),
        ]);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [push]);

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: "auto" }}>
      <Typography
        variant="h5"
        sx={{ mb: 2, pb: 1, borderBottom: 1, borderColor: "divider" }}
      >
        Market Details: {marketId || "N/A"}
      </Typography>
      <ConfidenceChart data={chartData} threshold={0.8} />
      <ContributingSignalList signals={signals} />
    </Box>
  );
}
