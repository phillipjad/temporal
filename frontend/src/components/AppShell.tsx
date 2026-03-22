import { useState } from "react";
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  IconButton,
  Divider,
  Tooltip,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import StorefrontIcon from "@mui/icons-material/Storefront";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SettingsIcon from "@mui/icons-material/Settings";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import NightlightIcon from "@mui/icons-material/Nightlight";
import LightModeIcon from "@mui/icons-material/LightMode";
import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import BoltIcon from "@mui/icons-material/Bolt";
import { useColorMode } from "../hooks/useColorMode";
import { useConfigStore, type ActivePage } from "../stores/useConfigStore";
import { KillSwitchBanner } from "./KillSwitchBanner";
import { DashboardPage } from "../pages/DashboardPage";
import { MarketsPage } from "../pages/MarketsPage";
import { OrdersPage } from "../pages/OrdersPage";
import { SettingsPage } from "../pages/SettingsPage";
import { AdminPage } from "../pages/AdminPage";

const SIDEBAR_EXPANDED = "13.75rem";
const SIDEBAR_COLLAPSED = "4rem";

interface NavItem {
  id: ActivePage;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: <DashboardIcon fontSize="small" />,
  },
  {
    id: "markets",
    label: "Markets",
    icon: <StorefrontIcon fontSize="small" />,
  },
  { id: "orders", label: "Orders", icon: <ReceiptLongIcon fontSize="small" /> },
  {
    id: "settings",
    label: "Settings",
    icon: <SettingsIcon fontSize="small" />,
  },
  {
    id: "admin",
    label: "Admin",
    icon: <AdminPanelSettingsIcon fontSize="small" />,
  },
];

function renderPage(page: ActivePage) {
  switch (page) {
    case "dashboard":
      return <DashboardPage />;
    case "markets":
      return <MarketsPage />;
    case "orders":
      return <OrdersPage />;
    case "settings":
      return <SettingsPage />;
    case "admin":
      return <AdminPage />;
  }
}

export function AppShell() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [expanded, setExpanded] = useState(!isMobile);
  const [mobileOpen, setMobileOpen] = useState(false);

  const { colorMode, toggleColorMode } = useColorMode();
  const { activePage, setActivePage } = useConfigStore();

  const drawerWidth = expanded ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED;

  const handleNavClick = (page: ActivePage) => {
    setActivePage(page);
    if (isMobile) setMobileOpen(false);
  };

  const sidebarContent = (
    <Box
      className="flex flex-col h-full"
      sx={{
        bgcolor: "background.paper",
        width: drawerWidth,
        transition: "width 0.2s",
      }}
    >
      {/* Logo */}
      <Box
        className="flex items-center px-4"
        sx={{
          height: "3.5rem",
          borderBottom: "1px solid",
          borderColor: "divider",
          gap: expanded ? 1.5 : 0,
          justifyContent: expanded ? "flex-start" : "center",
        }}
      >
        <BoltIcon sx={{ color: "primary.main", fontSize: 22, flexShrink: 0 }} />
        {expanded && (
          <Typography
            variant="subtitle1"
            fontWeight={800}
            noWrap
            sx={{ color: "text.primary" }}
          >
            Temporal AI
          </Typography>
        )}
      </Box>

      {/* Nav items */}
      <List disablePadding sx={{ flex: 1, pt: 1 }}>
        {NAV_ITEMS.map((item) => {
          const active = activePage === item.id;
          return (
            <Tooltip
              key={item.id}
              title={expanded ? "" : item.label}
              placement="right"
            >
              <ListItemButton
                onClick={() => handleNavClick(item.id)}
                selected={active}
                sx={{
                  mx: 1,
                  mb: 0.5,
                  borderRadius: 1.5,
                  minHeight: 40,
                  px: expanded ? 2 : 1.5,
                  justifyContent: expanded ? "flex-start" : "center",
                  "&.Mui-selected": {
                    bgcolor: "primary.main" + "18",
                    color: "primary.main",
                    "& .MuiListItemIcon-root": { color: "primary.main" },
                  },
                  "&.Mui-selected:hover": {
                    bgcolor: "primary.main" + "28",
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: expanded ? 36 : "auto",
                    color: active ? "primary.main" : "text.secondary",
                    justifyContent: "center",
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                {expanded && (
                  <ListItemText
                    primary={item.label}
                    slotProps={{
                      primary: {
                        variant: "body2",
                        fontWeight: active ? 700 : 500,
                      },
                    }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          );
        })}
      </List>

      <Divider />

      {/* Bottom controls */}
      <Box
        className="flex items-center px-2 py-2"
        sx={{ justifyContent: expanded ? "space-between" : "center", gap: 1 }}
      >
        <Tooltip title={colorMode === "light" ? "Dark mode" : "Light mode"}>
          <IconButton onClick={toggleColorMode} size="small">
            {colorMode === "light" ? (
              <NightlightIcon fontSize="small" />
            ) : (
              <LightModeIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        {expanded && (
          <Tooltip title="Collapse sidebar">
            <IconButton onClick={() => setExpanded(false)} size="small">
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );

  return (
    <Box
      className="flex h-screen overflow-hidden"
      sx={{ bgcolor: "background.default" }}
    >
      {/* Desktop permanent sidebar */}
      {!isMobile && (
        <Drawer
          variant="permanent"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            transition: "width 0.2s",
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              boxSizing: "border-box",
              borderRight: "1px solid",
              borderColor: "divider",
              overflow: "hidden",
              transition: "width 0.2s",
            },
          }}
        >
          {sidebarContent}
        </Drawer>
      )}

      {/* Mobile temporary drawer */}
      {isMobile && (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          sx={{
            "& .MuiDrawer-paper": {
              width: SIDEBAR_EXPANDED,
              boxSizing: "border-box" as const,
            },
          }}
        >
          {sidebarContent}
        </Drawer>
      )}

      {/* Main area */}
      <Box className="flex flex-col flex-1 overflow-hidden">
        {/* Top bar */}
        <Box
          className="flex items-center justify-between px-4"
          sx={{
            height: "3.5rem",
            borderBottom: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            flexShrink: 0,
          }}
        >
          <Box className="flex items-center gap-3">
            {isMobile && (
              <IconButton
                onClick={() => setMobileOpen(true)}
                size="small"
                edge="start"
              >
                <MenuIcon fontSize="small" />
              </IconButton>
            )}
            {!isMobile && !expanded && (
              <Tooltip title="Expand sidebar">
                <IconButton onClick={() => setExpanded(true)} size="small">
                  <MenuIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textTransform: "capitalize" }}
            >
              {activePage}
            </Typography>
          </Box>
        </Box>

        {/* Kill switch banner */}
        <KillSwitchBanner />

        {/* Page content */}
        <Box className="flex-1 overflow-auto p-6">{renderPage(activePage)}</Box>
      </Box>
    </Box>
  );
}
