import { useUiStore } from "../../stores/uiStore";

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="切换主题"
    >
      {theme === "dark" ? "浅色" : "深色"}
    </button>
  );
}
