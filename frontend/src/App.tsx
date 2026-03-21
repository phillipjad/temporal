import { useEffect } from "react";
import {
  Container,
  Box,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  Skeleton,
  Chip,
} from "@mui/material";
import { useConfigStore } from "./stores/useConfigStore";
import { useCircularBuffer } from "./hooks/useCircularBuffer";
import { useWs } from "./hooks/useWs";
import { useMarkets, useSystemConfig } from "./hooks/useQueries";
import { AutoTradingToggle } from "./components/AutoTradingToggle";
import type { components } from "./lib/api.types";

type NewsEvent = components["schemas"]["NewsEvent"];
type Market = components["schemas"]["Market"];

export default function App() {
  const { uiVisibility, activeFilter, setUiVisibility, setActiveFilter } =
    useConfigStore();
  const { data: markets = [], isLoading: loadingMarkets } = useMarkets();
  const { data: systemConfig, isLoading: loadingConfig } = useSystemConfig();
  const { buffer: newsFeed, push: pushNews } = useCircularBuffer<NewsEvent>(50);

  useWs("ws://localhost:8080/ws");

  useEffect(() => {
    const handleNews = (e: Event) => {
      const customEvent = e as CustomEvent<NewsEvent[]>;
      pushNews(customEvent.detail);
    };
    window.addEventListener("temporal:news_event", handleNews);
    return () => window.removeEventListener("temporal:news_event", handleNews);
  }, [pushNews]);

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
      <Container maxWidth="lg" sx={{ textAlign: "left" }}>
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
          <Box>
            <Button
              variant="outlined"
              onClick={() => setUiVisibility(!uiVisibility)}
              size="small"
            >
              {uiVisibility ? "Hide Controls" : "Show Controls"}
            </Button>
          </Box>
        </Box>

        {uiVisibility && (
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 8 }}>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h5" component="h2" fontWeight="medium">
                  Active Markets & Confidence
                </Typography>
              </Box>

              {loadingMarkets ? (
                <Skeleton variant="rounded" height={96} />
              ) : markets.length === 0 ? (
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 1,
                    border: "1px dashed",
                    borderColor: "divider",
                    color: "text.secondary",
                  }}
                >
                  No active markets found...
                </Box>
              ) : (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {markets.map((market: Market) => (
                    <Card key={market.id} variant="outlined">
                      <CardContent
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          "&:last-child": { pb: 2 },
                        }}
                      >
                        <Box>
                          <Typography
                            variant="caption"
                            fontFamily="monospace"
                            color="text.secondary"
                            display="block"
                            gutterBottom
                          >
                            {market.id}
                          </Typography>
                          <Typography
                            variant="h6"
                            component="h3"
                            lineHeight={1.2}
                          >
                            {market.question}
                          </Typography>
                        </Box>
                        <Box sx={{ textAlign: "right", pl: 2 }}>
                          <Typography
                            variant="h5"
                            fontWeight="bold"
                            color={
                              (market.confidenceScore ?? 0) > 0.8
                                ? "success.main"
                                : "info.main"
                            }
                          >
                            {((market.confidenceScore ?? 0) * 100).toFixed(1)}%
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            textTransform="uppercase"
                            letterSpacing={1}
                          >
                            Confidence
                          </Typography>
                        </Box>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              )}
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h5" component="h2" fontWeight="medium">
                  Risk Engine
                </Typography>
              </Box>
              {loadingConfig ? (
                <Skeleton variant="rounded" height={128} />
              ) : (
                <AutoTradingToggle
                  currentStatus={
                    systemConfig?.autoTradingSystemEnabled ?? false
                  }
                  onToggle={toggleAutoTrading}
                />
              )}

              <Box
                sx={{ mt: 4, p: 2, bgcolor: "action.hover", borderRadius: 1 }}
              >
                <Typography
                  variant="subtitle2"
                  component="h3"
                  color="text.secondary"
                  textTransform="uppercase"
                  gutterBottom
                >
                  Live News Feed
                </Typography>
                <Box sx={{ mb: 2, display: "flex", gap: 1 }}>
                  {["all", "relevant", "ignored"].map((filter) => (
                    <Chip
                      key={filter}
                      label={filter}
                      size="small"
                      onClick={() => setActiveFilter(filter)}
                      color={activeFilter === filter ? "primary" : "default"}
                    />
                  ))}
                </Box>
                <Box
                  sx={{
                    maxHeight: 256,
                    overflowY: "auto",
                    pr: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                  }}
                >
                  {newsFeed.length === 0 ? (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      fontStyle="italic"
                      textAlign="center"
                      py={2}
                    >
                      Waiting for news events...
                    </Typography>
                  ) : (
                    newsFeed.map((news: NewsEvent) => (
                      <Card key={news.id} variant="outlined">
                        <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                          <Typography
                            variant="caption"
                            fontWeight="bold"
                            color="primary.main"
                          >
                            {news.source}
                          </Typography>
                          <Typography variant="body2" mt={0.5}>
                            {news.title}
                          </Typography>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </Box>
              </Box>
            </Grid>
          </Grid>
        )}
      </Container>
    </Box>
  );
}
