import { create } from "zustand";
import type { ConnectionDto } from "../features/connections/types";
import type { QueryBatchItem } from "../features/query/QueryResultPanel";
import { confirmCloseDialog, confirmDialog } from "../lib/confirm";
import { hasTabSaver, runTabSaver } from "../lib/tabSavers";
import { upsertSavedQuery } from "../features/query/savedQueriesApi";

/** 调用页签自己的保存动作，并确认已不再 dirty */
async function saveTabThenVerify(id: string): Promise<boolean> {
  const ran = await runTabSaver(id);
  if (!ran) return false;
  // 表格的 dirty 由组件渲染后回写，稍等一拍再判断
  for (let i = 0; i < 20; i++) {
    const s = useWorkspaceStore.getState();
    const dirty =
      s.tabs.find((t) => t.id === id)?.dirty ||
      s.queryTabs.find((t) => t.id === id)?.dirty ||
      s.designerTabs.find((t) => t.id === id)?.dirty;
    if (!dirty) return true;
    await new Promise((r) => window.setTimeout(r, 50));
  }
  return false;
}

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

/**
 * 查询页签的执行结果。放在 store 里按页签 id 保存，
 * 这样切到别的 tab / 切换查询页签再回来，结果不会丢。
 */
export type QueryRunState = {
  items: QueryBatchItem[];
  messages: string[];
  error: string | null;
  status: string | null;
};

