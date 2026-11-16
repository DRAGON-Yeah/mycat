import { DataGrid } from "../features/data-grid/DataGrid";
import { ObjectListGrid } from "../features/object-list/ObjectListGrid";
import { PlaceholderPane } from "../features/placeholders/PlaceholderPane";
import { ConsolePanel } from "../features/query/Console";
import { QueryEditor } from "../features/query/QueryEditor";
import { useWorkspaceStore } from "../stores/workspaceStore";

function queryTabLabel(title: string, database: string, connectionName: string) {
  const db = database || "?";
  const conn = connectionName || "?";
  const full = `${title} @${db} (${conn})`;
  return full.length > 36 ? `${full.slice(0, 34)}…` : full;
}

export function MainWorkspace() {
  const centerMode = useWorkspaceStore((s) => s.centerMode);
  const placeholderFeature = useWorkspaceStore((s) => s.placeholderFeature);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const queryTabs = useWorkspaceStore((s) => s.queryTabs);
  const activeQueryId = useWorkspaceStore((s) => s.activeQueryId);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const setActiveQuery = useWorkspaceStore((s) => s.setActiveQuery);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const closeQueryTab = useWorkspaceStore((s) => s.closeQueryTab);
  const setCenterMode = useWorkspaceStore((s) => s.setCenterMode);
  const selectedDatabase = useWorkspaceStore((s) => s.selectedDatabase);
  const openQuery = useWorkspaceStore((s) => s.openQuery);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <main className="pane workspace main-workspace" aria-label="工作区">
      <div className="workspace-tabs">
        <div
          className={`tab ${centerMode === "welcome" || (centerMode === "objectList" && !activeTab && !activeQueryId) ? "active" : ""}`}
        >
          <button
            type="button"
            onClick={() =>
              setCenterMode(selectedDatabase ? "objectList" : "welcome")
            }
          >
            {selectedDatabase ? "对象" : "欢迎"}
          </button>
        </div>
        <div className={`tab ${centerMode === "console" ? "active" : ""}`}>
          <button type="button" onClick={() => setCenterMode("console")}>
            Console
          </button>
        </div>
        {queryTabs.map((q) => (
          <div
            key={q.id}
            className={`tab tab-query ${centerMode === "query" && q.id === activeQueryId ? "active" : ""}`}
            title={`${q.title} @${q.database || "?"} (${q.connectionName})`}
          >
            <button type="button" onClick={() => setActiveQuery(q.id)}>
              <span className="tab-query-icon" aria-hidden />
              {q.dirty ? "• " : ""}
              {queryTabLabel(q.title, q.database, q.connectionName)}
            </button>
            <button
              type="button"
              className="tab-close"
              onClick={() => closeQueryTab(q.id)}
              aria-label="关闭查询"
            >
              ×
            </button>
          </div>
        ))}
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab ${centerMode === "table" && t.id === activeTabId ? "active" : ""}`}
          >
            <button type="button" onClick={() => setActiveTab(t.id)}>
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
        <button
          type="button"
          className="tab-add-query"
          title="新建查询"
          onClick={() => openQuery()}
        >
          +
        </button>
      </div>

      {centerMode === "placeholder" && placeholderFeature ? (
        <PlaceholderPane feature={placeholderFeature} />
      ) : centerMode === "query" ? (
        <QueryEditor />
      ) : centerMode === "console" ? (
        <ConsolePanel />
      ) : centerMode === "table" && activeTab ? (
        <DataGrid tab={activeTab} />
      ) : centerMode === "objectList" ? (
        <ObjectListGrid />
      ) : (
        <div className="workspace-content">
          <h1>工作区</h1>
          <p>
            在左侧打开连接并选择数据库后，这里会显示表清单。也可使用顶栏「查询」或
            Console。
          </p>
        </div>
      )}
    </main>
  );
}
