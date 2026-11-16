import { create } from "zustand";
import type { ConnectionDto } from "../features/connections/types";

export type TableOpenOptions = {
  sortCol?: string;
  sortDir?: "ASC" | "DESC";
  filterCol?: string;
  filterValue?: string;
  pageSize?: number;
};

export type TableTab = {
  id: string;
  connectionId: string;
  connectionName: string;
  connectionEngine: string;
  /** Database this table tab was opened from. */
  database: string;
  table: string;
  dirty?: boolean;
  /** Applied when opening via a saved table profile. */
  openOptions?: TableOpenOptions | null;
};

export type DatabaseRelatedTabs = {
  tables: TableTab[];
  queries: QueryTab[];
  designers: DesignerTab[];
  dirtyTables: TableTab[];
  dirtyQueries: QueryTab[];
  dirtyDesigners: DesignerTab[];
};

export type CloseDatabaseWorkspaceResult = {
  ok: boolean;
  /** When save was requested but a dirty table tab blocks close. */
  blockedByTableId?: string;
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
  /** Persisted saved_queries.id when linked to a stored query. */
  savedQueryId?: string | null;
};

export type DesignerTab = {
  id: string;
  connectionId: string;
  connectionName: string;
  connectionEngine: string;
  database: string;
  table: string;
  mode: "create" | "alter";
  /** table (default), view, function/procedure, or event designer */
  kind?: "table" | "view" | "function" | "event";
  /** Only for kind === "function" */
  routineType?: "FUNCTION" | "PROCEDURE";
  /** Initial CREATE SQL from function wizard */
  seedSql?: string;
  dirty?: boolean;
  seedColumns?: {
    name: string;
    rawType: string;
    nullable: boolean;
    isPk: boolean;
  }[];
};

export type CenterMode =
  | "welcome"
  | "objectList"
  | "table"
  | "table-designer"
  | "query"
  | "console"
  | "placeholder";

