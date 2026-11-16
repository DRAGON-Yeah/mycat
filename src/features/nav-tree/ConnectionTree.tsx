import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  deleteConnection,
  exportConnections,
  importConnections,
  listConnections,
  upsertConnection,
} from "../connections/api";
import { ConnectionForm } from "../connections/ConnectionForm";
import type { ConnectionDto, UpsertConnectionInput } from "../connections/types";
import {
  closeConnection,
  listDatabases,
  openConnection,
} from "../connections/sessionApi";
import {
  useWorkspaceStore,
  type ObjectFolder,
} from "../../stores/workspaceStore";
import {
  deleteSavedQuery,
  listSavedQueries,
  type SavedQueryDto,
} from "../query/savedQueriesApi";
import {
  DatabaseContextMenu,
  type DbMenuTarget,
} from "./DatabaseContextMenu";
import {
  IconBackups,
  IconDatabase,
  IconEvents,
  IconFunctions,
  IconQueries,
  IconServer,
  IconTables,
  IconViews,
} from "./TreeIcons";

type ConnNode = {
  conn: ConnectionDto;
  expanded: boolean;
  loading: boolean;
  error: string | null;
  databases: string[];
  openDbs: Record<string, boolean>;
  /** `${db}` → whether queries folder is expanded */
  openQueryFolders: Record<string, boolean>;
  /** `${db}` → saved queries */
  savedQueries: Record<string, SavedQueryDto[]>;
};

const FOLDERS: { id: ObjectFolder; label: string; icon: ReactNode }[] = [
  { id: "tables", label: "表", icon: <IconTables /> },
  { id: "views", label: "视图", icon: <IconViews /> },
  { id: "functions", label: "函数", icon: <IconFunctions /> },
  { id: "events", label: "事件", icon: <IconEvents /> },
  { id: "queries", label: "查询", icon: <IconQueries /> },
  { id: "backups", label: "备份", icon: <IconBackups /> },
];

