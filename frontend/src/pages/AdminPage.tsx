import { Box, Typography, Alert, Grid, Paper } from "@mui/material";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import PeopleIcon from "@mui/icons-material/People";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import MemoryIcon from "@mui/icons-material/Memory";
import { useConfigStore } from "../stores/useConfigStore";
import { Button } from "@mui/material";

function AdminPanel({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, opacity: 0.7 }}>
      <Box className="flex items-center gap-3 mb-2">
        <Box sx={{ color: "primary.main" }}>{icon}</Box>
        <Typography variant="subtitle1" fontWeight={700}>
          {title}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
    </Paper>
  );
}

export function AdminPage() {
  const { setKillSwitchActive, killSwitchActive } = useConfigStore();

  return (
    <div className="flex flex-col gap-6">
      <Box className="flex items-center gap-3">
        <AdminPanelSettingsIcon sx={{ color: "primary.main" }} />
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Admin Panel
          </Typography>
          <Typography variant="body2" color="text.secondary">
            System management — role-gated: admin only
          </Typography>
        </Box>
      </Box>

      <Alert severity="warning" sx={{ borderRadius: 2 }}>
        This panel is role-gated. Full functionality requires admin role
        authentication. Controls shown here are scaffolded per Architecture
        §13.4.
      </Alert>

      {/* Kill switch control */}
      <Paper
        variant="outlined"
        sx={{
          p: 3,
          borderRadius: 2,
          borderColor: killSwitchActive ? "error.main" : "divider",
          bgcolor: killSwitchActive ? "error.main" + "10" : "background.paper",
        }}
      >
        <Typography variant="subtitle1" fontWeight={700} mb={0.5}>
          Kill Switch
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Immediately halts all automated order submission across the system.
          Affects all users and all markets. Takes effect within one
          confidence-check cycle (~100ms).
        </Typography>
        <Button
          variant="contained"
          color={killSwitchActive ? "success" : "error"}
          onClick={() => setKillSwitchActive(!killSwitchActive)}
        >
          {killSwitchActive ? "Clear Kill Switch" : "Activate Kill Switch"}
        </Button>
      </Paper>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <AdminPanel
            icon={<PeopleIcon />}
            title="User Management"
            description="Full CRUD for user accounts. Assign roles, reset passwords, revoke sessions."
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <AdminPanel
            icon={<MonitorHeartIcon />}
            title="System Status"
            description="Goroutine counts, worker queue depths, Redis health, sidecar model version."
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <AdminPanel
            icon={<MemoryIcon />}
            title="Model Reload"
            description="Trigger a hot-swap of the FinBERT ONNX model on the ML sidecar without downtime."
          />
        </Grid>
      </Grid>
    </div>
  );
}
