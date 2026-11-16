import { create } from "zustand";
import { getSetting, setSetting } from "../lib/tauri";

export type ThemeMode = "light" | "dark";

type UiState = {
  theme: ThemeMode;
  hydrated: boolean;
  setTheme: (theme: ThemeMode) => Promise<void>;
  hydrate: () => Promise<void>;
};

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
}

export const useUiStore = create<UiState>((set) => ({
  theme: "light",
  hydrated: false,
  hydrate: async () => {
    try {
      const saved = await getSetting("theme");
      const theme: ThemeMode = saved === "dark" ? "dark" : "light";
      applyTheme(theme);
      set({ theme, hydrated: true });
    } catch {
      applyTheme("light");
      set({ theme: "light", hydrated: true });
    }
  },
  setTheme: async (theme) => {
    applyTheme(theme);
    set({ theme });
    await setSetting("theme", theme);
  },
}));
