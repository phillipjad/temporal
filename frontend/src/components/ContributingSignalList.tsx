import { Box, Typography, List, ListItem, Divider } from "@mui/material";

export interface Signal {
  id: string;
  timestamp: string;
  source: string;
  impact: number;
  textSnippet: string;
}

interface ContributingSignalListProps {
  signals: Signal[];
}

export function ContributingSignalList({
  signals,
}: ContributingSignalListProps) {
  return (
    <Box
      sx={{
        mt: 3,
        p: 2,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
      }}
    >
      <Typography variant="h6" gutterBottom>
        Contributing Signals
      </Typography>
      {signals.length === 0 ? (
        <Typography color="text.secondary">No recent signals.</Typography>
      ) : (
        <List disablePadding>
          {signals.map((signal, index) => (
            <div key={signal.id}>
              <ListItem
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  py: 1,
                  px: 0,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    width: "100%",
                    mb: 0.5,
                  }}
                >
                  <Typography variant="subtitle2" fontWeight="bold">
                    {signal.source}
                  </Typography>
                  <Typography
                    variant="subtitle2"
                    fontWeight="bold"
                    color={
                      signal.impact > 0
                        ? "success.main"
                        : signal.impact < 0
                          ? "error.main"
                          : "text.secondary"
                    }
                  >
                    {signal.impact > 0 ? "+" : ""}
                    {signal.impact.toFixed(2)}
                  </Typography>
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mb: 0.5 }}
                >
                  {signal.timestamp}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  fontStyle="italic"
                >
                  "{signal.textSnippet}"
                </Typography>
              </ListItem>
              {index < signals.length - 1 && <Divider />}
            </div>
          ))}
        </List>
      )}
    </Box>
  );
}
