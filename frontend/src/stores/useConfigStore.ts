import { create } from "zustand";

interface ConfigState {
  // Client-side only state according to AGENTS.md Section 7.3
  uiVisibility: boolean;
  activeFilter: string;
  colorMode: "light" | "dark";
  setUiVisibility: (visible: boolean) => void;
  setActiveFilter: (filter: string) => void;
  setColorMode: (mode: "light" | "dark") => void;
}

export const useConfigStore = create<ConfigState>()((set) => ({
  uiVisibility: true,
  activeFilter: "all",
  colorMode: (typeof window !== "undefined" && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? "dark" : "light",
  setUiVisibility: (visible) => set({ uiVisibility: visible }),
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  setColorMode: (mode) => set({ colorMode: mode }),
}));
