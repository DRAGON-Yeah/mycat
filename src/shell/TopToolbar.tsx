import { ThemeToggle } from "../features/settings/ThemeToggle";
import {
  useWorkspaceStore,
  type ToolbarAction,
} from "../stores/workspaceStore";
import { ToolbarIcon } from "./ToolbarIcons";

type Item = {
  id: ToolbarAction;
  label: string;
  placeholder?: string;
};

const ITEMS: Item[] = [
  { id: "connection", label: "连接" },
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
  const centerMode = useWorkspaceStore((s) => s.centerMode);
  const setToolbarAction = useWorkspaceStore((s) => s.setToolbarAction);
  const setCenterMode = useWorkspaceStore((s) => s.setCenterMode);

  return (
    <header className="top-toolbar" aria-label="主工具栏">
      <div className="top-toolbar-brand">
        <span className="brand-mark">M</span>
        <span className="brand-text">Mycat</span>
      </div>
      <nav className="top-toolbar-items">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`toolbar-item ${toolbarAction === item.id && centerMode !== "console" ? "is-active" : ""} ${item.placeholder ? "is-soft" : ""}`}
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
            <ToolbarIcon id={item.id} />
            <span className="toolbar-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="top-toolbar-actions">
        <button
          type="button"
          className={`toolbar-item ${centerMode === "console" ? "is-active" : ""}`}
          onClick={() => setCenterMode("console")}
        >
          <ToolbarIcon id="console" />
          <span className="toolbar-label">Console</span>
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
