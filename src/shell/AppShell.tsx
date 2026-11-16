import { ConnectionTree } from "../features/nav-tree/ConnectionTree";
import { InspectorPane } from "../features/inspector/InspectorPane";
import { MainWorkspace } from "./MainWorkspace";
import { TopToolbar } from "./TopToolbar";

export function AppShell() {
  return (
    <div className="app-shell navicat-shell">
      <TopToolbar />
      <div className="app-body navicat-body">
        <ConnectionTree />
        <MainWorkspace />
        <InspectorPane />
      </div>
    </div>
  );
}