export type ToolbarAction =
  | "connection"
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
  designerTabs: DesignerTab[];
  activeDesignerId: string | null;
  /** When set, QueryEditor should auto-run this tab once after mount. */
  pendingQueryAutoRunId: string | null;
  openConnection: (conn: ConnectionDto) => void;
  clearConnection: () => void;
  clearDatabaseSelection: () => void;
  selectDatabase: (database: string) => void;
  selectObjectFolder: (database: string, folder: ObjectFolder) => void;
  selectTableMeta: (table: string | null) => void;
  setCenterMode: (mode: CenterMode) => void;
  /** Activate Console for a connection (optional database context). */
  openConsole: (opts?: {
    connection?: ConnectionDto;
    database?: string | null;
  }) => void;
  setToolbarAction: (action: ToolbarAction, placeholder?: string | null) => void;
  setObjectListFilter: (filter: string, focus?: boolean) => void;
  consumeObjectListFilterFocus: () => void;
  openTable: (table: string, openOptions?: TableOpenOptions | null) => void;
  openTableDesigner: (opts: {
    connection?: ConnectionDto;
    database?: string;
    table: string;
    mode: "create" | "alter";
    /** Optional seed columns for create mode. */
    seedColumns?: {
      name: string;
      rawType: string;
      nullable: boolean;
      isPk: boolean;
    }[];
  }) => string | null;
  openViewDesigner: (opts: {
    connection?: ConnectionDto;
    database?: string;
    view: string;
    mode: "create" | "alter";
  }) => string | null;
  openFunctionDesigner: (opts: {
    connection?: ConnectionDto;
    database?: string;
    routine: string;
    mode: "create" | "alter";
    routineType?: "FUNCTION" | "PROCEDURE";
    seedSql?: string;
  }) => string | null;
  openEventDesigner: (opts: {
    connection?: ConnectionDto;
    database?: string;
    event: string;
    mode: "create" | "alter";
  }) => string | null;
  setActiveDesigner: (id: string) => void;
  closeDesignerTab: (id: string, opts?: { force?: boolean }) => boolean;
  markDesignerDirty: (id: string, dirty: boolean) => void;
  updateDesignerTab: (
    id: string,
    patch: Partial<
      Pick<DesignerTab, "table" | "dirty" | "mode" | "routineType">
    >,
  ) => void;
  /** After CREATE TABLE succeeds: switch create tab → alter and retarget id. */
  promoteDesignerToAlter: (id: string, tableName: string) => string | null;
  openQuery: (opts?: {
    connection?: ConnectionDto;
    database?: string;
    title?: string;
    sql?: string;
    savedQueryId?: string;
    /** Open then auto-run all statements (e.g. SQL file). */
    autoRun?: boolean;
  }) => string | null;
  consumePendingQueryAutoRun: () => string | null;
  applyQueryContext: (connection: ConnectionDto, database: string) => void;
  closeTab: (id: string, opts?: { force?: boolean }) => boolean;
  closeQueryTab: (id: string, opts?: { force?: boolean }) => boolean;
  setActiveTab: (id: string) => void;
  setActiveQuery: (id: string) => void;
  updateQueryTab: (
    id: string,
    patch: Partial<
      Pick<
        QueryTab,
        | "sql"
        | "title"
        | "database"
        | "connectionId"
        | "connectionName"
        | "connectionEngine"
        | "dirty"
        | "savedQueryId"
      >
    >,
  ) => void;
  markTabDirty: (id: string, dirty: boolean) => void;
  listTabsForDatabase: (
    connectionId: string,
    database: string,
  ) => DatabaseRelatedTabs;
  listTabsForConnection: (connectionId: string) => DatabaseRelatedTabs;
  /** Force-close related tabs. mode save-queries assumes queries already saved & cleaned. */
  closeDatabaseWorkspace: (
    connectionId: string,
    database: string,
    mode?: "force" | "save-queries",
  ) => CloseDatabaseWorkspaceResult;
  closeConnectionWorkspace: (
    connectionId: string,
    mode?: "force" | "save-queries",
  ) => CloseDatabaseWorkspaceResult;
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
  designerTabs: [],
  activeDesignerId: null,
  pendingQueryAutoRunId: null,
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
      designerTabs: [],
      activeDesignerId: null,
      pendingQueryAutoRunId: null,
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
      const { queryTabs, activeQueryId } = get();
      const hasActive =
        !!activeQueryId && queryTabs.some((t) => t.id === activeQueryId);
      set({
        selectedDatabase: database,
        selectedFolder: folder,
        selectedTable: null,
        selectionKind: "folder",
        placeholderFeature: null,
        toolbarAction: "query",
        centerMode: hasActive
          ? "query"
          : queryTabs.length > 0
            ? "query"
            : get().selectedDatabase
              ? "objectList"
              : "welcome",
        activeQueryId: hasActive
          ? activeQueryId
          : queryTabs.length > 0
            ? queryTabs[queryTabs.length - 1]!.id
            : null,
      });
      return;
    }
    const listable =
      folder === "tables" ||
      folder === "views" ||
      folder === "functions" ||
      folder === "events";
    set({
      selectedDatabase: database,
      selectedFolder: folder,
      selectedTable: null,
      selectionKind: "folder",
      centerMode: listable ? "objectList" : "placeholder",
      placeholderFeature: listable
        ? null
        : folder === "backups"
          ? "backup"
          : folder,
      toolbarAction:
        folder === "tables"
          ? "table"
          : folder === "views"
            ? "view"
            : folder === "functions"
              ? "function"
              : folder === "events"
                ? "automation"
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
  openConsole: (opts) => {
    const conn = opts?.connection ?? get().activeConnection;
    if (!conn) {
      set({ centerMode: "console", placeholderFeature: null });
      return;
    }
    const database =
      opts && "database" in opts
        ? opts.database?.trim() || null
        : get().selectedDatabase || conn.database?.trim() || null;
    set({
      activeConnectionId: conn.id,
      activeConnection: conn,
      selectedDatabase: database,
      selectedTable: null,
      selectedFolder: database ? get().selectedFolder : null,
      selectionKind: database ? "database" : "connection",
      centerMode: "console",
      placeholderFeature: null,
    });
  },
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
    if (
      action === "table" ||
      action === "view" ||
      action === "function" ||
      action === "automation"
    ) {
      const folder =
        action === "table"
          ? "tables"
          : action === "view"
            ? "views"
            : action === "function"
              ? "functions"
              : "events";
      const db = get().selectedDatabase;
      if (db) {
        get().selectObjectFolder(db, folder);
        set({ toolbarAction: action, placeholderFeature: null });
      } else {
        set({
          toolbarAction: action,
          centerMode: "welcome",
          placeholderFeature: null,
          activeTabId: null,
          selectedFolder: folder,
        });
      }
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
  openTable: (table, openOptions = null) => {
    const { activeConnectionId, activeConnection, tabs, selectedDatabase } =
      get();
    if (!activeConnectionId || !activeConnection) {
      window.alert("请先打开一个连接。");
      return;
    }
    const database =
      selectedDatabase?.trim() ||
      activeConnection.database?.trim() ||
      "";
    if (!database) {
      window.alert("请先选择数据库，再打开表。");
      return;
    }
    const id = `${activeConnectionId}:${database}:${table}`;
    const exists = tabs.find((t) => t.id === id);
    if (exists) {
      set({
        tabs: tabs.map((t) =>
          t.id === id ? { ...t, openOptions: openOptions ?? null } : t,
        ),
        activeTabId: id,
        activeQueryId: null,
        activeDesignerId: null,
        centerMode: "table",
        selectedDatabase: database,
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
          database,
          table,
          dirty: false,
          openOptions: openOptions ?? null,
        },
      ],
      activeTabId: id,
      activeQueryId: null,
      activeDesignerId: null,
      centerMode: "table",
      selectedDatabase: database,
      selectedTable: table,
      selectionKind: "table",
      toolbarAction: "table",
      placeholderFeature: null,
    });
  },
  openTableDesigner: (opts) => {
    const conn = opts.connection ?? get().activeConnection;
    if (!conn) {
      window.alert("请先打开一个连接。");
      return null;
    }
    const database =
      opts.database?.trim() ||
      get().selectedDatabase ||
      conn.database?.trim() ||
      "";
    if (!database) {
      window.alert("请先选择数据库，再设计表。");
      return null;
    }
    const table = opts.table.trim() || "new_table";
    const id =
      opts.mode === "create"
        ? `designer-create-${conn.id}:${database}:${Date.now()}`
        : `designer:${conn.id}:${database}:${table}`;
    const existing =
      opts.mode === "alter"
        ? get().designerTabs.find((t) => t.id === id)
        : undefined;
    if (existing) {
      set({
        activeConnectionId: conn.id,
        activeConnection: conn,
        selectedDatabase: database,
        selectedTable: table,
        selectionKind: "table",
        activeDesignerId: existing.id,
        activeTabId: null,
        activeQueryId: null,
        centerMode: "table-designer",
        toolbarAction: "table",
        placeholderFeature: null,
      });
      return existing.id;
    }
    const tab: DesignerTab = {
      id,
      connectionId: conn.id,
      connectionName: conn.name,
      connectionEngine: String(conn.engine),
      database,
      table,
      mode: opts.mode,
      kind: "table",
      dirty: false,
      seedColumns: opts.seedColumns,
    };
    set({
      activeConnectionId: conn.id,
      activeConnection: conn,
      selectedDatabase: database,
      selectedTable: opts.mode === "alter" ? table : null,
      selectionKind: "table",
      designerTabs: [...get().designerTabs, tab],
      activeDesignerId: id,
      activeTabId: null,
      activeQueryId: null,
      centerMode: "table-designer",
      toolbarAction: "table",
      placeholderFeature: null,
    });
    return id;
  },
  openViewDesigner: (opts) => {
    const conn = opts.connection ?? get().activeConnection;
    if (!conn) {
      window.alert("请先打开一个连接。");
      return null;
    }
    const database =
      opts.database?.trim() ||
      get().selectedDatabase ||
      conn.database?.trim() ||
      "";
    if (!database) {
      window.alert("请先选择数据库，再设计视图。");
      return null;
    }
    const view = opts.view.trim() || "new_view";
    const id =
      opts.mode === "create"
        ? `view-designer-create-${conn.id}:${database}:${Date.now()}`
        : `view-designer:${conn.id}:${database}:${view}`;
    const existing =
      opts.mode === "alter"
        ? get().designerTabs.find((t) => t.id === id)
        : undefined;
    if (existing) {
      set({
        activeConnectionId: conn.id,
        activeConnection: conn,
        selectedDatabase: database,
        selectedTable: view,
        selectedFolder: "views",
        selectionKind: "table",
        activeDesignerId: existing.id,
        activeTabId: null,
        activeQueryId: null,
        centerMode: "table-designer",
        toolbarAction: "view",
        placeholderFeature: null,
      });
      return existing.id;
    }
    const tab: DesignerTab = {
      id,
      connectionId: conn.id,
      connectionName: conn.name,
      connectionEngine: String(conn.engine),
      database,
      table: view,
      mode: opts.mode,
      kind: "view",
      dirty: false,
    };
    set({
      activeConnectionId: conn.id,
      activeConnection: conn,
      selectedDatabase: database,
      selectedTable: opts.mode === "alter" ? view : null,
      selectedFolder: "views",
      selectionKind: "table",
      designerTabs: [...get().designerTabs, tab],
      activeDesignerId: id,
      activeTabId: null,
      activeQueryId: null,
      centerMode: "table-designer",
      toolbarAction: "view",
      placeholderFeature: null,
    });
    return id;
  },
  openFunctionDesigner: (opts) => {
    const conn = opts.connection ?? get().activeConnection;
    if (!conn) {
      window.alert("请先打开一个连接。");
      return null;
    }
    const database =
      opts.database?.trim() ||
      get().selectedDatabase ||
      conn.database?.trim() ||
      "";
    if (!database) {
      window.alert("请先选择数据库，再设计函数。");
      return null;
    }
    const routine = opts.routine.trim() || "NewFunc";
    const routineType = opts.routineType ?? "FUNCTION";
    const id =
      opts.mode === "create"
        ? `fn-designer-create-${conn.id}:${database}:${Date.now()}`
        : `fn-designer:${conn.id}:${database}:${routine}`;
    const existing =
      opts.mode === "alter"
        ? get().designerTabs.find((t) => t.id === id)
        : undefined;
    if (existing) {
      set({
        activeConnectionId: conn.id,
        activeConnection: conn,
        selectedDatabase: database,
        selectedTable: routine,
        selectedFolder: "functions",
        selectionKind: "table",
        activeDesignerId: existing.id,
        activeTabId: null,
        activeQueryId: null,
        centerMode: "table-designer",
        toolbarAction: "function",
        placeholderFeature: null,
      });
      return existing.id;
    }
    const tab: DesignerTab = {
      id,
      connectionId: conn.id,
      connectionName: conn.name,
      connectionEngine: String(conn.engine),
      database,
      table: routine,
      mode: opts.mode,
      kind: "function",
      routineType,
      seedSql: opts.seedSql,
      dirty: false,
    };
    set({
      activeConnectionId: conn.id,
      activeConnection: conn,
      selectedDatabase: database,
      selectedTable: opts.mode === "alter" ? routine : null,
      selectedFolder: "functions",
      selectionKind: "table",
      designerTabs: [...get().designerTabs, tab],
      activeDesignerId: id,
      activeTabId: null,
      activeQueryId: null,
      centerMode: "table-designer",
      toolbarAction: "function",
      placeholderFeature: null,
    });
    return id;
  },
  openEventDesigner: (opts) => {
    const conn = opts.connection ?? get().activeConnection;
    if (!conn) {
      window.alert("请先打开一个连接。");
      return null;
    }
    const database =
      opts.database?.trim() ||
      get().selectedDatabase ||
      conn.database?.trim() ||
      "";
    if (!database) {
      window.alert("请先选择数据库，再设计事件。");
      return null;
    }
    const event = opts.event.trim() || "Untitled";
    const id =
      opts.mode === "create"
        ? `ev-designer-create-${conn.id}:${database}:${Date.now()}`
        : `ev-designer:${conn.id}:${database}:${event}`;
    const existing =
      opts.mode === "alter"
        ? get().designerTabs.find((t) => t.id === id)
        : undefined;
    if (existing) {
      set({
        activeConnectionId: conn.id,
        activeConnection: conn,
        selectedDatabase: database,
        selectedTable: event,
        selectedFolder: "events",
        selectionKind: "table",
        activeDesignerId: existing.id,
        activeTabId: null,
        activeQueryId: null,
        centerMode: "table-designer",
        toolbarAction: "automation",
        placeholderFeature: null,
      });
      return existing.id;
    }
    const tab: DesignerTab = {
      id,
      connectionId: conn.id,
      connectionName: conn.name,
      connectionEngine: String(conn.engine),
      database,
      table: event,
      mode: opts.mode,
      kind: "event",
      dirty: false,
    };
    set({
      activeConnectionId: conn.id,
      activeConnection: conn,
      selectedDatabase: database,
      selectedTable: opts.mode === "alter" ? event : null,
      selectedFolder: "events",
      selectionKind: "table",
      designerTabs: [...get().designerTabs, tab],
      activeDesignerId: id,
      activeTabId: null,
      activeQueryId: null,
      centerMode: "table-designer",
      toolbarAction: "automation",
      placeholderFeature: null,
    });
    return id;
  },
  setActiveDesigner: (id) => {
    const tab = get().designerTabs.find((t) => t.id === id);
    if (!tab) return;
    const isView = tab.kind === "view";
    const isFn = tab.kind === "function";
    const isEv = tab.kind === "event";
    set({
      activeDesignerId: id,
      activeTabId: null,
      activeQueryId: null,
      centerMode: "table-designer",
      toolbarAction: isEv
        ? "automation"
        : isFn
          ? "function"
          : isView
            ? "view"
            : "table",
      placeholderFeature: null,
      selectedDatabase: tab.database,
      selectedFolder: isEv
        ? "events"
        : isFn
          ? "functions"
          : isView
            ? "views"
            : get().selectedFolder,
      selectedTable: tab.mode === "alter" ? tab.table : null,
      selectionKind: "table",
    });
  },
  closeDesignerTab: (id, opts) => {
    const tab = get().designerTabs.find((t) => t.id === id);
    if (!tab) return false;
    if (!opts?.force && tab.dirty) {
      const obj = tab.kind === "view" ? "视图" : "表";
      const ok = window.confirm(
        tab.mode === "create"
          ? `新建${obj}「${tab.table}」尚未保存，确定关闭并丢弃？`
          : `设计器「${tab.table}」有未保存更改，确定关闭？`,
      );
      if (!ok) return false;
    }
    const designerTabs = get().designerTabs.filter((t) => t.id !== id);
    const closingActive = get().activeDesignerId === id;
    const activeDesignerId = closingActive
      ? (designerTabs[designerTabs.length - 1]?.id ?? null)
      : get().activeDesignerId;
    set({
      designerTabs,
      activeDesignerId,
      centerMode: activeDesignerId
        ? "table-designer"
        : get().activeQueryId
          ? "query"
          : get().activeTabId
            ? "table"
            : get().selectedDatabase
              ? "objectList"
              : "welcome",
    });
    return true;
  },
  markDesignerDirty: (id, dirty) =>
    set({
      designerTabs: get().designerTabs.map((t) =>
        t.id === id ? { ...t, dirty } : t,
      ),
    }),
  updateDesignerTab: (id, patch) =>
    set({
      designerTabs: get().designerTabs.map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    }),
  promoteDesignerToAlter: (id, tableName) => {
    const tab = get().designerTabs.find((t) => t.id === id);
    if (!tab) return null;
    const name = tableName.trim() || tab.table;
    const isView = tab.kind === "view";
    const isFn = tab.kind === "function";
    const isEv = tab.kind === "event";
    const newId = isEv
      ? `ev-designer:${tab.connectionId}:${tab.database}:${name}`
      : isFn
        ? `fn-designer:${tab.connectionId}:${tab.database}:${name}`
        : isView
          ? `view-designer:${tab.connectionId}:${tab.database}:${name}`
          : `designer:${tab.connectionId}:${tab.database}:${name}`;
    const others = get().designerTabs.filter(
      (t) => t.id !== id && t.id !== newId,
    );
    const next: DesignerTab = {
      ...tab,
      id: newId,
      table: name,
      mode: "alter",
      dirty: false,
      seedColumns: undefined,
    };
    set({
      designerTabs: [...others, next],
      activeDesignerId: newId,
      selectedTable: name,
      selectedFolder: isEv
        ? "events"
        : isFn
          ? "functions"
          : isView
            ? "views"
            : get().selectedFolder,
      centerMode: "table-designer",
      toolbarAction: isEv
        ? "automation"
        : isFn
          ? "function"
          : isView
            ? "view"
            : "table",
    });
    return newId;
  },
  openQuery: (opts) => {
    const conn = opts?.connection ?? get().activeConnection;
    if (!conn) return null;
    const database =
      opts?.database?.trim() ||
      get().selectedDatabase ||
      conn.database?.trim() ||
      "";
    // Reuse tab if opening the same saved query.
    if (opts?.savedQueryId) {
      const existing = get().queryTabs.find(
        (t) => t.savedQueryId === opts.savedQueryId,
      );
      if (existing) {
        set({
          activeConnectionId: conn.id,
          activeConnection: conn,
          selectedDatabase: database || existing.database || null,
          selectedFolder: "queries",
          selectedTable: null,
          selectionKind: "connection",
          activeQueryId: existing.id,
          activeTabId: null,
          centerMode: "query",
          toolbarAction: "query",
          placeholderFeature: null,
          pendingQueryAutoRunId: opts?.autoRun ? existing.id : null,
        });
        return existing.id;
      }
    }
    const id = `query-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tab: QueryTab = {
      id,
      title: opts?.title?.trim() || "无标题",
      connectionId: conn.id,
      connectionName: conn.name,
      connectionEngine: String(conn.engine),
      database,
      sql: opts?.sql ?? "",
      dirty: Boolean(opts?.sql && !opts?.savedQueryId),
      savedQueryId: opts?.savedQueryId ?? null,
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
      pendingQueryAutoRunId: opts?.autoRun ? id : null,
    });
    return id;
  },
  consumePendingQueryAutoRun: () => {
    const id = get().pendingQueryAutoRunId;
    if (!id) return null;
    set({ pendingQueryAutoRunId: null });
    return id;
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
  closeTab: (id, opts) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return false;
    if (!opts?.force && tab.dirty) {
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
  closeQueryTab: (id, opts) => {
    const tab = get().queryTabs.find((t) => t.id === id);
    if (!tab) return false;
    if (!opts?.force && tab.dirty && tab.sql.trim()) {
      const label = tab.title?.trim() || "无标题";
      const ok = window.confirm(
        `「${label}」有未保存更改，关闭将丢失修改。确定关闭？`,
      );
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
  setActiveTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    set({
      activeTabId: id,
      activeQueryId: null,
      activeDesignerId: null,
      centerMode: "table",
      toolbarAction: "table",
      placeholderFeature: null,
      selectedDatabase: tab?.database || get().selectedDatabase,
      selectedTable: tab?.table ?? null,
      selectionKind: "table",
    });
  },
  setActiveQuery: (id) => {
    const tab = get().queryTabs.find((t) => t.id === id);
    if (!tab) return;
    const sameConn = get().activeConnection?.id === tab.connectionId;
    set({
      activeQueryId: id,
      activeTabId: null,
      activeDesignerId: null,
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
  listTabsForDatabase: (connectionId, database) => {
    const tables = get().tabs.filter(
      (t) => t.connectionId === connectionId && t.database === database,
    );
    const queries = get().queryTabs.filter(
      (t) => t.connectionId === connectionId && t.database === database,
    );
    const designers = get().designerTabs.filter(
      (t) => t.connectionId === connectionId && t.database === database,
    );
    return {
      tables,
      queries,
      designers,
      dirtyTables: tables.filter((t) => t.dirty),
      dirtyQueries: queries.filter((t) => t.dirty && t.sql.trim().length > 0),
      dirtyDesigners: designers.filter((t) => t.dirty),
    };
  },
  listTabsForConnection: (connectionId) => {
    const tables = get().tabs.filter((t) => t.connectionId === connectionId);
    const queries = get().queryTabs.filter(
      (t) => t.connectionId === connectionId,
    );
    const designers = get().designerTabs.filter(
      (t) => t.connectionId === connectionId,
    );
    return {
      tables,
      queries,
      designers,
      dirtyTables: tables.filter((t) => t.dirty),
      dirtyQueries: queries.filter((t) => t.dirty && t.sql.trim().length > 0),
      dirtyDesigners: designers.filter((t) => t.dirty),
    };
  },
  closeDatabaseWorkspace: (connectionId, database, mode = "force") => {
    const related = get().listTabsForDatabase(connectionId, database);
    if (
      mode === "save-queries" &&
      (related.dirtyTables.length > 0 || related.dirtyDesigners.length > 0)
    ) {
      return {
        ok: false,
        blockedByTableId:
          related.dirtyTables[0]?.id ?? related.dirtyDesigners[0]?.id,
      };
    }

    const tabs = get().tabs.filter(
      (t) => !(t.connectionId === connectionId && t.database === database),
    );
    const queryTabs = get().queryTabs.filter(
      (t) => !(t.connectionId === connectionId && t.database === database),
    );
    const designerTabs = get().designerTabs.filter(
      (t) => !(t.connectionId === connectionId && t.database === database),
    );
    const activeTabId = tabs.some((t) => t.id === get().activeTabId)
      ? get().activeTabId
      : (tabs[tabs.length - 1]?.id ?? null);
    const activeQueryId = queryTabs.some((t) => t.id === get().activeQueryId)
      ? get().activeQueryId
      : (queryTabs[queryTabs.length - 1]?.id ?? null);
    const activeDesignerId = designerTabs.some(
      (t) => t.id === get().activeDesignerId,
    )
      ? get().activeDesignerId
      : (designerTabs[designerTabs.length - 1]?.id ?? null);

    const clearingSelection =
      get().activeConnectionId === connectionId &&
      get().selectedDatabase === database;

    set({
      tabs,
      queryTabs,
      designerTabs,
      activeTabId,
      activeQueryId,
      activeDesignerId,
      ...(clearingSelection
        ? {
            selectedDatabase: null,
            selectedTable: null,
            selectedFolder: null,
            selectionKind: get().activeConnectionId ? "connection" : "none",
            objectListFilter: "",
            focusObjectListFilter: false,
          }
        : {}),
      centerMode: activeDesignerId
        ? "table-designer"
        : activeQueryId
          ? "query"
          : activeTabId
            ? "table"
            : clearingSelection
              ? "welcome"
              : get().selectedDatabase
                ? "objectList"
                : "welcome",
      toolbarAction: activeQueryId
        ? "query"
        : activeTabId || activeDesignerId
          ? "table"
          : "connection",
      placeholderFeature: null,
    });
    return { ok: true };
  },
  closeConnectionWorkspace: (connectionId, mode = "force") => {
    const related = get().listTabsForConnection(connectionId);
    if (
      mode === "save-queries" &&
      (related.dirtyTables.length > 0 || related.dirtyDesigners.length > 0)
    ) {
      return {
        ok: false,
        blockedByTableId:
          related.dirtyTables[0]?.id ?? related.dirtyDesigners[0]?.id,
      };
    }

    const tabs = get().tabs.filter((t) => t.connectionId !== connectionId);
    const queryTabs = get().queryTabs.filter(
      (t) => t.connectionId !== connectionId,
    );
    const designerTabs = get().designerTabs.filter(
      (t) => t.connectionId !== connectionId,
    );
    const activeTabId = tabs.some((t) => t.id === get().activeTabId)
      ? get().activeTabId
      : (tabs[tabs.length - 1]?.id ?? null);
    const activeQueryId = queryTabs.some((t) => t.id === get().activeQueryId)
      ? get().activeQueryId
      : (queryTabs[queryTabs.length - 1]?.id ?? null);
    const activeDesignerId = designerTabs.some(
      (t) => t.id === get().activeDesignerId,
    )
      ? get().activeDesignerId
      : (designerTabs[designerTabs.length - 1]?.id ?? null);

    const clearing = get().activeConnectionId === connectionId;

    set({
      tabs,
      queryTabs,
      designerTabs,
      activeTabId,
      activeQueryId,
      activeDesignerId,
      ...(clearing
        ? {
            activeConnectionId: null,
            activeConnection: null,
            selectedDatabase: null,
            selectedTable: null,
            selectedFolder: null,
            selectionKind: "none",
            objectListFilter: "",
            focusObjectListFilter: false,
          }
        : {}),
      centerMode: activeDesignerId
        ? "table-designer"
        : activeQueryId
          ? "query"
          : activeTabId
            ? "table"
            : "welcome",
      toolbarAction: activeQueryId
        ? "query"
        : activeTabId || activeDesignerId
          ? "table"
          : "connection",
      placeholderFeature: null,
    });
    return { ok: true };
  },
}));