export function ConnectionTree() {
  const [nodes, setNodes] = useState<ConnNode[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ConnectionDto | null | undefined>(
    undefined,
  );
  const [filter, setFilter] = useState("");
  const [dbMenu, setDbMenu] = useState<DbMenuTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId);
  const selectedDatabase = useWorkspaceStore((s) => s.selectedDatabase);
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder);
  const openConn = useWorkspaceStore((s) => s.openConnection);
  const clearConnection = useWorkspaceStore((s) => s.clearConnection);
  const selectDatabase = useWorkspaceStore((s) => s.selectDatabase);
  const selectObjectFolder = useWorkspaceStore((s) => s.selectObjectFolder);
  const clearDatabaseSelection = useWorkspaceStore(
    (s) => s.clearDatabaseSelection,
  );
  const openQuery = useWorkspaceStore((s) => s.openQuery);
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);
  const activeQueryId = useWorkspaceStore((s) => s.activeQueryId);
  const queryTabs = useWorkspaceStore((s) => s.queryTabs);
  const activeSavedQueryId =
    queryTabs.find((t) => t.id === activeQueryId)?.savedQueryId ?? null;

  useEffect(() => {
    function onDocClick() {
      setDbMenu(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!selectedDatabase || !activeConnectionId) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      // ⇧⌘. close database
      if (e.shiftKey && (e.key === "." || e.code === "Period")) {
        e.preventDefault();
        closeDatabase(activeConnectionId, selectedDatabase);
        return;
      }
      // ⌘Y new query
      if (!e.shiftKey && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        if (activeConnection) {
          openQuery({
            connection: activeConnection,
            database: selectedDatabase,
          });
        }
        return;
      }
      // ⌘R refresh
      if (!e.shiftKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        void refreshConnectionDatabases(activeConnectionId).then(() => {
          setToast("已刷新");
          window.setTimeout(() => setToast(null), 2000);
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // closeDatabase / refresh are stable enough via closure over latest state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDatabase, activeConnectionId, activeConnection, openQuery]);

  const reload = useCallback(async () => {
    try {
      const items = await listConnections();
      setNodes((prev) => {
        const prevMap = new Map(prev.map((n) => [n.conn.id, n]));
        return items.map((conn) => {
          const old = prevMap.get(conn.id);
          return old
            ? { ...old, conn }
            : {
                conn,
                expanded: false,
                loading: false,
                error: null,
                databases: [],
                openDbs: {},
                openQueryFolders: {},
                savedQueries: {},
              };
        });
      });
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save(input: UpsertConnectionInput) {
    const saved = await upsertConnection(input);
    await reload();
    return saved;
  }

  async function ensureOpen(node: ConnNode) {
    openConn(node.conn);
    await openConnection(node.conn.id);
    if (node.conn.engine === "sqlite") {
      return [node.conn.host || "main"];
    }
    return listDatabases(node.conn.id);
  }

  async function toggleConnection(id: string) {
    const node = nodes.find((n) => n.conn.id === id);
    if (!node) return;

    if (node.expanded) {
      setNodes((prev) =>
        prev.map((n) => (n.conn.id === id ? { ...n, expanded: false } : n)),
      );
      return;
    }

    setNodes((prev) =>
      prev.map((n) =>
        n.conn.id === id
          ? { ...n, loading: true, error: null, expanded: true }
          : n,
      ),
    );
    try {
      const databases = await ensureOpen(node);
      setNodes((prev) =>
        prev.map((n) =>
          n.conn.id === id
            ? { ...n, loading: false, databases, error: null, expanded: true }
            : n,
        ),
      );
      openConn(node.conn);
    } catch (err) {
      setNodes((prev) =>
        prev.map((n) =>
          n.conn.id === id
            ? {
                ...n,
                loading: false,
                error: err instanceof Error ? err.message : String(err),
                expanded: true,
              }
            : n,
        ),
      );
    }
  }

  async function refreshConnectionDatabases(connId: string) {
    const node = nodes.find((n) => n.conn.id === connId);
    if (!node) return;
    openConn(node.conn);
    await openConnection(node.conn.id);
    const databases =
      node.conn.engine === "sqlite"
        ? [node.conn.host || "main"]
        : await listDatabases(node.conn.id);
    setNodes((prev) =>
      prev.map((n) =>
        n.conn.id === connId
          ? { ...n, databases, expanded: true, error: null, loading: false }
          : n,
      ),
    );
  }

  async function loadSavedQueries(connId: string, database: string) {
    try {
      const items = await listSavedQueries(connId, database);
      setNodes((prev) =>
        prev.map((n) =>
          n.conn.id === connId
            ? {
                ...n,
                savedQueries: { ...n.savedQueries, [database]: items },
                openQueryFolders: { ...n.openQueryFolders, [database]: true },
              }
            : n,
        ),
      );
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
      window.setTimeout(() => setToast(null), 2500);
    }
  }

  useEffect(() => {
    function onSaved() {
      const connId = activeConnectionId;
      const db = selectedDatabase;
      if (!connId || !db) return;
      void loadSavedQueries(connId, db);
    }
    window.addEventListener("saved-queries-changed", onSaved);
    return () => window.removeEventListener("saved-queries-changed", onSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId, selectedDatabase]);

  function closeDatabase(connId: string, database: string) {
    setNodes((prev) =>
      prev.map((n) =>
        n.conn.id === connId
          ? { ...n, openDbs: { ...n.openDbs, [database]: false } }
          : n,
      ),
    );
    if (activeConnectionId === connId && selectedDatabase === database) {
      clearDatabaseSelection();
    }
  }

  async function onSelectDatabase(node: ConnNode, db: string) {
    try {
      if (!node.expanded || node.databases.length === 0) {
        const databases = await ensureOpen(node);
        setNodes((prev) =>
          prev.map((n) =>
            n.conn.id === node.conn.id
              ? {
                  ...n,
                  expanded: true,
                  databases,
                  openDbs: { ...n.openDbs, [db]: true },
                  error: null,
                }
              : n,
          ),
        );
      } else {
        setNodes((prev) =>
          prev.map((n) =>
            n.conn.id === node.conn.id
              ? { ...n, openDbs: { ...n.openDbs, [db]: true } }
              : n,
          ),
        );
      }
      openConn(node.conn);
      selectDatabase(db);
      selectObjectFolder(db, "tables");
    } catch (err) {
      setNodes((prev) =>
        prev.map((n) =>
          n.conn.id === node.conn.id
            ? {
                ...n,
                error: err instanceof Error ? err.message : String(err),
                expanded: true,
              }
            : n,
        ),
      );
    }
  }

  const visibleNodes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter(
      (n) =>
        n.conn.name.toLowerCase().includes(q) ||
        n.databases.some((d) => d.toLowerCase().includes(q)),
    );
  }, [nodes, filter]);

  return (
    <aside className="pane connection-tree" aria-label="我的连接">
      <div className="pane-title-row">
        <div className="pane-title">我的连接</div>
        <div className="pane-title-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setEditing(null)}
          >
            新建
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={async () => {
              const data = await exportConnections();
              const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "my-navicat-connections.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            导出
          </button>
          <label className="ghost-btn file-btn">
            导入
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  await importConnections(JSON.parse(await file.text()));
                  await reload();
                } catch (err) {
                  setListError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </label>
        </div>
      </div>

      {listError && <p className="pane-error">{listError}</p>}

      <ul className="tree-root">
        {visibleNodes.map((n) => (
          <li key={n.conn.id} className="tree-conn">
            <div
              className={`tree-row ${activeConnectionId === n.conn.id && !selectedDatabase ? "is-active" : ""}`}
            >
              <button
                type="button"
                className={`tree-twist ${n.expanded ? "is-expanded" : ""}`}
                onClick={() => void toggleConnection(n.conn.id)}
                aria-label={n.expanded ? "折叠" : "展开"}
              />
              <button
                type="button"
                className="tree-label"
                onClick={() => void toggleConnection(n.conn.id)}
              >
                <span
                  className="color-dot"
                  style={{ background: n.conn.color || "var(--accent)" }}
                />
                <IconServer />
                <span className="tree-text">
                  {n.conn.starred ? "★ " : ""}
                  {n.conn.name}
                </span>
              </button>
              <div className="tree-actions">
                <button type="button" onClick={() => setEditing(n.conn)}>
                  编辑
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await closeConnection(n.conn.id);
                    } catch {
                      // ignore
                    }
                    if (activeConnectionId === n.conn.id) clearConnection();
                    await deleteConnection(n.conn.id);
                    await reload();
                  }}
                >
                  删除
                </button>
              </div>
            </div>

            {n.expanded && (
              <ul className="tree-children">
                {n.loading && <li className="pane-placeholder">加载中…</li>}
                {n.error && <li className="pane-error">{n.error}</li>}
                {!n.loading &&
                  n.databases.map((db) => {
                    const dbOpen = !!n.openDbs[db];
                    const dbActive =
                      activeConnectionId === n.conn.id &&
                      selectedDatabase === db;
                    return (
                      <li key={db}>
                        <div
                          className={`tree-row tree-db ${dbActive && !selectedFolder ? "is-active" : ""}`}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openConn(n.conn);
                            selectDatabase(db);
                            setDbMenu({
                              x: e.clientX,
                              y: e.clientY,
                              conn: n.conn,
                              database: db,
                            });
                          }}
                        >
                          <button
                            type="button"
                            className={`tree-twist ${dbOpen ? "is-expanded" : ""}`}
                            onClick={() =>
                              setNodes((prev) =>
                                prev.map((x) =>
                                  x.conn.id === n.conn.id
                                    ? {
                                        ...x,
                                        openDbs: {
                                          ...x.openDbs,
                                          [db]: !x.openDbs[db],
                                        },
                                      }
                                    : x,
                                ),
                              )
                            }
                            aria-label={dbOpen ? "折叠" : "展开"}
                          />
                          <button
                            type="button"
                            className="tree-label"
                            onClick={() => void onSelectDatabase(n, db)}
                          >
                            <IconDatabase />
                            <span className="tree-text">{db}</span>
                          </button>
                        </div>
                        {dbOpen && (
                          <ul className="tree-children">
                            {FOLDERS.map((folder) => {
                              const queriesOpen =
                                folder.id === "queries" &&
                                !!n.openQueryFolders[db];
                              const saved = n.savedQueries[db] ?? [];
                              return (
                                <li key={folder.id}>
                                  <div className="tree-row tree-db">
                                    {folder.id === "queries" ? (
                                      <button
                                        type="button"
                                        className={`tree-twist ${queriesOpen ? "is-expanded" : ""}`}
                                        onClick={() => {
                                          const next = !queriesOpen;
                                          setNodes((prev) =>
                                            prev.map((x) =>
                                              x.conn.id === n.conn.id
                                                ? {
                                                    ...x,
                                                    openQueryFolders: {
                                                      ...x.openQueryFolders,
                                                      [db]: next,
                                                    },
                                                  }
                                                : x,
                                            ),
                                          );
                                          if (next) {
                                            openConn(n.conn);
                                            void loadSavedQueries(n.conn.id, db);
                                          }
                                        }}
                                        aria-label={
                                          queriesOpen ? "折叠查询" : "展开查询"
                                        }
                                      />
                                    ) : (
                                      <span className="tree-twist-spacer" />
                                    )}
                                    <button
                                      type="button"
                                      className={`tree-label tree-folder ${
                                        dbActive && selectedFolder === folder.id
                                          ? "is-active"
                                          : ""
                                      }`}
                                      onClick={() => {
                                        openConn(n.conn);
                                        selectObjectFolder(db, folder.id);
                                        if (folder.id === "queries") {
                                          setNodes((prev) =>
                                            prev.map((x) =>
                                              x.conn.id === n.conn.id
                                                ? {
                                                    ...x,
                                                    openQueryFolders: {
                                                      ...x.openQueryFolders,
                                                      [db]: true,
                                                    },
                                                  }
                                                : x,
                                            ),
                                          );
                                          void loadSavedQueries(n.conn.id, db);
                                        }
                                      }}
                                    >
                                      {folder.icon}
                                      <span className="tree-text">
                                        {folder.label}
                                        {folder.id === "queries" &&
                                        saved.length > 0
                                          ? ` (${saved.length})`
                                          : ""}
                                      </span>
                                    </button>
                                  </div>
                                  {folder.id === "queries" && queriesOpen && (
                                    <ul className="tree-children tree-query-list">
                                      {saved.map((q) => (
                                        <li key={q.id}>
                                          <div
                                            className={`tree-row ${
                                              activeSavedQueryId === q.id
                                                ? "is-active"
                                                : ""
                                            }`}
                                          >
                                            <span className="tree-twist-spacer" />
                                            <button
                                              type="button"
                                              className="tree-label"
                                              title={q.name}
                                              onClick={() => {
                                                openConn(n.conn);
                                                openQuery({
                                                  connection: n.conn,
                                                  database: db,
                                                  title: q.name,
                                                  sql: q.sql,
                                                  savedQueryId: q.id,
                                                });
                                              }}
                                              onContextMenu={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (
                                                  !window.confirm(
                                                    `删除已保存查询「${q.name}」？`,
                                                  )
                                                ) {
                                                  return;
                                                }
                                                void deleteSavedQuery(q.id)
                                                  .then(() =>
                                                    loadSavedQueries(
                                                      n.conn.id,
                                                      db,
                                                    ),
                                                  )
                                                  .catch((err) => {
                                                    setToast(
                                                      err instanceof Error
                                                        ? err.message
                                                        : String(err),
                                                    );
                                                    window.setTimeout(
                                                      () => setToast(null),
                                                      2500,
                                                    );
                                                  });
                                              }}
                                            >
                                              <IconQueries />
                                              <span className="tree-text">
                                                {q.name}
                                              </span>
                                            </button>
                                          </div>
                                        </li>
                                      ))}
                                      {saved.length === 0 && (
                                        <li className="pane-placeholder tree-query-empty">
                                          暂无保存的查询（⌘/Ctrl+S）
                                        </li>
                                      )}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                {!n.loading && !n.error && n.databases.length === 0 && (
                  <li className="pane-placeholder">无数据库</li>
                )}
              </ul>
            )}
          </li>
        ))}
        {visibleNodes.length === 0 && (
          <li className="pane-placeholder">暂无连接，点击「新建」开始</li>
        )}
      </ul>

      <div className="tree-bottom-bar">
        <input
          className="tree-search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索连接 / 数据库"
        />
        {activeConnectionId && (
          <button
            type="button"
            className="ghost-btn"
            onClick={async () => {
              try {
                await closeConnection(activeConnectionId);
              } catch {
                // ignore
              }
              clearConnection();
              setNodes((prev) =>
                prev.map((n) =>
                  n.conn.id === activeConnectionId
                    ? {
                        ...n,
                        expanded: false,
                        databases: [],
                        openDbs: {},
                        openQueryFolders: {},
                        savedQueries: {},
                      }
                    : n,
                ),
              );
            }}
          >
            断开
          </button>
        )}
      </div>

      {toast && <p className="tree-toast">{toast}</p>}

      {dbMenu && (
        <DatabaseContextMenu
          target={dbMenu}
          onClose={() => setDbMenu(null)}
          onRefresh={refreshConnectionDatabases}
          onCloseDatabase={closeDatabase}
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}

      {editing !== undefined && (
        <ConnectionForm
          initial={editing}
          onCancel={() => setEditing(undefined)}
          onSaved={() => setEditing(undefined)}
          save={save}
        />
      )}
    </aside>
  );
}
