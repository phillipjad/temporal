import { create } from "zustand";

export type ActivePage =
  | "dashboard"
  | "markets"
  | "orders"
  | "settings"
  | "admin";

interface ConfigState {
  // Client-side only state according to AGENTS.md Section 7.3
  activePage: ActivePage;
  activeFilter: string;
  colorMode: "light" | "dark";
  killSwitchActive: boolean;
  setActivePage: (page: ActivePage) => void;
  setActiveFilter: (filter: string) => void;
  setColorMode: (mode: "light" | "dark") => void;
  setKillSwitchActive: (active: boolean) => void;
}

export const useConfigStore = create<ConfigState>()((set) => ({
  activePage: "dashboard",
  activeFilter: "all",
  colorMode:
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  killSwitchActive: false,
  setActivePage: (page) => set({ activePage: page }),
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  setColorMode: (mode) => set({ colorMode: mode }),
  setKillSwitchActive: (active) => set({ killSwitchActive: active }),
}));
