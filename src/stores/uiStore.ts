import { create } from "zustand";
import { getSetting, setSetting } from "../lib/tauri";

export type ThemeMode = "light" | "dark";

export type LayoutSizes = {
  treeWidth: number;
  inspectorWidth: number;
  /** Query editor share of the editor+result split (0.2–0.85). */
  queryEditorRatio: number;
};

const LAYOUT_KEY = "my-navicat.layout";

const DEFAULT_LAYOUT: LayoutSizes = {
  treeWidth: 268,
  inspectorWidth: 236,
  queryEditorRatio: 0.55,
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function loadLayout(): LayoutSizes {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<LayoutSizes>;
    return {
      treeWidth: clamp(parsed.treeWidth ?? DEFAULT_LAYOUT.treeWidth, 160, 560),
      inspectorWidth: clamp(
        parsed.inspectorWidth ?? DEFAULT_LAYOUT.inspectorWidth,
        160,
        480,
      ),
      queryEditorRatio: clamp(
        parsed.queryEditorRatio ?? DEFAULT_LAYOUT.queryEditorRatio,
        0.2,
        0.85,
      ),
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function saveLayout(layout: LayoutSizes) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
}

function applyLayoutCss(layout: LayoutSizes) {
  const root = document.documentElement;
  root.style.setProperty("--tree-width", `${layout.treeWidth}px`);
  root.style.setProperty("--inspector-width", `${layout.inspectorWidth}px`);
  root.style.setProperty(
    "--query-editor-ratio",
    String(layout.queryEditorRatio),
  );
}

type UiState = {
  theme: ThemeMode;
  hydrated: boolean;
  layout: LayoutSizes;
  setTheme: (theme: ThemeMode) => Promise<void>;
  hydrate: () => Promise<void>;
  setTreeWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
  setQueryEditorRatio: (ratio: number) => void;
  bumpTreeWidth: (delta: number) => void;
  bumpInspectorWidth: (delta: number) => void;
  bumpQueryEditorRatioByPx: (deltaPx: number, containerHeight: number) => void;
};

export const useUiStore = create<UiState>((set, get) => ({
  theme: "light",
  hydrated: false,
  layout: loadLayout(),
  hydrate: async () => {
    const layout = loadLayout();
    applyLayoutCss(layout);
    try {
      const saved = await getSetting("theme");
      const theme: ThemeMode = saved === "dark" ? "dark" : "light";
      applyTheme(theme);
      set({ theme, hydrated: true, layout });
    } catch {
      applyTheme("light");
      set({ theme: "light", hydrated: true, layout });
    }
  },
  setTheme: async (theme) => {
    applyTheme(theme);
    set({ theme });
    await setSetting("theme", theme);
  },
  setTreeWidth: (width) => {
    const layout = {
      ...get().layout,
      treeWidth: clamp(width, 160, 560),
    };
    applyLayoutCss(layout);
    saveLayout(layout);
    set({ layout });
  },
  setInspectorWidth: (width) => {
    const layout = {
      ...get().layout,
      inspectorWidth: clamp(width, 160, 480),
    };
    applyLayoutCss(layout);
    saveLayout(layout);
    set({ layout });
  },
  setQueryEditorRatio: (ratio) => {
    const layout = {
      ...get().layout,
      queryEditorRatio: clamp(ratio, 0.2, 0.85),
    };
    applyLayoutCss(layout);
    saveLayout(layout);
    set({ layout });
  },
  bumpTreeWidth: (delta) => {
    get().setTreeWidth(get().layout.treeWidth + delta);
  },
  bumpInspectorWidth: (delta) => {
    // Dragging the right splitter: moving right grows center / shrinks inspector
    get().setInspectorWidth(get().layout.inspectorWidth - delta);
  },
  bumpQueryEditorRatioByPx: (deltaPx, containerHeight) => {
    if (containerHeight <= 0) return;
    const next =
      get().layout.queryEditorRatio + deltaPx / containerHeight;
    get().setQueryEditorRatio(next);
  },
}));

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
}
