import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import {
  TableContextMenu,
  type TableMenuTarget,
} from "./TableContextMenu";
import {
  ViewsFolderContextMenu,
  type ViewsFolderMenuTarget,
} from "./ViewsFolderContextMenu";
import {
  FunctionsFolderContextMenu,
  type FunctionsFolderMenuTarget,
} from "./FunctionsFolderContextMenu";
import {
  RoutineContextMenu,
  type RoutineMenuTarget,
} from "./RoutineContextMenu";
import {
  EventsFolderContextMenu,
  type EventsFolderMenuTarget,
} from "./EventsFolderContextMenu";
import {
  EventContextMenu,
  type EventMenuTarget,
} from "./EventContextMenu";
import {
  BackupsFolderContextMenu,
  type BackupsFolderMenuTarget,
} from "./BackupsFolderContextMenu";
import { BackupWizard } from "../backup/BackupWizard";
import { TreeObjectFolder } from "./TreeObjectFolder";
import type { RoutineType } from "../object-list/routineMeta";
import { emitTableDataChanged } from "../../lib/tableEvents";
import { CloseWorkspaceDialog } from "./CloseWorkspaceDialog";
import { EditDatabaseDialog } from "./EditDatabaseDialog";
import { NewDatabaseDialog } from "./NewDatabaseDialog";
import { IconEngine } from "./EngineIcons";
import {
  IconBackups,
  IconDatabase,
  IconEvents,
  IconFunctions,
  IconQueries,
  IconTables,
  IconViews,
} from "./TreeIcons";
import { confirmDialog } from "../../lib/confirm";

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

type SavedQueryMenu = {
  x: number;
  y: number;
  conn: ConnectionDto;
  database: string;
  query: SavedQueryDto;
};

type QueriesFolderMenu = {
  x: number;
  y: number;
  conn: ConnectionDto;
  database: string;
};

type RenameSavedQueryState = {
  conn: ConnectionDto;
  database: string;
  query: SavedQueryDto;
  name: string;
};

