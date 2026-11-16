import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  deleteConnection,
  exportConnections,
  listConnections,
  upsertConnection,
} from "../connections/api";
import { duplicateConnectionSeed } from "../connections/connectionHelpers";
import { ConnectionForm } from "../connections/ConnectionForm";
import { ImportConnectionsDialog } from "../connections/ImportConnectionsDialog";
import type { ConnectionDto, UpsertConnectionInput } from "../connections/types";
import {
  closeConnection,
  executeSql,
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
  upsertSavedQuery,
  type SavedQueryDto,
} from "../query/savedQueriesApi";
import {
  ConnectionContextMenu,
  type ConnMenuTarget,
} from "./ConnectionContextMenu";
import {
  DatabaseContextMenu,
  type DbMenuTarget,
} from "./DatabaseContextMenu";
import { CloseWorkspaceDialog } from "./CloseWorkspaceDialog";
import { EditDatabaseDialog } from "./EditDatabaseDialog";
import { NewDatabaseDialog } from "./NewDatabaseDialog";
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

type PendingClose =
  | {
      kind: "database";
      connId: string;
      database: string;
      after: "none" | "edit";
    }
  | {
      kind: "connection";
      connId: string;
      after: "none" | "edit";
    };

type PendingEdit = {
  connId: string;
  database: string;
};

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
  const [connMenu, setConnMenu] = useState<ConnMenuTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [newDbFor, setNewDbFor] = useState<ConnectionDto | null>(null);
  const [newDbBusy, setNewDbBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId);
  const selectedDatabase = useWorkspaceStore((s) => s.selectedDatabase);
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder);
  const openConn = useWorkspaceStore((s) => s.openConnection);
  const clearConnection = useWorkspaceStore((s) => s.clearConnection);
  const selectDatabase = useWorkspaceStore((s) => s.selectDatabase);
  const selectObjectFolder = useWorkspaceStore((s) => s.selectObjectFolder);
  const openQuery = useWorkspaceStore((s) => s.openQuery);
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);
  const activeQueryId = useWorkspaceStore((s) => s.activeQueryId);
  const queryTabs = useWorkspaceStore((s) => s.queryTabs);
  const listTabsForDatabase = useWorkspaceStore((s) => s.listTabsForDatabase);
  const listTabsForConnection = useWorkspaceStore(
    (s) => s.listTabsForConnection,
  );
  const closeDatabaseWorkspace = useWorkspaceStore(
    (s) => s.closeDatabaseWorkspace,
  );
  const closeConnectionWorkspace = useWorkspaceStore(
    (s) => s.closeConnectionWorkspace,
  );
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const updateQueryTab = useWorkspaceStore((s) => s.updateQueryTab);
  const activeSavedQueryId =
    queryTabs.find((t) => t.id === activeQueryId)?.savedQueryId ?? null;

  const pendingCloseRelated = pendingClose
    ? pendingClose.kind === "database"
      ? listTabsForDatabase(pendingClose.connId, pendingClose.database)
      : listTabsForConnection(pendingClose.connId)
    : null;

  const groupNames = useMemo(
    () =>
      [
        ...new Set(
          nodes
            .map((n) => n.conn.groupName?.trim())
            .filter((g): g is string => !!g),
        ),
      ].sort((a, b) => a.localeCompare(b, "zh")),
    [nodes],
  );

  useEffect(() => {
    function onDocClick() {
      setDbMenu(null);
      setConnMenu(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!activeConnectionId) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      // ⇧⌘. close database if selected, else close connection
      if (e.shiftKey && (e.key === "." || e.code === "Period")) {
        e.preventDefault();
        if (selectedDatabase) {
          requestCloseDatabase(activeConnectionId, selectedDatabase, "none");
        } else {
          requestCloseConnection(activeConnectionId, "none");
        }
        return;
      }
      // ⌘Y new query
      if (!e.shiftKey && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        if (activeConnection) {
          openQuery({
            connection: activeConnection,
            database: selectedDatabase ?? undefined,
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

  function collapseDatabaseNode(connId: string, database: string) {
    setNodes((prev) =>
      prev.map((n) =>
        n.conn.id === connId
          ? {
              ...n,
              openDbs: { ...n.openDbs, [database]: false },
              openQueryFolders: { ...n.openQueryFolders, [database]: false },
            }
          : n,
      ),
    );
  }

  function finalizeCloseDatabase(connId: string, database: string) {
    closeDatabaseWorkspace(connId, database, "force");
    collapseDatabaseNode(connId, database);
  }

  function requestCloseDatabase(
    connId: string,
    database: string,
    after: "none" | "edit" = "none",
  ) {
    const related = listTabsForDatabase(connId, database);
    if (
      related.dirtyTables.length === 0 &&
      related.dirtyQueries.length === 0
    ) {
      finalizeCloseDatabase(connId, database);
      if (after === "edit") {
        setPendingEdit({ connId, database });
      }
      return;
    }
    setPendingClose({ kind: "database", connId, database, after });
  }

  function collapseConnectionNode(connId: string) {
    setNodes((prev) =>
      prev.map((n) =>
        n.conn.id === connId
          ? {
              ...n,
              expanded: false,
              openDbs: {},
              openQueryFolders: {},
            }
          : n,
      ),
    );
  }

  async function finalizeCloseConnection(connId: string) {
    closeConnectionWorkspace(connId, "force");
    collapseConnectionNode(connId);
    try {
      await closeConnection(connId);
    } catch {
      // session may already be closed
    }
  }

  function requestCloseConnection(
    connId: string,
    after: "none" | "edit" = "none",
  ) {
    const related = listTabsForConnection(connId);
    if (
      related.dirtyTables.length === 0 &&
      related.dirtyQueries.length === 0
    ) {
      void finalizeCloseConnection(connId).then(() => {
        if (after === "edit") {
          const node = nodes.find((n) => n.conn.id === connId);
          if (node) setEditing(node.conn);
        }
      });
      return;
    }
    setPendingClose({ kind: "connection", connId, after });
  }

  async function handleSaveAndClose() {
    if (!pendingClose) return;
    const related =
      pendingClose.kind === "database"
        ? listTabsForDatabase(pendingClose.connId, pendingClose.database)
        : listTabsForConnection(pendingClose.connId);
    if (related.dirtyTables.length > 0) {
      const blocked = related.dirtyTables[0]!;
      setPendingClose(null);
      setActiveTab(blocked.id);
      setToast(`请先保存表「${blocked.table}」的未保存更改`);
      window.setTimeout(() => setToast(null), 2800);
      return;
    }
    setCloseBusy(true);
    try {
      for (const q of related.dirtyQueries) {
        const name =
          q.title && q.title !== "无标题"
            ? q.title
            : `未命名查询-${new Date().toISOString().slice(11, 19)}`;
        const saved = await upsertSavedQuery({
          id: q.savedQueryId || undefined,
          connectionId: q.connectionId,
          database: q.database || null,
          name,
          sql: q.sql || "",
        });
        updateQueryTab(q.id, {
          title: saved.name,
          savedQueryId: saved.id,
          dirty: false,
        });
      }
      if (related.dirtyQueries.length > 0) {
        window.dispatchEvent(
          new CustomEvent("saved-queries-changed", {
            detail: {
              connectionId: pendingClose.connId,
              database:
                pendingClose.kind === "database"
                  ? pendingClose.database
                  : undefined,
            },
          }),
        );
      }

      if (pendingClose.kind === "database") {
        const { connId, database, after } = pendingClose;
        const result = closeDatabaseWorkspace(connId, database, "save-queries");
        if (!result.ok && result.blockedByTableId) {
          setActiveTab(result.blockedByTableId);
          setToast("请先保存表的未保存更改");
          window.setTimeout(() => setToast(null), 2800);
          return;
        }
        collapseDatabaseNode(connId, database);
        setPendingClose(null);
        if (after === "edit") setPendingEdit({ connId, database });
      } else {
        const { connId, after } = pendingClose;
        const result = closeConnectionWorkspace(connId, "save-queries");
        if (!result.ok && result.blockedByTableId) {
          setActiveTab(result.blockedByTableId);
          setToast("请先保存表的未保存更改");
          window.setTimeout(() => setToast(null), 2800);
          return;
        }
        collapseConnectionNode(connId);
        try {
          await closeConnection(connId);
        } catch {
          /* ignore */
        }
        setPendingClose(null);
        if (after === "edit") {
          const node = nodes.find((n) => n.conn.id === connId);
          if (node) setEditing(node.conn);
        }
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
      window.setTimeout(() => setToast(null), 2800);
    } finally {
      setCloseBusy(false);
    }
  }

  function handleDiscardAndClose() {
    if (!pendingClose) return;
    if (pendingClose.kind === "database") {
      const { connId, database, after } = pendingClose;
      finalizeCloseDatabase(connId, database);
      setPendingClose(null);
      if (after === "edit") setPendingEdit({ connId, database });
      return;
    }
    const { connId, after } = pendingClose;
    void finalizeCloseConnection(connId).then(() => {
      setPendingClose(null);
      if (after === "edit") {
        const node = nodes.find((n) => n.conn.id === connId);
        if (node) setEditing(node.conn);
      }
    });
  }

  async function handleDeleteConnection(conn: ConnectionDto) {
    if (
      !window.confirm(`确定删除连接「${conn.name}」？此操作不可恢复。`)
    ) {
      return;
    }
    await finalizeCloseConnection(conn.id);
    await deleteConnection(conn.id);
    if (activeConnectionId === conn.id) clearConnection();
    await reload();
    setToast(`已删除连接 ${conn.name}`);
    window.setTimeout(() => setToast(null), 2500);
  }

  async function handleCreateDatabase(conn: ConnectionDto, name: string) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) {
      throw new Error("数据库名仅允许字母、数字、下划线");
    }
    setNewDbBusy(true);
    try {
      await openConnection(conn.id);
      await executeSql(conn.id, `CREATE DATABASE \`${name}\``);
      setNewDbFor(null);
      setToast(`已创建数据库 ${name}`);
      window.setTimeout(() => setToast(null), 2500);
      await refreshConnectionDatabases(conn.id);
    } finally {
      setNewDbBusy(false);
    }
  }

  async function handleEditDatabaseSubmit(charset: string, collate: string) {
    if (!pendingEdit) return;
    const { connId, database } = pendingEdit;
    setEditBusy(true);
    try {
      await openConnection(connId);
      let sql = `ALTER DATABASE \`${database.replace(/`/g, "``")}\` CHARACTER SET ${charset}`;
      if (collate) sql += ` COLLATE ${collate}`;
      await executeSql(connId, sql);
      setPendingEdit(null);
      setToast("数据库属性已更新");
      window.setTimeout(() => setToast(null), 2500);
      await refreshConnectionDatabases(connId);
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
      window.setTimeout(() => setToast(null), 2800);
    } finally {
      setEditBusy(false);
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

  const groupedVisible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = !q
      ? nodes
      : nodes.filter(
          (n) =>
            n.conn.name.toLowerCase().includes(q) ||
            (n.conn.groupName ?? "").toLowerCase().includes(q) ||
            n.databases.some((d) => d.toLowerCase().includes(q)),
        );
    const map = new Map<string, ConnNode[]>();
    for (const n of filtered) {
      const g = n.conn.groupName?.trim() || "";
      const list = map.get(g) ?? [];
      list.push(n);
      map.set(g, list);
    }
    const keys = [...map.keys()].sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b, "zh");
    });
    return keys.map((group) => ({ group, nodes: map.get(group)! }));
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
              try {
                const data = await exportConnections();
                if (data.length === 0) {
                  setToast("当前没有可导出的连接");
                  window.setTimeout(() => setToast(null), 2500);
                  return;
                }
                const blob = new Blob([JSON.stringify(data, null, 2)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "mycat-connections.json";
                a.click();
                URL.revokeObjectURL(url);
                setToast(
                  `已导出 ${data.length} 条连接到 mycat-connections.json（请到下载文件夹查看）`,
                );
                window.setTimeout(() => setToast(null), 3500);
              } catch (err) {
                setToast(err instanceof Error ? err.message : String(err));
                window.setTimeout(() => setToast(null), 2800);
              }
            }}
          >
            导出
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setImportOpen(true)}
          >
            导入
          </button>
        </div>
      </div>

      {listError && <p className="pane-error">{listError}</p>}

      <ul className="tree-root">
        {groupedVisible.map(({ group, nodes: groupNodes }) => (
          <Fragment key={group || "__ungrouped"}>
            {group ? (
              <li className="tree-group-header" title={group}>
                {group}
              </li>
            ) : null}
            {groupNodes.map((n) => (
          <li key={n.conn.id} className="tree-conn">
            <div
              className={`tree-row ${activeConnectionId === n.conn.id && !selectedDatabase ? "is-active" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDbMenu(null);
                setConnMenu({
                  x: e.clientX,
                  y: e.clientY,
                  conn: n.conn,
                });
              }}
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
          </Fragment>
        ))}
        {groupedVisible.every((g) => g.nodes.length === 0) && (
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

      {connMenu && (
        <ConnectionContextMenu
          target={connMenu}
          groupNames={groupNames}
          onClose={() => setConnMenu(null)}
          onReload={reload}
          onRefreshDatabases={refreshConnectionDatabases}
          onRequestCloseConnection={(connId) =>
            requestCloseConnection(connId, "none")
          }
          onRequestEditConnection={(connId) =>
            requestCloseConnection(connId, "edit")
          }
          onNewConnection={() => setEditing(null)}
          onDuplicateConnection={(conn) =>
            setEditing(duplicateConnectionSeed(conn))
          }
          onDeleteConnection={(conn) => void handleDeleteConnection(conn)}
          onAskNewDatabase={(conn) => setNewDbFor(conn)}
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}

      {dbMenu && (
        <DatabaseContextMenu
          target={dbMenu}
          onClose={() => setDbMenu(null)}
          onRefresh={refreshConnectionDatabases}
          onRequestCloseDatabase={(connId, database) =>
            requestCloseDatabase(connId, database, "none")
          }
          onRequestEditDatabase={(connId, database) =>
            requestCloseDatabase(connId, database, "edit")
          }
          onForceCloseDatabase={(connId, database) =>
            finalizeCloseDatabase(connId, database)
          }
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}

      {pendingClose && pendingCloseRelated && (
        <CloseWorkspaceDialog
          title={
            pendingClose.kind === "database"
              ? `关闭数据库「${pendingClose.database}」`
              : `关闭连接「${nodes.find((n) => n.conn.id === pendingClose.connId)?.conn.name ?? pendingClose.connId}」`
          }
          dirtyTables={pendingCloseRelated.dirtyTables}
          dirtyQueries={pendingCloseRelated.dirtyQueries}
          busy={closeBusy}
          onCancel={() => setPendingClose(null)}
          onDiscardAndClose={handleDiscardAndClose}
          onSaveAndClose={() => void handleSaveAndClose()}
        />
      )}

      {pendingEdit && (
        <EditDatabaseDialog
          database={pendingEdit.database}
          busy={editBusy}
          onCancel={() => setPendingEdit(null)}
          onSubmit={(charset, collate) =>
            void handleEditDatabaseSubmit(charset, collate)
          }
        />
      )}

      {newDbFor && (
        <NewDatabaseDialog
          busy={newDbBusy}
          onCancel={() => setNewDbFor(null)}
          onSubmit={(name) => {
            void handleCreateDatabase(newDbFor, name).catch((err) => {
              setToast(err instanceof Error ? err.message : String(err));
              window.setTimeout(() => setToast(null), 2800);
            });
          }}
        />
      )}

      {importOpen && (
        <ImportConnectionsDialog
          onClose={() => setImportOpen(false)}
          onImported={(count) => {
            void reload();
            setToast(
              `导入成功：已新增 ${count} 条连接。请编辑连接并补填密码后再测试。`,
            );
            window.setTimeout(() => setToast(null), 4000);
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
