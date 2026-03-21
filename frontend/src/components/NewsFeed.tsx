import { Box, Typography, Card, CardContent, Chip, Stack } from "@mui/material";
import type { components } from "../lib/api.types";

type NewsEvent = components["schemas"]["NewsEvent"];

export function NewsFeed({ news }: { news: NewsEvent[] }) {
  return (
    <Box>
      <Typography variant="h5" component="h2" fontWeight="medium" mb={2}>
        Live News Feed
      </Typography>
      {news.length === 0 ? (
        <Box
          sx={{
            p: 2,
            borderRadius: 1,
            border: "1px dashed",
            borderColor: "divider",
            color: "text.secondary",
          }}
        >
          Waiting for news events...
        </Box>
      ) : (
        <Stack spacing={2}>
          {news.map((item, idx) => (
            <Card key={`${item.id}-${idx}`} variant="outlined">
              <CardContent sx={{ pb: "16px !important" }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                  <Chip label={item.source} size="small" variant="outlined" />
                  <Typography variant="caption" color="text.secondary">
                    Just now
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight="medium">
                  {item.title}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}
