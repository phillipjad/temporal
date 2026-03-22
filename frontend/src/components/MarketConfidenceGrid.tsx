import { Box, Typography, Skeleton } from "@mui/material";
import { MarketCard } from "./MarketCard";
import type { components } from "../lib/api.types";

type Market = components["schemas"]["Market"];

interface MarketConfidenceGridProps {
  markets: Market[];
  loading: boolean;
  onMarketClick?: (id: string) => void;
}

export function MarketConfidenceGrid({
  markets,
  loading,
  onMarketClick,
}: MarketConfidenceGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height="6.875rem" />
        ))}
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <Box
        className="flex flex-col items-center justify-center py-16 rounded-lg"
        sx={{ border: "1px dashed", borderColor: "divider" }}
      >
        <Typography variant="body2" color="text.disabled">
          No active markets found
        </Typography>
        <Typography variant="caption" color="text.disabled" mt={0.5}>
          Subscribe to markets in the Markets tab
        </Typography>
      </Box>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {markets.map((market) => (
        <MarketCard key={market.id} market={market} onClick={onMarketClick} />
      ))}
    </div>
  );
}
