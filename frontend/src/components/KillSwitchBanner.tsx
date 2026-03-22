import { Alert, AlertTitle, Button } from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useConfigStore } from "../stores/useConfigStore";

export function KillSwitchBanner() {
  const { killSwitchActive, setKillSwitchActive } = useConfigStore();

  if (!killSwitchActive) return null;

  return (
    <Alert
      severity="error"
      icon={<WarningAmberIcon />}
      action={
        <Button
          color="inherit"
          size="small"
          variant="outlined"
          onClick={() => setKillSwitchActive(false)}
          sx={{ whiteSpace: "nowrap" }}
        >
          Dismiss
        </Button>
      }
      sx={{
        borderRadius: 0,
        borderBottom: 1,
        borderColor: "error.dark",
        "& .MuiAlert-message": { width: "100%" },
      }}
    >
      <AlertTitle sx={{ fontWeight: 700 }}>Kill Switch Active</AlertTitle>
      All automated order submission is halted. No new orders will be placed
      until the kill switch is cleared from the Admin panel.
    </Alert>
  );
}
