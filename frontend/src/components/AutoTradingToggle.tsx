import { useState } from "react";
import { Box, Typography, Button, TextField, Paper } from "@mui/material";

const CONFIRM_PHRASE = "I understand the risks of real money trading";

interface Props {
  currentStatus: boolean;
  onToggle: (status: boolean) => void;
}

export function AutoTradingToggle({ currentStatus, onToggle }: Props) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [inputText, setInputText] = useState("");

  const handleStartEnable = () => {
    setIsConfirming(true);
    setInputText("");
  };

  const handleConfirm = () => {
    if (inputText === CONFIRM_PHRASE) {
      onToggle(true);
      setIsConfirming(false);
    }
  };

  const handleDisable = () => {
    onToggle(false);
    setIsConfirming(false);
  };

  if (currentStatus) {
    return (
      <Paper variant="outlined" sx={{ p: 2, borderColor: "error.main", bgcolor: "error.light" }}>
        <Typography variant="subtitle1" fontWeight="bold" color="error.dark">
          Auto-Trading is LIVE
        </Typography>
        <Typography variant="body2" color="error.main" mb={2}>
          Real orders will be executed on Kalshi.
        </Typography>
        <Button variant="contained" color="error" onClick={handleDisable}>
          Disable Auto-Trading
        </Button>
      </Paper>
    );
  }

  if (isConfirming) {
    return (
      <Paper variant="outlined" sx={{ p: 2, borderColor: "warning.main", bgcolor: "warning.light" }}>
        <Typography variant="body2" color="warning.dark" mb={2}>
          Type exactly <Box component="strong" sx={{ fontWeight: 'bold' }}>{`"${CONFIRM_PHRASE}"`}</Box> to enable live auto-trading.
        </Typography>
        <TextField
          fullWidth
          size="small"
          variant="outlined"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
          sx={{ mb: 2, bgcolor: "background.paper" }}
          data-testid="confirm-input"
        />
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="contained"
            color="success"
            disabled={inputText !== CONFIRM_PHRASE}
            onClick={handleConfirm}
          >
            Confirm & Enable
          </Button>
          <Button variant="outlined" color="inherit" onClick={() => setIsConfirming(false)}>
            Cancel
          </Button>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight="bold" color="text.secondary">
        Auto-Trading is DISABLED
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        You are currently in simulated paper-trading mode.
      </Typography>
      <Button variant="contained" color="primary" onClick={handleStartEnable}>
        Enable Auto-Trading
      </Button>
    </Paper>
  );
}