export const EMPTY_QUERY_RUN_STATE: QueryRunState = {
  items: [],
  messages: [],
  error: null,
  status: null,
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
  | "redis"
  | "placeholder"
  | "automation"
  | "model"
  | "bi";

export type ToolbarAction =
  | "connection"
  | "table"
  | "view"
  | "function"
  | "query"
  | "backup"
  | "automation"
  | "model"
  | "bi"
  /** 事件文件夹 / 事件设计器（工具栏无独立按钮） */
  | "events";

/** 独立功能面板：切换后关闭页签不应把用户带走 */
const FEATURE_MODES: CenterMode[] = ["automation", "model", "bi"];

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
  /** 按查询页签 id 保存的执行结果 */
  queryResults: Record<string, QueryRunState>;
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
  /** Highlight an object in the nav tree without switching the center pane. */
  revealInNavTree: (
    conn: ConnectionDto,
    opts: { database: string; folder: ObjectFolder; table?: string | null },
  ) => void;
  setCenterMode: (mode: CenterMode) => void;
  /** Activate Console for a connection (optional database context). */
  openConsole: (opts?: {
    connection?: ConnectionDto;
    database?: string | null;
  }) => void;
  /** Open the Redis workspace for a connection/db index. */
  openRedis: (opts?: {
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
  closeDesignerTab: (id: string, opts?: { force?: boolean }) => Promise<boolean>;
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
  closeTab: (id: string, opts?: { force?: boolean }) => Promise<boolean>;
  closeQueryTab: (id: string, opts?: { force?: boolean }) => Promise<boolean>;
  /** 保存查询页签（未命名时自动生成名称） */
  saveQueryTab: (id: string) => Promise<boolean>;
  /** Close several document tabs (query/table/designer ids) in one pass. */
  closeTabsByIds: (ids: string[], opts?: { force?: boolean }) => Promise<boolean>;
  setActiveTab: (id: string) => void;
  setActiveQuery: (id: string) => void;
  /** 更新某个查询页签的执行结果（局部 patch） */
  setQueryRunState: (id: string, patch: Partial<QueryRunState>) => void;
  clearQueryRunState: (id: string) => void;
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
  queryResults: {},
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
      queryResults: {},
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
      folder === "events" ||
      folder === "backups";
    set({
      selectedDatabase: database,
      selectedFolder: folder,
      selectedTable: null,
      selectionKind: "folder",
      centerMode: listable ? "objectList" : "placeholder",
      placeholderFeature: listable ? null : folder,
      toolbarAction:
        folder === "tables"
          ? "table"
          : folder === "views"
            ? "view"
            : folder === "functions"
              ? "function"
              : folder === "events"
                ? "events"
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
  revealInNavTree: (conn, opts) =>
    set({
      activeConnectionId: conn.id,
      activeConnection: conn,
      selectedDatabase: opts.database,
      selectedFolder: opts.folder,
      selectedTable: opts.table ?? null,
      selectionKind: opts.table ? "table" : "folder",
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
  openRedis: (opts) => {
    const conn = opts?.connection ?? get().activeConnection;
    if (!conn) return;
    const database =
      opts && "database" in opts
        ? opts.database?.trim() || "0"
        : get().selectedDatabase || conn.database?.trim() || "0";
    set({
      activeConnectionId: conn.id,
      activeConnection: conn,
      selectedDatabase: database,
      selectedTable: null,
      selectedFolder: null,
      selectionKind: "database",
      centerMode: "redis",
      toolbarAction: "connection",
      placeholderFeature: null,
      activeTabId: null,
      activeQueryId: null,
      activeDesignerId: null,
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
      action === "automation" ||
      action === "model" ||
      action === "bi"
    ) {
      set({
        toolbarAction: action,
        centerMode: action,
        placeholderFeature: null,
      });
      return;
    }
    if (
      action === "table" ||
      action === "view" ||
      action === "function" ||
      action === "backup"
    ) {
      const folder =
        action === "table"
          ? "tables"
          : action === "view"
            ? "views"
            : action === "function"
              ? "functions"
              : "backups";
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
        toolbarAction: "events",
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
      toolbarAction: "events",
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
        ? "events"
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
  closeDesignerTab: async (id, opts) => {
    const tab = get().designerTabs.find((t) => t.id === id);
    if (!tab) return false;
    if (!opts?.force && tab.dirty) {
      const obj = tab.kind === "view" ? "视图" : "表";
      const message =
        tab.mode === "create"
          ? `新建${obj}「${tab.table}」尚未保存，确定关闭？`
          : `设计器「${tab.table}」有未保存更改，确定关闭？`;
      if (hasTabSaver(id)) {
        const choice = await confirmCloseDialog({ message });
        if (choice === "cancel") return false;
        if (choice === "save" && !(await saveTabThenVerify(id))) return false;
      } else {
        const ok = await confirmDialog({
          message,
          confirmText: "关闭并丢弃",
          danger: true,
        });
        if (!ok) return false;
      }
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
        ? "events"
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
  closeTab: async (id, opts) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return false;
    if (!opts?.force && tab.dirty) {
      // 只有组件已挂载（注册了保存器）才提供「保存并关闭」
      if (hasTabSaver(id)) {
        const choice = await confirmCloseDialog({
          message: `「${tab.table}」有未保存更改，确定关闭？`,
        });
        if (choice === "cancel") return false;
        if (choice === "save" && !(await saveTabThenVerify(id))) return false;
      } else {
        const ok = await confirmDialog({
          message: `「${tab.table}」有未保存更改，关闭将丢失修改。确定关闭？`,
          confirmText: "关闭并丢弃",
          danger: true,
        });
        if (!ok) return false;
      }
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
  closeQueryTab: async (id, opts) => {
    const tab = get().queryTabs.find((t) => t.id === id);
    if (!tab) return false;
    if (!opts?.force && tab.dirty && tab.sql.trim()) {
      const label = tab.title?.trim() || "无标题";
      const choice = await confirmCloseDialog({
        message: `「${label}」有未保存更改，确定关闭？`,
      });
      if (choice === "cancel") return false;
      if (choice === "save" && !(await get().saveQueryTab(id))) return false;
    }
    const queryTabs = get().queryTabs.filter((t) => t.id !== id);
    const closingActive = get().activeQueryId === id;
    const activeQueryId = closingActive
      ? (queryTabs[queryTabs.length - 1]?.id ?? null)
      : get().activeQueryId;
    const queryResults = { ...get().queryResults };
    delete queryResults[id];
    set({
      queryTabs,
      activeQueryId,
      queryResults,
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
  saveQueryTab: async (id) => {
    const tab = get().queryTabs.find((t) => t.id === id);
    if (!tab) return false;
    if (!tab.dirty) return true;
    const title = tab.title?.trim();
    const name =
      title && title !== "无标题"
        ? title
        : `未命名查询-${new Date().toISOString().slice(11, 19)}`;
    try {
      const saved = await upsertSavedQuery({
        id: tab.savedQueryId || undefined,
        connectionId: tab.connectionId,
        database: tab.database || null,
        name,
        sql: tab.sql || "",
      });
      get().updateQueryTab(id, {
        title: saved.name,
        savedQueryId: saved.id,
        dirty: false,
      });
      window.dispatchEvent(
        new CustomEvent("saved-queries-changed", {
          detail: {
            connectionId: tab.connectionId,
            database: tab.database || undefined,
          },
        }),
      );
      return true;
    } catch {
      return false;
    }
  },
  closeTabsByIds: async (ids, opts) => {
    const targets = new Set(ids);
    if (targets.size === 0) return true;
    const state = get();
    const dirtyTables = state.tabs.filter((t) => targets.has(t.id) && t.dirty);
    const dirtyQueries = state.queryTabs.filter(
      (t) => targets.has(t.id) && t.dirty && t.sql.trim(),
    );
    const dirtyDesigners = state.designerTabs.filter(
      (t) => targets.has(t.id) && t.dirty,
    );
    if (!opts?.force) {
      const labels = [
        ...dirtyTables.map((t) => `· 表「${t.table}」`),
        ...dirtyQueries.map((t) => `· 查询「${t.title?.trim() || "无标题"}」`),
        ...dirtyDesigners.map((t) =>
          t.mode === "create"
            ? `· 新建${t.kind === "view" ? "视图" : "表"}「${t.table}」`
            : `· 设计器「${t.table}」`,
        ),
      ];
      if (labels.length > 0) {
        // 一次确认全部，避免连续弹 N 个对话框
        const shown = labels.slice(0, 8).join("\n");
        const more =
          labels.length > 8 ? `\n… 等共 ${labels.length} 个页签` : "";
        // 查询由 store 直接保存；表格/设计器需要组件已挂载（注册了保存器）
        const allSavable =
          dirtyTables.every((t) => hasTabSaver(t.id)) &&
          dirtyDesigners.every((t) => hasTabSaver(t.id));
        if (allSavable) {
          const choice = await confirmCloseDialog({
            title: "关闭未保存的页签",
            message: `以下页签有未保存更改：\n${shown}${more}\n\n是否保存后关闭？`,
          });
          if (choice === "cancel") return false;
          if (choice === "save") {
            for (const t of dirtyQueries) {
              if (!(await get().saveQueryTab(t.id))) return false;
            }
            for (const t of [...dirtyTables, ...dirtyDesigners]) {
              if (!(await saveTabThenVerify(t.id))) return false;
            }
          }
        } else {
          const ok = await confirmDialog({
            title: "关闭未保存的页签",
            message: `以下页签有未保存更改，关闭将丢失修改：\n${shown}${more}\n\n确定全部关闭？`,
            confirmText: "全部关闭",
            danger: true,
          });
          if (!ok) return false;
        }
      }
    }

    const tabs = state.tabs.filter((t) => !targets.has(t.id));
    const queryTabs = state.queryTabs.filter((t) => !targets.has(t.id));
    const designerTabs = state.designerTabs.filter((t) => !targets.has(t.id));
    const queryResults = { ...state.queryResults };
    for (const id of targets) delete queryResults[id];
    let activeTabId =
      state.activeTabId && targets.has(state.activeTabId)
        ? (tabs[tabs.length - 1]?.id ?? null)
        : state.activeTabId;
    let activeQueryId =
      state.activeQueryId && targets.has(state.activeQueryId)
        ? (queryTabs[queryTabs.length - 1]?.id ?? null)
        : state.activeQueryId;
    let activeDesignerId =
      state.activeDesignerId && targets.has(state.activeDesignerId)
        ? (designerTabs[designerTabs.length - 1]?.id ?? null)
        : state.activeDesignerId;

    const keepPane =
      state.centerMode === "console" ||
      state.centerMode === "redis" ||
      state.centerMode === "objectList" ||
      state.centerMode === "welcome" ||
      state.centerMode === "placeholder" ||
      FEATURE_MODES.includes(state.centerMode);

    let centerMode: CenterMode;
    if (keepPane) {
      centerMode = state.centerMode;
    } else if (state.centerMode === "table-designer" && activeDesignerId) {
      centerMode = "table-designer";
    } else if (state.centerMode === "query" && activeQueryId) {
      centerMode = "query";
    } else if (state.centerMode === "table" && activeTabId) {
      centerMode = "table";
    } else if (designerTabs.length > 0) {
      activeDesignerId = designerTabs[designerTabs.length - 1]!.id;
      centerMode = "table-designer";
    } else if (tabs.length > 0) {
      activeTabId = tabs[tabs.length - 1]!.id;
      centerMode = "table";
    } else if (queryTabs.length > 0) {
      activeQueryId = queryTabs[queryTabs.length - 1]!.id;
      centerMode = "query";
    } else {
      centerMode = state.selectedDatabase ? "objectList" : "welcome";
    }

    set({
      tabs,
      queryTabs,
      queryResults,
      designerTabs,
      activeTabId,
      activeQueryId,
      activeDesignerId,
      centerMode,
      toolbarAction:
        centerMode === "query"
          ? "query"
          : centerMode === "table"
            ? "table"
            : state.toolbarAction,
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
  setQueryRunState: (id, patch) => {
    set((s) => ({
      queryResults: {
        ...s.queryResults,
        [id]: { ...(s.queryResults[id] ?? EMPTY_QUERY_RUN_STATE), ...patch },
      },
    }));
  },
  clearQueryRunState: (id) => {
    set((s) => {
      if (!s.queryResults[id]) return {};
      const queryResults = { ...s.queryResults };
      delete queryResults[id];
      return { queryResults };
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
    const keepFeature = FEATURE_MODES.includes(get().centerMode);

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
      centerMode: keepFeature
        ? get().centerMode
        : activeDesignerId
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
      toolbarAction: keepFeature
        ? get().toolbarAction
        : activeQueryId
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
    const keepFeature = FEATURE_MODES.includes(get().centerMode);

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
      centerMode: keepFeature
        ? get().centerMode
        : activeDesignerId
          ? "table-designer"
          : activeQueryId
            ? "query"
            : activeTabId
              ? "table"
              : "welcome",
      toolbarAction: keepFeature
        ? get().toolbarAction
        : activeQueryId
          ? "query"
          : activeTabId || activeDesignerId
            ? "table"
            : "connection",
      placeholderFeature: null,
    });
    return { ok: true };
  },
}));
