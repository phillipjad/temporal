import { createTheme } from "@mui/material/styles";

export const lightTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#aa3bff" },
    background: { default: "#fff", paper: "#f4f3ec" },
    text: { primary: "#08060d", secondary: "#6b6375" },
    divider: "#e5e4e7",
  },
  typography: {
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
  },
});

export const darkTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#aa3bff" },
    background: { default: "#16171d", paper: "#1e1f27" },
    text: { primary: "#f3f4f6", secondary: "#9ca3af" },
    divider: "#2e303a",
  },
  typography: {
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
  },
});
