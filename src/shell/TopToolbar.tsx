import { ThemeToggle } from "../features/settings/ThemeToggle";
import {
  useWorkspaceStore,
  type ToolbarAction,
} from "../stores/workspaceStore";

type Item = {
  id: ToolbarAction;
  label: string;
  placeholder?: string;
};

const ITEMS: Item[] = [
  { id: "connection", label: "连接" },
  { id: "user", label: "用户", placeholder: "user" },
  { id: "table", label: "表" },
  { id: "view", label: "视图", placeholder: "view" },
  { id: "function", label: "函数", placeholder: "function" },
  { id: "query", label: "查询" },
  { id: "backup", label: "备份", placeholder: "backup" },
  { id: "automation", label: "自动化", placeholder: "automation" },
  { id: "model", label: "模型", placeholder: "model" },
  { id: "bi", label: "BI", placeholder: "bi" },
];

export function TopToolbar() {
  const toolbarAction = useWorkspaceStore((s) => s.toolbarAction);
  const setToolbarAction = useWorkspaceStore((s) => s.setToolbarAction);
  const setCenterMode = useWorkspaceStore((s) => s.setCenterMode);

  return (
    <header className="top-toolbar" aria-label="主工具栏">
      <div className="top-toolbar-brand">My Navicat</div>
      <nav className="top-toolbar-items">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`toolbar-item ${toolbarAction === item.id ? "is-active" : ""} ${item.placeholder ? "is-soft" : ""}`}
            onClick={() => {
              if (item.id === "query") {
                setToolbarAction("query");
                return;
              }
              if (item.placeholder) {
                setToolbarAction(item.id, item.placeholder);
                return;
              }
              setToolbarAction(item.id);
              if (item.id === "connection") setCenterMode("welcome");
            }}
          >
            <span className="toolbar-icon" aria-hidden>
              {item.label.slice(0, 1)}
            </span>
            <span className="toolbar-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="top-toolbar-actions">
        <button
          type="button"
          className="toolbar-item"
          onClick={() => setCenterMode("console")}
        >
          <span className="toolbar-label">Console</span>
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
