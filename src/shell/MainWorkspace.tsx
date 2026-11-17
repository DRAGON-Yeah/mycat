import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { DataGrid } from "../features/data-grid/DataGrid";
import { ObjectListGrid } from "../features/object-list/ObjectListGrid";
import { PlaceholderPane } from "../features/placeholders/PlaceholderPane";
import { ConsolePanel } from "../features/query/Console";
import { QueryEditor } from "../features/query/QueryEditor";
import { TableDesigner } from "../features/table-designer/TableDesigner";
import { ViewDesigner } from "../features/view-designer/ViewDesigner";
import { FunctionDesigner } from "../features/function-designer/FunctionDesigner";
import { EventDesigner } from "../features/event-designer/EventDesigner";
import { useWorkspaceStore } from "../stores/workspaceStore";
import {
  TabContextMenu,
  type TabKind,
  type TabMenuTarget,
} from "./TabContextMenu";

function queryTabLabel(title: string, database: string, connectionName: string) {
  const db = database || "?";
  const conn = connectionName || "?";
  const full = `${title} @${db} (${conn})`;
  return full.length > 40 ? `${full.slice(0, 38)}…` : full;
}

/** Navicat-style: table@database (connection) */
function tableTabLabel(table: string, database: string, connectionName: string) {
  const db = database || "?";
  const conn = connectionName || "?";
  const full = `${table}@${db} (${conn})`;
  return full.length > 42 ? `${full.slice(0, 40)}…` : full;
}

