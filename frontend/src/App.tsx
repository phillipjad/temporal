import { useEffect, useState } from "react";
import {
  Container,
  Box,
  Typography,
  Button,
  Grid,
  Skeleton,
  IconButton,
} from "@mui/material";
import NightlightIcon from "@mui/icons-material/Nightlight";
import LightModeIcon from "@mui/icons-material/LightMode";
import { useColorMode } from "./hooks/useColorMode";
import { useConfigStore } from "./stores/useConfigStore";
import { useCircularBuffer } from "./hooks/useCircularBuffer";
import { useWs } from "./hooks/useWs";
import { useMarkets, useSystemConfig } from "./hooks/useQueries";
import { AutoTradingToggle } from "./components/AutoTradingToggle";
import { MarketCard } from "./components/MarketCard";
import { NewsFeed } from "./components/NewsFeed";
import { mockNews } from "./lib/mockData";
import { MarketDetailPage } from "./pages/MarketDetailPage";
import type { components } from "./lib/api.types";

type NewsEvent = components["schemas"]["NewsEvent"];
type Market = components["schemas"]["Market"];

export default function App() {
  const { uiVisibility, setUiVisibility } = useConfigStore();
  const { colorMode, toggleColorMode } = useColorMode();
  const { data: markets = [], isLoading: loadingMarkets } = useMarkets();
  const { data: systemConfig, isLoading: loadingConfig } = useSystemConfig();
  const { buffer: newsFeed, push: pushNews } = useCircularBuffer<NewsEvent>(50);

  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);

  useWs(
    window.location.protocol === "https:"
      ? `wss://${window.location.host}/ws`
      : `ws://${window.location.host}/ws`,
  );

  useEffect(() => {
    // Listen to real WebSocket events
    const handleNews = (e: Event) => {
      const customEvent = e as CustomEvent<NewsEvent[]>;
      pushNews(customEvent.detail);
    };
    window.addEventListener("temporal:news_event", handleNews);
    return () => window.removeEventListener("temporal:news_event", handleNews);
  }, [pushNews]);

  useEffect(() => {
    // If no news arrives from WS within 3s, use mock news
    const interval: number = window.setInterval(() => {
      let index = 0;

      if (newsFeed.length === 0) {
        // Keep appending mock data if no real data
        pushNews([mockNews[index % mockNews.length]]);
        index++;
      }
    }, 4000);

    return () => window.clearInterval(interval);
  }, [newsFeed.length, pushNews]);

  const toggleAutoTrading = async (status: boolean) => {
    console.log(`Setting system auto-trading to: ${status}`);
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "background.default",
        color: "text.primary",
        p: 4,
      }}
    >
      <Container maxWidth="xl" sx={{ textAlign: "left" }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: 1,
            borderColor: "divider",
            pb: 2,
            mb: 4,
          }}
        >
          <Box>
            <Typography variant="h4" component="h1" fontWeight="bold">
              Temporal AI
            </Typography>
            <Typography variant="body1" color="text.secondary" mt={1}>
              Automated prediction market trading, driven by news.
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            <IconButton onClick={toggleColorMode} color="inherit">
              {colorMode === "light" ? <NightlightIcon /> : <LightModeIcon />}
            </IconButton>
            <Button
              variant="outlined"
              onClick={() => setUiVisibility(!uiVisibility)}
              size="small"
            >
              {uiVisibility ? "Hide Controls" : "Show Controls"}
            </Button>
          </Box>
        </Box>

        {uiVisibility && selectedMarketId ? (
          <Box>
            <Button onClick={() => setSelectedMarketId(null)} sx={{ mb: 2 }}>
              &larr; Back to Markets
            </Button>
            <MarketDetailPage marketId={selectedMarketId} />
          </Box>
        ) : (
          uiVisibility && (
            <Grid container spacing={4}>
              <Grid size={{ xs: 12, md: 8 }}>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="h5" component="h2" fontWeight="medium">
                    Active Markets & Confidence
                  </Typography>
                </Box>

                {loadingMarkets ? (
                  <Skeleton variant="rounded" height="6rem" />
                ) : markets.length === 0 ? (
                  <Box
                    sx={{
                      p: 3,
                      textAlign: "center",
                      borderRadius: 1,
                      border: "1px dashed",
                      borderColor: "divider",
                      color: "text.secondary",
                    }}
                  >
                    No active markets found...
                  </Box>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column" }}>
                    {markets.map((market: Market) => (
                      <Box
                        key={market.id}
                        onClick={() => setSelectedMarketId(market.id)}
                        sx={{ cursor: "pointer", mb: 2 }}
                      >
                        <MarketCard market={market} />
                      </Box>
                    ))}
                  </Box>
                )}

                <Box sx={{ mt: 4 }}>
                  <Typography
                    variant="h5"
                    component="h2"
                    fontWeight="medium"
                    mb={2}
                  >
                    Risk Controls
                  </Typography>
                  {loadingConfig ? (
                    <Skeleton variant="rounded" height="12.5rem" />
                  ) : (
                    <AutoTradingToggle
                      currentStatus={
                        systemConfig?.autoTradingSystemEnabled ?? false
                      }
                      onToggle={toggleAutoTrading}
                    />
                  )}
                </Box>
              </Grid>

              <Grid size={{ xs: 12, md: 4 }}>
                <NewsFeed news={newsFeed} />
              </Grid>
            </Grid>
          )
        )}
      </Container>
    </Box>
  );
}
