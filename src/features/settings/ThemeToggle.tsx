import { useUiStore } from "../../stores/uiStore";

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "切换到深色主题" : "切换到浅色主题";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(next)}
      title={label}
      aria-label={label}
    >
      <span aria-hidden>{theme === "dark" ? "🌛" : "☀️"}</span>
    </button>
  );
}
