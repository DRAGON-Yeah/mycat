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
  const { treeCollapsed, inspectorCollapsed } = layout;

  // 收起面板时同时移除对应的网格轨道，保证列与渲染的子元素一一对应
  const columns = [
    ...(treeCollapsed ? [] : [`${layout.treeWidth}px`, "5px"]),
    "1fr",
    ...(inspectorCollapsed ? [] : ["5px", `${layout.inspectorWidth}px`]),
  ].join(" ");

  return (
    <div className="app-shell navicat-shell">
      <TopToolbar />
      <div
        className={`app-body navicat-body ${treeCollapsed ? "is-tree-collapsed" : ""} ${inspectorCollapsed ? "is-inspector-collapsed" : ""}`}
        style={{ gridTemplateColumns: columns }}
      >
        {!treeCollapsed && <ConnectionTree />}
        {!treeCollapsed && (
          <Splitter
            orientation="vertical"
            title="拖动调整左侧宽度"
            onDrag={bumpTreeWidth}
          />
        )}
        <MainWorkspace />
        {!inspectorCollapsed && (
          <Splitter
            orientation="vertical"
            title="拖动调整右侧宽度"
            onDrag={bumpInspectorWidth}
          />
        )}
        {!inspectorCollapsed && <InspectorPane />}
      </div>
    </div>
  );
}
