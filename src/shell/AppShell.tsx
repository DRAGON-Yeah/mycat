import { ConnectionTree } from "../features/nav-tree/ConnectionTree";
import { InspectorPane } from "../features/inspector/InspectorPane";
import { useUiStore } from "../stores/uiStore";
import { MainWorkspace } from "./MainWorkspace";
import { Splitter } from "./Splitter";
import { TopToolbar } from "./TopToolbar";

export function AppShell() {
  const bumpTreeWidth = useUiStore((s) => s.bumpTreeWidth);
  const bumpInspectorWidth = useUiStore((s) => s.bumpInspectorWidth);
  const layout = useUiStore((s) => s.layout);

  return (
    <div className="app-shell navicat-shell">
      <TopToolbar />
      <div
        className="app-body navicat-body"
        style={{
          gridTemplateColumns: `${layout.treeWidth}px 5px 1fr 5px ${layout.inspectorWidth}px`,
        }}
      >
        <ConnectionTree />
        <Splitter
          orientation="vertical"
          title="拖动调整左侧宽度"
          onDrag={bumpTreeWidth}
        />
        <MainWorkspace />
        <Splitter
          orientation="vertical"
          title="拖动调整右侧宽度"
          onDrag={bumpInspectorWidth}
        />
        <InspectorPane />
      </div>
    </div>
  );
}