export function MainWorkspace() {
  const centerMode = useWorkspaceStore((s) => s.centerMode);
  const placeholderFeature = useWorkspaceStore((s) => s.placeholderFeature);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const queryTabs = useWorkspaceStore((s) => s.queryTabs);
  const activeQueryId = useWorkspaceStore((s) => s.activeQueryId);
  const designerTabs = useWorkspaceStore((s) => s.designerTabs);
  const activeDesignerId = useWorkspaceStore((s) => s.activeDesignerId);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const setActiveQuery = useWorkspaceStore((s) => s.setActiveQuery);
  const setActiveDesigner = useWorkspaceStore((s) => s.setActiveDesigner);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const closeQueryTab = useWorkspaceStore((s) => s.closeQueryTab);
  const closeDesignerTab = useWorkspaceStore((s) => s.closeDesignerTab);
  const setCenterMode = useWorkspaceStore((s) => s.setCenterMode);
  const openConsole = useWorkspaceStore((s) => s.openConsole);
  const selectedDatabase = useWorkspaceStore((s) => s.selectedDatabase);
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);
  const openQuery = useWorkspaceStore((s) => s.openQuery);
  const closeTabsByIds = useWorkspaceStore((s) => s.closeTabsByIds);

  const [tabMenu, setTabMenu] = useState<TabMenuTarget | null>(null);

  /** Closable document tabs in tab-bar order. */
  const closableTabs = useMemo(
    () => [
      ...queryTabs.map((q) => ({ kind: "query" as const, id: q.id })),
      ...tabs.map((t) => ({ kind: "table" as const, id: t.id })),
      ...designerTabs.map((t) => ({ kind: "designer" as const, id: t.id })),
    ],
    [queryTabs, tabs, designerTabs],
  );

  useEffect(() => {
    if (!tabMenu) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".ws-tab-context-menu")) return;
      setTabMenu(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [tabMenu]);

  function openTabMenu(
    e: ReactMouseEvent,
    kind: TabKind,
    id: string,
    canReveal = true,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const index = closableTabs.findIndex(
      (t) => t.kind === kind && t.id === id,
    );
    setTabMenu({
      x: e.clientX,
      y: e.clientY,
      kind,
      id,
      hasOthers: closableTabs.length > 1,
      hasRight: index >= 0 && index < closableTabs.length - 1,
      canReveal,
    });
  }

  function closeMenuTab() {
    if (tabMenu) closeTabsByIds([tabMenu.id]);
  }

  function closeMenuOthers() {
    if (!tabMenu) return;
    closeTabsByIds(
      closableTabs.filter((t) => t.id !== tabMenu.id).map((t) => t.id),
    );
  }

  function closeMenuRight() {
    if (!tabMenu) return;
    const index = closableTabs.findIndex(
      (t) => t.kind === tabMenu.kind && t.id === tabMenu.id,
    );
    if (index < 0) return;
    closeTabsByIds(closableTabs.slice(index + 1).map((t) => t.id));
  }

  function closeMenuAll() {
    closeTabsByIds(closableTabs.map((t) => t.id));
  }

  function revealMenuTab() {
    if (!tabMenu) return;
    let detail:
      | {
          connectionId: string;
          database: string;
          folder: string;
          table: string | null;
        }
      | null = null;
    if (tabMenu.kind === "query") {
      const q = queryTabs.find((t) => t.id === tabMenu.id);
      if (q) {
        detail = {
          connectionId: q.connectionId,
          database: q.database,
          folder: "queries",
          table: null,
        };
      }
    } else if (tabMenu.kind === "table") {
      const t = tabs.find((x) => x.id === tabMenu.id);
      if (t) {
        detail = {
          connectionId: t.connectionId,
          database: t.database,
          folder: "tables",
          table: t.table,
        };
      }
    } else {
      const d = designerTabs.find((x) => x.id === tabMenu.id);
      if (d) {
        detail = {
          connectionId: d.connectionId,
          database: d.database,
          folder:
            d.kind === "view"
              ? "views"
              : d.kind === "function"
                ? "functions"
                : d.kind === "event"
                  ? "events"
                  : "tables",
          table: d.table,
        };
      }
    }
    if (!detail) return;
    window.dispatchEvent(
      new CustomEvent("mycat:reveal-in-nav", { detail }),
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeDesigner =
    designerTabs.find((t) => t.id === activeDesignerId) ?? null;
  const objectsActive =
    centerMode === "welcome" ||
    (centerMode === "objectList" &&
      !activeTabId &&
      !activeQueryId &&
      !activeDesignerId);

  function onNewQuery() {
    if (!activeConnection) {
      window.alert("请先在左侧打开一个连接，再新建查询。");
      return;
    }
    openQuery({
      connection: activeConnection,
      database: selectedDatabase || undefined,
    });
  }

  return (
    <main className="pane workspace main-workspace" aria-label="工作区">
      <div className="ws-tabbar" role="tablist" aria-label="工作区页签">
        <div className="ws-tabbar-scroll">
          <button
            type="button"
            role="tab"
            aria-selected={objectsActive}
            className={`ws-tab ws-tab-system ${objectsActive ? "is-active" : ""}`}
            onClick={() =>
              setCenterMode(selectedDatabase ? "objectList" : "welcome")
            }
          >
            <span className="ws-tab-label">
              {selectedDatabase ? "对象" : "欢迎"}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={centerMode === "console"}
            className={`ws-tab ws-tab-system ${centerMode === "console" ? "is-active" : ""}`}
            onClick={() => openConsole()}
          >
            <span className="ws-tab-label">Console</span>
          </button>

          <span className="ws-tabbar-divider" aria-hidden />

          {queryTabs.map((q) => {
            const active = centerMode === "query" && q.id === activeQueryId;
            return (
              <div
                key={q.id}
                className={`ws-tab ws-tab-doc ws-tab-query ${active ? "is-active" : ""}`}
                role="tab"
                aria-selected={active}
                title={`${q.title} @${q.database || "?"} (${q.connectionName})`}
                onContextMenu={(e) => openTabMenu(e, "query", q.id)}
              >
                <button
                  type="button"
                  className="ws-tab-main"
                  onClick={() => setActiveQuery(q.id)}
                >
                  <span className="ws-tab-query-icon" aria-hidden />
                  <span className="ws-tab-label">
                    {q.dirty ? "• " : ""}
                    {queryTabLabel(q.title, q.database, q.connectionName)}
                  </span>
                </button>
                <button
                  type="button"
                  className="ws-tab-close"
                  title="关闭"
                  aria-label={`关闭 ${q.title}`}
                  onPointerDown={(e) => {
                    // Close on pointerdown so the action isn't lost if click is swallowed.
                    // Defer confirm/close past this pointer gesture — sync window.confirm
                    // during pointerdown often auto-cancels (mouseup hits Cancel).
                    e.preventDefault();
                    e.stopPropagation();
                    const id = q.id;
                    window.setTimeout(() => closeQueryTab(id), 0);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}

          {tabs.map((t) => {
            const active = centerMode === "table" && t.id === activeTabId;
            const label = tableTabLabel(
              t.table,
              t.database,
              t.connectionName,
            );
            const fullTitle = `${t.table}@${t.database || "?"} (${t.connectionName || "?"})`;
            return (
              <div
                key={t.id}
                className={`ws-tab ws-tab-doc ${active ? "is-active" : ""}`}
                role="tab"
                aria-selected={active}
                title={fullTitle}
                onContextMenu={(e) => openTabMenu(e, "table", t.id)}
              >
                <button
                  type="button"
                  className="ws-tab-close"
                  title="关闭"
                  aria-label={`关闭 ${fullTitle}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeTab(t.id);
                  }}
                >
                  ×
                </button>
                <button
                  type="button"
                  className="ws-tab-main"
                  onClick={() => setActiveTab(t.id)}
                >
                  <span className="ws-tab-table-icon" aria-hidden />
                  <span className="ws-tab-label">
                    {t.dirty ? "• " : ""}
                    {label}
                  </span>
                </button>
              </div>
            );
          })}

          {designerTabs.map((t) => {
            const active =
              centerMode === "table-designer" && t.id === activeDesignerId;
            const base = tableTabLabel(
              t.table,
              t.database,
              t.connectionName,
            );
            const kindLabel =
              t.kind === "event"
                ? "事件"
                : t.kind === "function"
                  ? "函数"
                  : t.kind === "view"
                    ? "视图"
                    : "表";
            const label =
              t.mode === "create"
                ? `设计${kindLabel}·${base}`
                : `设计${kindLabel} ${base}`;
            return (
              <div
                key={t.id}
                className={`ws-tab ws-tab-doc ${active ? "is-active" : ""}`}
                role="tab"
                aria-selected={active}
                title={label}
                onContextMenu={(e) =>
                  openTabMenu(e, "designer", t.id, t.mode !== "create")
                }
              >
                <button
                  type="button"
                  className="ws-tab-close"
                  title="关闭"
                  aria-label={`关闭 ${label}`}
                  onPointerDown={(e) => {
                    // Close on pointerdown so click isn't swallowed while a cell is focused.
                    // Defer past this gesture — sync confirm during pointerdown auto-cancels.
                    e.preventDefault();
                    e.stopPropagation();
                    const id = t.id;
                    (document.activeElement as HTMLElement | null)?.blur?.();
                    window.setTimeout(() => closeDesignerTab(id), 0);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  ×
                </button>
                <button
                  type="button"
                  className="ws-tab-main"
                  onClick={() => setActiveDesigner(t.id)}
                >
                  <span className="ws-tab-table-icon" aria-hidden />
                  <span className="ws-tab-label">
                    {t.dirty ? "• " : ""}
                    {label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="ws-tab-add"
          title="新建查询"
          aria-label="新建查询"
          onClick={onNewQuery}
        >
          +
        </button>
      </div>

      <div className="ws-body">
        {centerMode === "placeholder" && placeholderFeature ? (
          <PlaceholderPane feature={placeholderFeature} />
        ) : centerMode === "query" ? (
          <QueryEditor />
        ) : centerMode === "console" ? (
          <ConsolePanel />
        ) : centerMode === "table-designer" && activeDesigner ? (
          activeDesigner.kind === "event" ? (
            <EventDesigner tab={activeDesigner} />
          ) : activeDesigner.kind === "function" ? (
            <FunctionDesigner tab={activeDesigner} />
          ) : activeDesigner.kind === "view" ? (
            <ViewDesigner tab={activeDesigner} />
          ) : (
            <TableDesigner tab={activeDesigner} />
          )
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
      </div>

      {tabMenu && (
        <TabContextMenu
          target={tabMenu}
          onClose={() => setTabMenu(null)}
          onCloseTab={closeMenuTab}
          onCloseOthers={closeMenuOthers}
          onCloseRight={closeMenuRight}
          onCloseAll={closeMenuAll}
          onReveal={revealMenuTab}
        />
      )}
    </main>
  );
}
