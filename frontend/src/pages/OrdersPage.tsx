import { Box, Typography, Alert } from "@mui/material";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";

export function OrdersPage() {
  return (
    <div className="flex flex-col gap-6">
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Orders
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Full order history with filter controls
        </Typography>
      </Box>

      <Alert
        icon={<ReceiptLongIcon />}
        severity="info"
        sx={{ borderRadius: 2 }}
      >
        Order history will be populated once the trading engine is connected.
        All executed and simulated orders will appear here with full audit
        trail.
      </Alert>

      <Box
        className="flex flex-col items-center justify-center py-20 rounded-lg"
        sx={{ border: "1px dashed", borderColor: "divider" }}
      >
        <ReceiptLongIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
        <Typography variant="body2" color="text.disabled">
          No orders yet
        </Typography>
        <Typography variant="caption" color="text.disabled">
          Orders will appear here once the engine starts trading
        </Typography>
      </Box>
    </div>
  );
}
