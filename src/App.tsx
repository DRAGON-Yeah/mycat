import { useEffect } from "react";
import { AppShell } from "./shell/AppShell";
import { ConfirmHost } from "./components/ConfirmHost";
import {
  startAutomationScheduler,
  stopAutomationScheduler,
} from "./features/automation/automationRunner";
import { useUiStore } from "./stores/uiStore";
import "./App.css";
import "./styles/features.css";

function App() {
  const hydrate = useUiStore((s) => s.hydrate);
  const hydrated = useUiStore((s) => s.hydrated);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    startAutomationScheduler();
    return () => stopAutomationScheduler();
  }, []);

  if (!hydrated) {
    return <div className="boot">加载中…</div>;
  }

  return (
    <>
      <AppShell />
      <ConfirmHost />
    </>
  );
}

export default App;
