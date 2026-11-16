import { useEffect, useState } from "react";
import { ConnectionNav } from "./features/connections/ConnectionNav";
import { DataGrid } from "./features/data-grid/DataGrid";
import { ObjectTree } from "./features/object-tree/ObjectTree";
import { ConsolePanel } from "./features/query/Console";
import { QueryEditor } from "./features/query/QueryEditor";
import { ThemeToggle } from "./features/settings/ThemeToggle";
import { useUiStore } from "./stores/uiStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import "./App.css";

type ToolTab = "welcome" | "query" | "console" | "table";

function App() {
  const hydrate = useUiStore((s) => s.hydrate);
  const hydrated = useUiStore((s) => s.hydrated);
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const [tool, setTool] = useState<ToolTab>("welcome");

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (activeTabId) setTool("table");
  }, [activeTabId]);

  if (!hydrated) {
    return <div className="boot">加载中…</div>;
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">My Navicat</div>
        <ThemeToggle />
      </header>
      <div className="app-body">
        <ConnectionNav />
        <ObjectTree connection={activeConnection} />
        <main className="pane workspace" aria-label="工作区">
          <div className="workspace-tabs">
            <div
              className={`tab ${tool === "welcome" && !activeTab ? "active" : ""}`}
            >
              <button
                type="button"
                onClick={() => {
                  setTool("welcome");
                }}
              >
                欢迎
              </button>
            </div>
            <div className={`tab ${tool === "query" ? "active" : ""}`}>
              <button type="button" onClick={() => setTool("query")}>
                查询
              </button>
            </div>
            <div className={`tab ${tool === "console" ? "active" : ""}`}>
              <button type="button" onClick={() => setTool("console")}>
                Console
              </button>
            </div>
            {tabs.map((t) => (
              <div
                key={t.id}
                className={`tab ${tool === "table" && t.id === activeTabId ? "active" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab(t.id);
                    setTool("table");
                  }}
                >
                  {t.dirty ? "• " : ""}
                  {t.table}
                </button>
                <button
                  type="button"
                  className="tab-close"
                  onClick={() => closeTab(t.id)}
                  aria-label="关闭"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {tool === "query" ? (
            <QueryEditor />
          ) : tool === "console" ? (
            <ConsolePanel />
          ) : tool === "table" && activeTab ? (
            <DataGrid tab={activeTab} />
          ) : (
            <div className="workspace-content">
              <h1>工作区</h1>
              <p>打开连接后，可使用查询 / Console，或双击对象树中的表查看数据。</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
