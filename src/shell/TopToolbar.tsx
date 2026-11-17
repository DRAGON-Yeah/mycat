import catLogo from "../assets/cat-logo.png";
import { ThemeToggle } from "../features/settings/ThemeToggle";
import {
  useUiStore,
  type LayoutSizes,
} from "../stores/uiStore";
import {
  useWorkspaceStore,
  type ToolbarAction,
} from "../stores/workspaceStore";
import { ToolbarIcon } from "./ToolbarIcons";

type Item = {
  id: ToolbarAction;
  label: string;
};

const ITEMS: Item[] = [
  { id: "connection", label: "连接" },
  { id: "table", label: "表" },
  { id: "view", label: "视图" },
  { id: "function", label: "函数" },
  { id: "query", label: "查询" },
  { id: "backup", label: "备份" },
  { id: "automation", label: "自动化" },
  { id: "model", label: "模型" },
  { id: "bi", label: "BI" },
];

/** 面板收起图标：圆角方框 + 左侧/底部/右侧实心条 */
function PanelIcon({ side }: { side: "left" | "bottom" | "right" }) {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden>
      <rect
        x="2.5"
        y="3.5"
        width="15"
        height="13"
        rx="2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {side === "left" && (
        <rect x="3.6" y="4.6" width="4.2" height="10.8" rx="1.3" fill="currentColor" />
      )}
      {side === "bottom" && (
        <rect x="3.6" y="12.2" width="12.8" height="3.2" rx="1.3" fill="currentColor" />
      )}
      {side === "right" && (
        <rect x="12.2" y="4.6" width="4.2" height="10.8" rx="1.3" fill="currentColor" />
      )}
    </svg>
  );
}

function PanelToggles({
  layout,
  onToggleTree,
  onToggleBottom,
  onToggleInspector,
}: {
  layout: LayoutSizes;
  onToggleTree: () => void;
  onToggleBottom: () => void;
  onToggleInspector: () => void;
}) {
  const items = [
    {
      key: "tree",
      side: "left" as const,
      collapsed: layout.treeCollapsed,
      label: "左侧面板",
      onClick: onToggleTree,
    },
    {
      key: "bottom",
      side: "bottom" as const,
      collapsed: layout.bottomCollapsed,
      label: "下方面板",
      onClick: onToggleBottom,
    },
    {
      key: "inspector",
      side: "right" as const,
      collapsed: layout.inspectorCollapsed,
      label: "右侧面板",
      onClick: onToggleInspector,
    },
  ];
  return (
    <div className="panel-toggles" role="group" aria-label="面板显示">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`panel-toggle-btn ${item.collapsed ? "is-collapsed" : ""}`}
          title={`${item.collapsed ? "展开" : "收起"}${item.label}`}
          aria-label={`${item.collapsed ? "展开" : "收起"}${item.label}`}
          aria-pressed={item.collapsed}
          onClick={item.onClick}
        >
          <PanelIcon side={item.side} />
        </button>
      ))}
    </div>
  );
}

export function TopToolbar() {
  const toolbarAction = useWorkspaceStore((s) => s.toolbarAction);
  const centerMode = useWorkspaceStore((s) => s.centerMode);
  const setToolbarAction = useWorkspaceStore((s) => s.setToolbarAction);
  const openConsole = useWorkspaceStore((s) => s.openConsole);
  const layout = useUiStore((s) => s.layout);
  const toggleTree = useUiStore((s) => s.toggleTree);
  const toggleInspector = useUiStore((s) => s.toggleInspector);
  const toggleBottom = useUiStore((s) => s.toggleBottom);

  return (
    <header className="top-toolbar" aria-label="主工具栏">
      <div className="top-toolbar-brand">
        <img className="brand-mark" src={catLogo} alt="" />
        <span className="brand-text">Mycat</span>
      </div>
      <nav className="top-toolbar-items">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`toolbar-item ${toolbarAction === item.id && centerMode !== "console" ? "is-active" : ""}`}
            onClick={() => setToolbarAction(item.id)}
          >
            <ToolbarIcon id={item.id} />
            <span className="toolbar-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="top-toolbar-actions">
        <PanelToggles
          layout={layout}
          onToggleTree={toggleTree}
          onToggleBottom={toggleBottom}
          onToggleInspector={toggleInspector}
        />
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className={`toolbar-item ${centerMode === "console" ? "is-active" : ""}`}
          onClick={() => openConsole()}
        >
          <ToolbarIcon id="console" />
          <span className="toolbar-label">Console</span>
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
