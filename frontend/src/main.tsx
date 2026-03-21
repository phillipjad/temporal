import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import "./index.css";
import App from "./App.tsx";
import { lightTheme, darkTheme } from "./lib/theme.ts";
import { useConfigStore } from "./stores/useConfigStore.ts";

const queryClient = new QueryClient();

export function RootApp() {
  const colorMode = useConfigStore((state) => state.colorMode);
  const currentTheme = colorMode === "dark" ? darkTheme : lightTheme;

  return (
    <ThemeProvider theme={currentTheme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RootApp />
    </QueryClientProvider>
  </StrictMode>
);