type ConnNode = {
  conn: ConnectionDto;
  expanded: boolean;
  /** session opened (connected) — drives the highlighted icon */
  connected: boolean;
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
  const [savedQueryMenu, setSavedQueryMenu] = useState<SavedQueryMenu | null>(
    null,
  );
  const [queriesFolderMenu, setQueriesFolderMenu] =
    useState<QueriesFolderMenu | null>(null);
  const [renameSaved, setRenameSaved] = useState<RenameSavedQueryState | null>(
    null,
  );
  const [renameBusy, setRenameBusy] = useState(false);
  const [tableMenu, setTableMenu] = useState<TableMenuTarget | null>(null);
  const [viewsFolderMenu, setViewsFolderMenu] =
    useState<ViewsFolderMenuTarget | null>(null);
  const [functionsFolderMenu, setFunctionsFolderMenu] =
    useState<FunctionsFolderMenuTarget | null>(null);
  const [routineMenu, setRoutineMenu] = useState<RoutineMenuTarget | null>(
    null,
  );
  const [eventsFolderMenu, setEventsFolderMenu] =
    useState<EventsFolderMenuTarget | null>(null);
  const [eventMenu, setEventMenu] = useState<EventMenuTarget | null>(null);
  const [backupsFolderMenu, setBackupsFolderMenu] =
    useState<BackupsFolderMenuTarget | null>(null);
  const [backupWizard, setBackupWizard] = useState<{
    conn: ConnectionDto;
    database: string;
  } | null>(null);
  /** Long-running connect/open: overlay label + delayed visibility */
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [busyVisible, setBusyVisible] = useState(false);
  const busyTimer = useRef<number | null>(null);

  const beginBusy = useCallback((label: string) => {
    setBusyLabel(label);
    if (busyTimer.current !== null) window.clearTimeout(busyTimer.current);
    // 200ms 内完成的操作不弹遮罩，避免闪烁
    busyTimer.current = window.setTimeout(() => setBusyVisible(true), 200);
  }, []);

  const endBusy = useCallback(() => {
    if (busyTimer.current !== null) {
      window.clearTimeout(busyTimer.current);
      busyTimer.current = null;
    }
    setBusyVisible(false);
    setBusyLabel(null);
  }, []);

  useEffect(
    () => () => {
      if (busyTimer.current !== null) window.clearTimeout(busyTimer.current);
    },
    [],
  );

  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId);
  const selectedDatabase = useWorkspaceStore((s) => s.selectedDatabase);
  const selectedFolder = useWorkspaceStore((s) => s.selectedFolder);
  const selectedTable = useWorkspaceStore((s) => s.selectedTable);
  const openConn = useWorkspaceStore((s) => s.openConnection);
  const clearConnection = useWorkspaceStore((s) => s.clearConnection);
  const selectDatabase = useWorkspaceStore((s) => s.selectDatabase);
  const selectObjectFolder = useWorkspaceStore((s) => s.selectObjectFolder);
  const selectTableMeta = useWorkspaceStore((s) => s.selectTableMeta);
  const revealInNavTree = useWorkspaceStore((s) => s.revealInNavTree);
  const openTable = useWorkspaceStore((s) => s.openTable);
  const openTableDesigner = useWorkspaceStore((s) => s.openTableDesigner);
  const openViewDesigner = useWorkspaceStore((s) => s.openViewDesigner);
  const openFunctionDesigner = useWorkspaceStore((s) => s.openFunctionDesigner);
  const openEventDesigner = useWorkspaceStore((s) => s.openEventDesigner);
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
  const setActiveDesigner = useWorkspaceStore((s) => s.setActiveDesigner);
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
    function onDocClick(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".dg-context-menu, .modal, .modal-backdrop")) return;
      setDbMenu(null);
      setConnMenu(null);
      setFunctionsFolderMenu(null);
      setRoutineMenu(null);
      setEventsFolderMenu(null);
      setEventMenu(null);
      setBackupsFolderMenu(null);
      setSavedQueryMenu(null);
      setQueriesFolderMenu(null);
      setTableMenu(null);
      setViewsFolderMenu(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // "在导航窗格中显示" from a workspace tab.
  useEffect(() => {
    async function onReveal(ev: Event) {
      const detail = (
        ev as CustomEvent<{
          connectionId?: string;
          database?: string;
          folder?: ObjectFolder;
          table?: string | null;
        }>
      ).detail;
      if (!detail?.connectionId || !detail.database || !detail.folder) return;
      const connId = detail.connectionId;
      const database = detail.database;
      const folder = detail.folder;
      const node = nodes.find((n) => n.conn.id === connId);
      if (!node) return;
      if (!node.expanded) {
        await toggleConnection(connId);
      }
      setNodes((prev) =>
        prev.map((n) =>
          n.conn.id === connId
            ? { ...n, openDbs: { ...n.openDbs, [database]: true } }
            : n,
        ),
      );
      revealInNavTree(node.conn, {
        database,
        folder,
        table: detail.table ?? null,
      });
      // Let object folders (possibly just mounted) expand themselves.
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("mycat:reveal-in-nav-folder", {
            detail: { connectionId: connId, database, folder },
          }),
        );
      }, 0);
    }
    window.addEventListener("mycat:reveal-in-nav", onReveal);
    return () => window.removeEventListener("mycat:reveal-in-nav", onReveal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

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
                connected: false,
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
    beginBusy(`正在连接「${node.conn.name}」…`);
    try {
      const databases = await ensureOpen(node);
      setNodes((prev) =>
        prev.map((n) =>
          n.conn.id === id
            ? {
                ...n,
                loading: false,
                databases,
                error: null,
                expanded: true,
                connected: true,
              }
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
    } finally {
      endBusy();
    }
  }

  async function refreshConnectionDatabases(connId: string) {
    const node = nodes.find((n) => n.conn.id === connId);
    if (!node) return;
    beginBusy(`正在刷新「${node.conn.name}」…`);
    try {
      openConn(node.conn);
      await openConnection(node.conn.id);
      const databases =
        node.conn.engine === "sqlite"
          ? [node.conn.host || "main"]
          : await listDatabases(node.conn.id);
      setNodes((prev) =>
        prev.map((n) =>
          n.conn.id === connId
            ? {
                ...n,
                databases,
                expanded: true,
                connected: true,
                error: null,
                loading: false,
              }
            : n,
        ),
      );
    } finally {
      endBusy();
    }
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
    function onSaved(ev: Event) {
      const detail = (ev as CustomEvent<{ connectionId?: string; database?: string }>)
        .detail;
      const connId = detail?.connectionId || activeConnectionId;
      const db = detail?.database || selectedDatabase;
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
      related.dirtyQueries.length === 0 &&
      related.dirtyDesigners.length === 0
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
              connected: false,
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
      related.dirtyQueries.length === 0 &&
      related.dirtyDesigners.length === 0
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
    if (related.dirtyDesigners.length > 0) {
      const blocked = related.dirtyDesigners[0]!;
      setPendingClose(null);
      setActiveDesigner(blocked.id);
      setToast(`请先保存表设计「${blocked.table}」`);
      window.setTimeout(() => setToast(null), 2800);
      return;
    }
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
    const ok = await confirmDialog({
      message: `确定删除连接「${conn.name}」？此操作不可恢复。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    await finalizeCloseConnection(conn.id);
    await deleteConnection(conn.id);
    if (activeConnectionId === conn.id) clearConnection();
    await reload();
    setToast(`已删除连接 ${conn.name}`);
    window.setTimeout(() => setToast(null), 2500);
  }

  async function handleCreateDatabase(
    conn: ConnectionDto,
    args: { name: string; charset: string; collate: string },
  ) {
    const { name, charset, collate } = args;
    if (!/^[A-Za-z0-9_]+$/.test(name)) {
      throw new Error("数据库名仅允许字母、数字、下划线");
    }
    setNewDbBusy(true);
    try {
      await openConnection(conn.id);
      let sql = `CREATE DATABASE \`${name}\``;
      if (String(conn.engine).toLowerCase() === "mysql") {
        if (charset) sql += ` CHARACTER SET ${charset}`;
        if (collate) sql += ` COLLATE ${collate}`;
      }
      await executeSql(conn.id, sql);
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
    const needsOpen = !node.expanded || node.databases.length === 0;
    if (needsOpen) beginBusy(`正在打开「${db}」…`);
    try {
      if (needsOpen) {
        const databases = await ensureOpen(node);
        setNodes((prev) =>
          prev.map((n) =>
            n.conn.id === node.conn.id
              ? {
                  ...n,
                  expanded: true,
                  connected: true,
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
    } finally {
      if (needsOpen) endBusy();
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
                <IconEngine engine={n.conn.engine} active={n.connected} />
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
                            <IconDatabase active={dbOpen} />
                            <span className="tree-text">{db}</span>
                          </button>
                        </div>
                        {dbOpen && (
                          <ul className="tree-children">
                            {FOLDERS.map((folder) => {
                              if (
                                folder.id === "tables" ||
                                folder.id === "views" ||
                                folder.id === "functions" ||
                                folder.id === "events"
                              ) {
                                return (
                                  <TreeObjectFolder
                                    key={folder.id}
                                    conn={n.conn}
                                    database={db}
                                    folder={folder.id}
                                    folderActive={
                                      dbActive && selectedFolder === folder.id
                                    }
                                    selectedTable={
                                      dbActive ? selectedTable : null
                                    }
                                    onSelectFolder={() => {
                                      openConn(n.conn);
                                      selectObjectFolder(db, folder.id);
                                    }}
                                    onOpenTable={(table, kind) => {
                                      openConn(n.conn);
                                      if (folder.id === "functions") {
                                        selectObjectFolder(db, "functions");
                                        selectTableMeta(table);
                                        const rt = (
                                          kind === "FUNCTION" ||
                                          kind === "function"
                                            ? "FUNCTION"
                                            : "PROCEDURE"
                                        ) as RoutineType;
                                        openFunctionDesigner({
                                          connection: n.conn,
                                          database: db,
                                          routine: table,
                                          mode: "alter",
                                          routineType: rt,
                                        });
                                        return;
                                      }
                                      if (folder.id === "events") {
                                        selectObjectFolder(db, "events");
                                        selectTableMeta(table);
                                        openEventDesigner({
                                          connection: n.conn,
                                          database: db,
                                          event: table,
                                          mode: "alter",
                                        });
                                        return;
                                      }
                                      selectObjectFolder(
                                        db,
                                        kind === "view" ? "views" : "tables",
                                      );
                                      selectTableMeta(table);
                                      openTable(table);
                                    }}
                                    onDesignTable={(table, kind) => {
                                      openConn(n.conn);
                                      if (folder.id === "functions") {
                                        openFunctionDesigner({
                                          connection: n.conn,
                                          database: db,
                                          routine: table,
                                          mode: "alter",
                                          routineType: (
                                            kind === "FUNCTION" ||
                                            kind === "function"
                                              ? "FUNCTION"
                                              : "PROCEDURE"
                                          ) as RoutineType,
                                        });
                                      } else if (folder.id === "events") {
                                        openEventDesigner({
                                          connection: n.conn,
                                          database: db,
                                          event: table,
                                          mode: "alter",
                                        });
                                      } else if (folder.id === "views") {
                                        openViewDesigner({
                                          connection: n.conn,
                                          database: db,
                                          view: table,
                                          mode: "alter",
                                        });
                                      } else {
                                        openTableDesigner({
                                          connection: n.conn,
                                          database: db,
                                          table,
                                          mode: "alter",
                                        });
                                      }
                                    }}
                                    onTableContextMenu={({
                                      x,
                                      y,
                                      table,
                                      kind,
                                    }) => {
                                      setDbMenu(null);
                                      setConnMenu(null);
                                      setSavedQueryMenu(null);
                                      setQueriesFolderMenu(null);
                                      setViewsFolderMenu(null);
                                      setFunctionsFolderMenu(null);
                                      setEventsFolderMenu(null);
                                      if (folder.id === "functions") {
                                        setTableMenu(null);
                                        setEventMenu(null);
                                        setRoutineMenu({
                                          x,
                                          y,
                                          conn: n.conn,
                                          database: db,
                                          name: table,
                                          routineType: (
                                            kind === "FUNCTION" ||
                                            kind === "function"
                                              ? "FUNCTION"
                                              : "PROCEDURE"
                                          ) as RoutineType,
                                        });
                                      } else if (folder.id === "events") {
                                        setTableMenu(null);
                                        setRoutineMenu(null);
                                        setEventMenu({
                                          x,
                                          y,
                                          conn: n.conn,
                                          database: db,
                                          name: table,
                                        });
                                      } else {
                                        setRoutineMenu(null);
                                        setEventMenu(null);
                                        setTableMenu({
                                          x,
                                          y,
                                          conn: n.conn,
                                          database: db,
                                          table,
                                          kind,
                                        });
                                      }
                                    }}
                                    onFolderContextMenu={
                                      folder.id === "views"
                                        ? ({ x, y }) => {
                                            setDbMenu(null);
                                            setConnMenu(null);
                                            setSavedQueryMenu(null);
                                            setQueriesFolderMenu(null);
                                            setTableMenu(null);
                                            setRoutineMenu(null);
                                            setEventMenu(null);
                                            setFunctionsFolderMenu(null);
                                            setEventsFolderMenu(null);
                                            setViewsFolderMenu({
                                              x,
                                              y,
                                              conn: n.conn,
                                              database: db,
                                            });
                                          }
                                        : folder.id === "functions"
                                          ? ({ x, y }) => {
                                              setDbMenu(null);
                                              setConnMenu(null);
                                              setSavedQueryMenu(null);
                                              setQueriesFolderMenu(null);
                                              setTableMenu(null);
                                              setRoutineMenu(null);
                                              setEventMenu(null);
                                              setViewsFolderMenu(null);
                                              setEventsFolderMenu(null);
                                              setFunctionsFolderMenu({
                                                x,
                                                y,
                                                conn: n.conn,
                                                database: db,
                                              });
                                            }
                                          : folder.id === "events"
                                            ? ({ x, y }) => {
                                                setDbMenu(null);
                                                setConnMenu(null);
                                                setSavedQueryMenu(null);
                                                setQueriesFolderMenu(null);
                                                setTableMenu(null);
                                                setRoutineMenu(null);
                                                setEventMenu(null);
                                                setViewsFolderMenu(null);
                                                setFunctionsFolderMenu(null);
                                                setEventsFolderMenu({
                                                  x,
                                                  y,
                                                  conn: n.conn,
                                                  database: db,
                                                });
                                              }
                                            : undefined
                                    }
                                    onMessage={(msg) => {
                                      setToast(msg);
                                      window.setTimeout(
                                        () => setToast(null),
                                        2500,
                                      );
                                    }}
                                  />
                                );
                              }

                              const queriesOpen =
                                folder.id === "queries" &&
                                !!n.openQueryFolders[db];
                              const saved = n.savedQueries[db] ?? [];
                              return (
                                <li key={folder.id}>
                                  <div
                                    className="tree-row tree-db"
                                    onContextMenu={
                                      folder.id === "queries"
                                        ? (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setDbMenu(null);
                                            setConnMenu(null);
                                            setSavedQueryMenu(null);
                                            setTableMenu(null);
                                            setBackupsFolderMenu(null);
                                            setQueriesFolderMenu({
                                              x: e.clientX,
                                              y: e.clientY,
                                              conn: n.conn,
                                              database: db,
                                            });
                                          }
                                        : folder.id === "backups"
                                          ? (e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              setDbMenu(null);
                                              setConnMenu(null);
                                              setSavedQueryMenu(null);
                                              setQueriesFolderMenu(null);
                                              setTableMenu(null);
                                              setViewsFolderMenu(null);
                                              setFunctionsFolderMenu(null);
                                              setEventsFolderMenu(null);
                                              setBackupsFolderMenu({
                                                x: e.clientX,
                                                y: e.clientY,
                                                conn: n.conn,
                                                database: db,
                                              });
                                            }
                                          : undefined
                                    }
                                  >
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
                                                setDbMenu(null);
                                                setConnMenu(null);
                                                setQueriesFolderMenu(null);
                                                setTableMenu(null);
                                                setSavedQueryMenu({
                                                  x: e.clientX,
                                                  y: e.clientY,
                                                  conn: n.conn,
                                                  database: db,
                                                  query: q,
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
                        connected: false,
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
          onAskNewDatabase={(c) => setNewDbFor(c)}
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}

      {tableMenu && (
        <TableContextMenu
          target={tableMenu}
          onClose={() => setTableMenu(null)}
          onRefresh={() => {
            emitTableDataChanged({
              connectionId: tableMenu.conn.id,
              database: tableMenu.database,
              table: tableMenu.table,
            });
            window.dispatchEvent(new Event("mycat:object-list-refresh"));
          }}
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}

      {viewsFolderMenu && (
        <ViewsFolderContextMenu
          target={viewsFolderMenu}
          onClose={() => setViewsFolderMenu(null)}
          onRefresh={() => {
            emitTableDataChanged({
              connectionId: viewsFolderMenu.conn.id,
              database: viewsFolderMenu.database,
              table: "*",
            });
            window.dispatchEvent(new Event("mycat:object-list-refresh"));
          }}
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}

      {functionsFolderMenu && (
        <FunctionsFolderContextMenu
          target={functionsFolderMenu}
          onClose={() => setFunctionsFolderMenu(null)}
          onRefresh={() => {
            emitTableDataChanged({
              connectionId: functionsFolderMenu.conn.id,
              database: functionsFolderMenu.database,
              table: "*",
            });
            window.dispatchEvent(new Event("mycat:object-list-refresh"));
          }}
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}

      {backupsFolderMenu && (
        <BackupsFolderContextMenu
          target={backupsFolderMenu}
          onClose={() => setBackupsFolderMenu(null)}
          onRefresh={() => {
            window.dispatchEvent(new Event("mycat:object-list-refresh"));
          }}
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2500);
          }}
          onNewBackup={() => {
            setBackupWizard({
              conn: backupsFolderMenu.conn,
              database: backupsFolderMenu.database,
            });
          }}
        />
      )}

      {backupWizard && (
        <BackupWizard
          conn={backupWizard.conn}
          database={backupWizard.database}
          onClose={() => setBackupWizard(null)}
          onCompleted={() => {
            window.dispatchEvent(new Event("mycat:object-list-refresh"));
          }}
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}

      {routineMenu && (
        <RoutineContextMenu
          target={routineMenu}
          onClose={() => setRoutineMenu(null)}
          onRefresh={() => {
            emitTableDataChanged({
              connectionId: routineMenu.conn.id,
              database: routineMenu.database,
              table: "*",
            });
            window.dispatchEvent(new Event("mycat:object-list-refresh"));
          }}
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}

      {eventsFolderMenu && (
        <EventsFolderContextMenu
          target={eventsFolderMenu}
          onClose={() => setEventsFolderMenu(null)}
          onRefresh={() => {
            emitTableDataChanged({
              connectionId: eventsFolderMenu.conn.id,
              database: eventsFolderMenu.database,
              table: "*",
            });
            window.dispatchEvent(new Event("mycat:object-list-refresh"));
          }}
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}

      {eventMenu && (
        <EventContextMenu
          target={eventMenu}
          onClose={() => setEventMenu(null)}
          onRefresh={() => {
            emitTableDataChanged({
              connectionId: eventMenu.conn.id,
              database: eventMenu.database,
              table: "*",
            });
            window.dispatchEvent(new Event("mycat:object-list-refresh"));
          }}
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
          dirtyDesigners={pendingCloseRelated.dirtyDesigners}
          busy={closeBusy}
          onCancel={() => setPendingClose(null)}
          onDiscardAndClose={handleDiscardAndClose}
          onSaveAndClose={() => void handleSaveAndClose()}
        />
      )}

      {pendingEdit && (
        <EditDatabaseDialog
          database={pendingEdit.database}
          connectionId={pendingEdit.connId}
          busy={editBusy}
          onCancel={() => setPendingEdit(null)}
          onSubmit={(charset, collate) =>
            void handleEditDatabaseSubmit(charset, collate)
          }
        />
      )}

      {newDbFor && (
        <NewDatabaseDialog
          connectionId={newDbFor.id}
          busy={newDbBusy}
          onCancel={() => setNewDbFor(null)}
          onSubmit={(args) => {
            void handleCreateDatabase(newDbFor, args).catch((err) => {
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

      {queriesFolderMenu && (
        <div
          className="dg-context-menu conn-context-menu"
          style={{
            left: queriesFolderMenu.x,
            top: queriesFolderMenu.y,
          }}
          role="menu"
        >
          <button
            type="button"
            onClick={() => {
              openConn(queriesFolderMenu.conn);
              openQuery({
                connection: queriesFolderMenu.conn,
                database: queriesFolderMenu.database,
              });
              setQueriesFolderMenu(null);
            }}
          >
            新建查询
            <span className="menu-shortcut">⌘Y</span>
          </button>
          <button
            type="button"
            onClick={() => {
              void loadSavedQueries(
                queriesFolderMenu.conn.id,
                queriesFolderMenu.database,
              );
              setQueriesFolderMenu(null);
            }}
          >
            刷新
          </button>
          <button
            type="button"
            className="menu-cancel"
            onClick={() => setQueriesFolderMenu(null)}
          >
            取消
          </button>
        </div>
      )}

      {savedQueryMenu && (
        <div
          className="dg-context-menu conn-context-menu"
          style={{ left: savedQueryMenu.x, top: savedQueryMenu.y }}
          role="menu"
        >
          <button
            type="button"
            onClick={() => {
              openConn(savedQueryMenu.conn);
              openQuery({
                connection: savedQueryMenu.conn,
                database: savedQueryMenu.database,
                title: savedQueryMenu.query.name,
                sql: savedQueryMenu.query.sql,
                savedQueryId: savedQueryMenu.query.id,
              });
              setSavedQueryMenu(null);
            }}
          >
            打开
          </button>
          <button
            type="button"
            onClick={() => {
              setRenameSaved({
                conn: savedQueryMenu.conn,
                database: savedQueryMenu.database,
                query: savedQueryMenu.query,
                name: savedQueryMenu.query.name,
              });
              setSavedQueryMenu(null);
            }}
          >
            重命名
          </button>
          <div className="dg-menu-sep" />
          <button
            type="button"
            className="is-danger"
            onClick={() => {
              const { conn, database, query } = savedQueryMenu;
              setSavedQueryMenu(null);
              void confirmDialog({
                message: `删除已保存查询「${query.name}」？`,
                confirmText: "删除",
                danger: true,
              }).then((ok) => {
                if (!ok) return;
                return deleteSavedQuery(query.id)
                  .then(() => loadSavedQueries(conn.id, database))
                  .catch((err) => {
                    setToast(err instanceof Error ? err.message : String(err));
                    window.setTimeout(() => setToast(null), 2500);
                  });
              });
            }}
          >
            删除
          </button>
          <button
            type="button"
            className="menu-cancel"
            onClick={() => setSavedQueryMenu(null)}
          >
            取消
          </button>
        </div>
      )}

      {renameSaved && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !renameBusy) {
              setRenameSaved(null);
            }
          }}
        >
          <form
            className="modal"
            onKeyDown={(e) => {
              if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
              if (e.key.toLowerCase() !== "s") return;
              e.preventDefault();
              e.currentTarget.requestSubmit();
            }}
            onSubmit={(e) => {
              e.preventDefault();
              const name = renameSaved.name.trim();
              if (!name || renameBusy) return;
              setRenameBusy(true);
              void upsertSavedQuery({
                id: renameSaved.query.id,
                connectionId: renameSaved.conn.id,
                database: renameSaved.database,
                name,
                sql: renameSaved.query.sql,
              })
                .then((saved) => {
                  const openTab = queryTabs.find(
                    (t) => t.savedQueryId === saved.id,
                  );
                  if (openTab) {
                    updateQueryTab(openTab.id, { title: saved.name });
                  }
                  return loadSavedQueries(
                    renameSaved.conn.id,
                    renameSaved.database,
                  );
                })
                .then(() => {
                  setToast(`已重命名为「${name}」`);
                  window.setTimeout(() => setToast(null), 2500);
                  setRenameSaved(null);
                })
                .catch((err) => {
                  setToast(err instanceof Error ? err.message : String(err));
                  window.setTimeout(() => setToast(null), 2800);
                })
                .finally(() => setRenameBusy(false));
            }}
          >
            <h2>重命名查询</h2>
            <label>
              名称
              <input
                value={renameSaved.name}
                onChange={(e) =>
                  setRenameSaved({ ...renameSaved, name: e.target.value })
                }
                autoFocus
                disabled={renameBusy}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                disabled={renameBusy}
                onClick={() => setRenameSaved(null)}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={renameBusy || !renameSaved.name.trim()}
                title="确定 (⌘/Ctrl+S)"
              >
                {renameBusy ? "保存中…" : "确定"}
              </button>
            </div>
          </form>
        </div>
      )}

      {editing !== undefined && (
        <ConnectionForm
          initial={editing}
          onCancel={() => setEditing(undefined)}
          onSaved={() => setEditing(undefined)}
          save={save}
        />
      )}

      <div
        className={`tree-busy ${busyVisible ? "is-visible" : ""}`}
        aria-hidden={!busyVisible}
        role="status"
        aria-live="polite"
      >
        <div className="tree-busy-card">
          <span className="tree-busy-spinner" aria-hidden />
          <span className="tree-busy-text">{busyLabel ?? ""}</span>
        </div>
      </div>
    </aside>
  );
}
