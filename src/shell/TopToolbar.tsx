import catLogo from "../assets/cat-logo.png";
import { ThemeToggle } from "../features/settings/ThemeToggle";
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

export function TopToolbar() {
  const toolbarAction = useWorkspaceStore((s) => s.toolbarAction);
  const centerMode = useWorkspaceStore((s) => s.centerMode);
  const setToolbarAction = useWorkspaceStore((s) => s.setToolbarAction);
  const openConsole = useWorkspaceStore((s) => s.openConsole);

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
