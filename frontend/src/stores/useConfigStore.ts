import { create } from "zustand";

interface ConfigState {
  // Client-side only state according to AGENTS.md Section 7.3
  uiVisibility: boolean;
  activeFilter: string;
  setUiVisibility: (visible: boolean) => void;
  setActiveFilter: (filter: string) => void;
}

export const useConfigStore = create<ConfigState>()((set) => ({
  uiVisibility: true,
  activeFilter: "all",
  setUiVisibility: (visible) => set({ uiVisibility: visible }),
  setActiveFilter: (filter) => set({ activeFilter: filter }),
}));
