import { useEffect } from "react";
import { AppShell } from "./shell/AppShell";
import { useUiStore } from "./stores/uiStore";
import "./App.css";

function App() {
  const hydrate = useUiStore((s) => s.hydrate);
  const hydrated = useUiStore((s) => s.hydrated);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return <div className="boot">加载中…</div>;
  }

  return <AppShell />;
}

export default App;
