import { Box, Typography, Chip } from "@mui/material";
import StorefrontIcon from "@mui/icons-material/Storefront";
import { useMarkets } from "../hooks/useQueries";
import { MarketConfidenceGrid } from "../components/MarketConfidenceGrid";

export function MarketsPage() {
  const { data: markets = [], isLoading } = useMarkets();

  return (
    <div className="flex flex-col gap-6">
      <Box className="flex items-center justify-between">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Markets
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Browse and manage your Kalshi market subscriptions
          </Typography>
        </Box>
        <Chip
          icon={<StorefrontIcon sx={{ fontSize: "0.85rem !important" }} />}
          label={`${markets.length} active`}
          size="small"
          color="primary"
          variant="outlined"
        />
      </Box>

      <MarketConfidenceGrid markets={markets} loading={isLoading} />
    </div>
  );
}
