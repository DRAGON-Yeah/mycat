import { create } from "zustand";
import type { ConnectionDto } from "../features/connections/types";

export type TableTab = {
  id: string;
  connectionId: string;
  connectionName: string;
  connectionEngine: string;
  table: string;
  dirty?: boolean;
};

export type QueryTab = {
  id: string;
  title: string;
  connectionId: string;
  connectionName: string;
  connectionEngine: string;
  database: string;
  sql: string;
  dirty: boolean;
};

export type CenterMode =
  | "welcome"
  | "objectList"
  | "table"
  | "query"
  | "console"
  | "placeholder";

export type ToolbarAction =
  | "connection"
  | "user"
  | "table"
  | "view"
  | "function"
  | "query"
  | "backup"
  | "automation"
  | "model"
  | "bi";

export type SelectionKind = "none" | "connection" | "database" | "table" | "folder";

export type ObjectFolder =
  | "tables"
  | "views"
  | "functions"
  | "events"
  | "queries"
  | "backups";

type WorkspaceState = {
  activeConnectionId: string | null;
  activeConnection: ConnectionDto | null;
  selectedDatabase: string | null;
  selectedTable: string | null;
  selectedFolder: ObjectFolder | null;
  selectionKind: SelectionKind;
  centerMode: CenterMode;
  toolbarAction: ToolbarAction;
  placeholderFeature: string | null;
  objectListFilter: string;
  focusObjectListFilter: boolean;
  tabs: TableTab[];
  activeTabId: string | null;
  queryTabs: QueryTab[];
  activeQueryId: string | null;
  openConnection: (conn: ConnectionDto) => void;
  clearConnection: () => void;
  clearDatabaseSelection: () => void;
  selectDatabase: (database: string) => void;
  selectObjectFolder: (database: string, folder: ObjectFolder) => void;
  selectTableMeta: (table: string | null) => void;
  setCenterMode: (mode: CenterMode) => void;
  setToolbarAction: (action: ToolbarAction, placeholder?: string | null) => void;
  setObjectListFilter: (filter: string, focus?: boolean) => void;
  consumeObjectListFilterFocus: () => void;
  openTable: (table: string) => void;
  openQuery: (opts?: { connection?: ConnectionDto; database?: string }) => void;
  applyQueryContext: (connection: ConnectionDto, database: string) => void;
  closeTab: (id: string) => boolean;
  closeQueryTab: (id: string) => boolean;
  setActiveTab: (id: string) => void;
  setActiveQuery: (id: string) => void;
  updateQueryTab: (
    id: string,
    patch: Partial<
      Pick<QueryTab, "sql" | "title" | "database" | "connectionId" | "connectionName" | "connectionEngine" | "dirty">
    >,
  ) => void;
  markTabDirty: (id: string, dirty: boolean) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeConnectionId: null,
  activeConnection: null,
  selectedDatabase: null,
  selectedTable: null,
  selectedFolder: null,
  selectionKind: "none",
  centerMode: "welcome",
  toolbarAction: "connection",
  placeholderFeature: null,
  objectListFilter: "",
  focusObjectListFilter: false,
  tabs: [],
  activeTabId: null,
  queryTabs: [],
  activeQueryId: null,
  openConnection: (conn) =>
    set({
      activeConnectionId: conn.id,
      activeConnection: conn,
      selectedDatabase: conn.database?.trim() || null,
      selectedTable: null,
      selectedFolder: conn.database?.trim() ? "tables" : null,
      selectionKind: "connection",
      centerMode: conn.database?.trim() ? "objectList" : "welcome",
      toolbarAction: "table",
      placeholderFeature: null,
    }),
  clearConnection: () =>
    set({
      activeConnectionId: null,
      activeConnection: null,
      selectedDatabase: null,
      selectedTable: null,
      selectedFolder: null,
      selectionKind: "none",
      centerMode: "welcome",
      toolbarAction: "connection",
      placeholderFeature: null,
      objectListFilter: "",
      focusObjectListFilter: false,
      tabs: [],
      activeTabId: null,
      queryTabs: [],
      activeQueryId: null,
    }),
  clearDatabaseSelection: () =>
    set({
      selectedDatabase: null,
      selectedTable: null,
      selectedFolder: null,
      selectionKind: get().activeConnectionId ? "connection" : "none",
      centerMode: get().activeQueryId
        ? "query"
        : get().activeTabId
          ? "table"
          : "welcome",
      toolbarAction: "connection",
      placeholderFeature: null,
      objectListFilter: "",
      focusObjectListFilter: false,
      activeTabId: get().activeTabId,
    }),
  selectDatabase: (database) =>
    set({
      selectedDatabase: database,
      selectedTable: null,
      selectedFolder: "tables",
      selectionKind: "database",
      centerMode: "objectList",
      toolbarAction: "table",
      placeholderFeature: null,
      objectListFilter: "",
      focusObjectListFilter: false,
      activeTabId: null,
      activeQueryId: null,
    }),
  selectObjectFolder: (database, folder) => {
    if (folder === "queries") {
      set({
        selectedDatabase: database,
        selectedFolder: folder,
        selectedTable: null,
        selectionKind: "folder",
        placeholderFeature: null,
        toolbarAction: "query",
      });
      const { queryTabs, activeQueryId } = get();
      if (activeQueryId && queryTabs.some((t) => t.id === activeQueryId)) {
        set({ centerMode: "query" });
      } else if (queryTabs.length > 0) {
        get().setActiveQuery(queryTabs[queryTabs.length - 1]!.id);
      } else {
        get().openQuery({ database });
      }
      return;
    }
    const listable = folder === "tables" || folder === "views";
    set({
      selectedDatabase: database,
      selectedFolder: folder,
      selectedTable: null,
      selectionKind: "folder",
      centerMode: listable ? "objectList" : "placeholder",
      placeholderFeature: listable
        ? null
        : folder === "functions"
          ? "function"
          : folder === "backups"
            ? "backup"
            : folder === "events"
              ? "automation"
              : folder,
      toolbarAction:
        folder === "tables"
          ? "table"
          : folder === "views"
            ? "view"
            : folder === "functions"
              ? "function"
              : folder === "backups"
                ? "backup"
                : "table",
      activeTabId: null,
    });
  },
  selectTableMeta: (table) =>
    set({
      selectedTable: table,
      selectionKind: table
        ? "table"
        : get().selectedFolder
          ? "folder"
          : get().selectedDatabase
            ? "database"
            : "connection",
    }),
  setCenterMode: (mode) => set({ centerMode: mode, placeholderFeature: null }),
  setObjectListFilter: (filter, focus = false) =>
    set({
      objectListFilter: filter,
      focusObjectListFilter: focus,
    }),
  consumeObjectListFilterFocus: () => set({ focusObjectListFilter: false }),
  setToolbarAction: (action, placeholder = null) => {
    if (placeholder) {
      set({
        toolbarAction: action,
        centerMode: "placeholder",
        placeholderFeature: placeholder,
        activeTabId: null,
      });
      return;
    }
    if (action === "query") {
      set({
        toolbarAction: action,
        placeholderFeature: null,
      });
      get().openQuery();
      return;
    }
    if (action === "table") {
      set({
        toolbarAction: action,
        centerMode: get().selectedDatabase ? "objectList" : "welcome",
        placeholderFeature: null,
        activeTabId: null,
      });
      return;
    }
    if (action === "connection") {
      set({
        toolbarAction: action,
        centerMode: "welcome",
        placeholderFeature: null,
        activeTabId: null,
      });
      return;
    }
    set({
      toolbarAction: action,
      centerMode: "placeholder",
      placeholderFeature: action,
      activeTabId: null,
    });
  },
  openTable: (table) => {
    const { activeConnectionId, activeConnection, tabs } = get();
    if (!activeConnectionId || !activeConnection) return;
    const id = `${activeConnectionId}:${table}`;
    const exists = tabs.find((t) => t.id === id);
    if (exists) {
      set({
        activeTabId: id,
        activeQueryId: null,
        centerMode: "table",
        selectedTable: table,
        selectionKind: "table",
        toolbarAction: "table",
        placeholderFeature: null,
      });
      return;
    }
    set({
      tabs: [
        ...tabs,
        {
          id,
          connectionId: activeConnectionId,
          connectionName: activeConnection.name,
          connectionEngine: String(activeConnection.engine),
          table,
          dirty: false,
        },
      ],
      activeTabId: id,
      activeQueryId: null,
      centerMode: "table",
      selectedTable: table,
      selectionKind: "table",
      toolbarAction: "table",
      placeholderFeature: null,
    });
  },
  openQuery: (opts) => {
    const conn = opts?.connection ?? get().activeConnection;
    if (!conn) return;
    const database =
      opts?.database?.trim() ||
      get().selectedDatabase ||
      conn.database?.trim() ||
      "";
    const id = `query-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tab: QueryTab = {
      id,
      title: "无标题",
      connectionId: conn.id,
      connectionName: conn.name,
      connectionEngine: String(conn.engine),
      database,
      sql: "",
      dirty: false,
    };
    set({
      activeConnectionId: conn.id,
      activeConnection: conn,
      selectedDatabase: database || null,
      selectedFolder: "queries",
      selectedTable: null,
      // Inspector shows connection details while editing a query (Navicat-like).
      selectionKind: "connection",
      queryTabs: [...get().queryTabs, tab],
      activeQueryId: id,
      activeTabId: null,
      centerMode: "query",
      toolbarAction: "query",
      placeholderFeature: null,
    });
  },
  applyQueryContext: (connection, database) =>
    set({
      activeConnectionId: connection.id,
      activeConnection: connection,
      selectedDatabase: database || null,
      selectedTable: null,
      selectedFolder: "queries",
      selectionKind: "connection",
      centerMode: "query",
      toolbarAction: "query",
      placeholderFeature: null,
      activeTabId: null,
    }),
  closeTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (tab?.dirty) {
      const ok = window.confirm(`「${tab.table}」有未保存更改，确定关闭？`);
      if (!ok) return false;
    }
    const tabs = get().tabs.filter((t) => t.id !== id);
    const closingActive = get().activeTabId === id;
    const activeTabId = closingActive
      ? (tabs[tabs.length - 1]?.id ?? null)
      : get().activeTabId;
    const fallbackQuery = get().activeQueryId;
    set({
      tabs,
      activeTabId,
      centerMode: activeTabId
        ? "table"
        : fallbackQuery
          ? "query"
          : get().selectedDatabase
            ? "objectList"
            : "welcome",
    });
    return true;
  },
  closeQueryTab: (id) => {
    const tab = get().queryTabs.find((t) => t.id === id);
    if (!tab) return false;
    // Only prompt when named/saved query has edits — avoid stuck confirms in Tauri.
    if (tab.dirty && tab.sql.trim() && tab.title !== "无标题") {
      const ok = window.confirm(`「${tab.title}」有未保存更改，确定关闭？`);
      if (!ok) return false;
    }
    const queryTabs = get().queryTabs.filter((t) => t.id !== id);
    const closingActive = get().activeQueryId === id;
    const activeQueryId = closingActive
      ? (queryTabs[queryTabs.length - 1]?.id ?? null)
      : get().activeQueryId;
    set({
      queryTabs,
      activeQueryId,
      centerMode: activeQueryId
        ? "query"
        : get().activeTabId
          ? "table"
          : get().selectedDatabase
            ? "objectList"
            : "welcome",
      toolbarAction: activeQueryId ? "query" : get().toolbarAction,
    });
    return true;
  },
  setActiveTab: (id) =>
    set({
      activeTabId: id,
      activeQueryId: null,
      centerMode: "table",
      toolbarAction: "table",
      placeholderFeature: null,
      selectedTable: get().tabs.find((t) => t.id === id)?.table ?? null,
      selectionKind: "table",
    }),
  setActiveQuery: (id) => {
    const tab = get().queryTabs.find((t) => t.id === id);
    if (!tab) return;
    const sameConn = get().activeConnection?.id === tab.connectionId;
    set({
      activeQueryId: id,
      activeTabId: null,
      centerMode: "query",
      toolbarAction: "query",
      placeholderFeature: null,
      selectedDatabase: tab.database || null,
      selectedFolder: "queries",
      selectedTable: null,
      selectionKind: "connection",
      // Keep connection object if id matches; QueryEditor will re-bind full DTO.
      ...(sameConn
        ? {}
        : {
            activeConnectionId: tab.connectionId,
          }),
    });
  },
  updateQueryTab: (id, patch) => {
    set({
      queryTabs: get().queryTabs.map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    });
    if (id === get().activeQueryId) {
      if (patch.database !== undefined) {
        set({ selectedDatabase: patch.database || null });
      }
      if (patch.connectionName !== undefined || patch.connectionId !== undefined) {
        set({ selectionKind: "connection" });
      }
    }
  },
  markTabDirty: (id, dirty) =>
    set({
      tabs: get().tabs.map((t) => (t.id === id ? { ...t, dirty } : t)),
    }),
}));
