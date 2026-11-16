import { useEffect, useMemo, useRef, useState } from "react";
import {
  listTables,
  type DbObject,
} from "../connections/sessionApi";
import { useColumnResize } from "../data-grid/useColumnResize";
import {
  TableContextMenu,
  type TableMenuTarget,
} from "../nav-tree/TableContextMenu";
import {
  ViewsFolderContextMenu,
  type ViewsFolderMenuTarget,
} from "../nav-tree/ViewsFolderContextMenu";
import {
  FunctionsFolderContextMenu,
  type FunctionsFolderMenuTarget,
} from "../nav-tree/FunctionsFolderContextMenu";
import {
  RoutineContextMenu,
  type RoutineMenuTarget,
} from "../nav-tree/RoutineContextMenu";
import {
  EventsFolderContextMenu,
  type EventsFolderMenuTarget,
} from "../nav-tree/EventsFolderContextMenu";
import {
  EventContextMenu,
  type EventMenuTarget,
} from "../nav-tree/EventContextMenu";
import { loadTableGroups } from "../nav-tree/tableGroups";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  formatCheckOption,
  formatUpdatable,
  listViewMeta,
  type ViewMeta,
} from "./viewMeta";
import {
  formatRoutineType,
  listRoutineMeta,
  type RoutineMeta,
} from "./routineMeta";
import {
  formatEventSchedule,
  formatEventStatus,
  formatEventType,
  listEventMeta,
  type EventMeta,
} from "./eventMeta";
import { dropTableOrView } from "../nav-tree/tableMenuActions";
import { dropRoutine } from "../nav-tree/routineMenuActions";
import { dropEvent } from "../nav-tree/eventMenuActions";
import { emitTableDataChanged } from "../../lib/tableEvents";
import { RunRoutineDialog } from "../function-designer/RunRoutineDialog";

const TABLE_COLS = [
  { key: "name", label: "名称", defaultWidth: 180 },
  { key: "group", label: "组", defaultWidth: 80 },
  { key: "rows", label: "行", defaultWidth: 72 },
  { key: "dataLength", label: "数据长度", defaultWidth: 96 },
  { key: "engine", label: "引擎", defaultWidth: 88 },
  { key: "createTime", label: "创建日期", defaultWidth: 150 },
  { key: "updateTime", label: "修改日期", defaultWidth: 150 },
  { key: "collation", label: "排序规则", defaultWidth: 160 },
  { key: "comment", label: "注释", defaultWidth: 180 },
] as const;

const VIEW_COLS = [
  { key: "name", label: "名称", defaultWidth: 200 },
  { key: "securityType", label: "SQL 安全性", defaultWidth: 120 },
  { key: "checkOption", label: "检查选项", defaultWidth: 120 },
  { key: "updatable", label: "可以更新", defaultWidth: 100 },
  { key: "definer", label: "定义者", defaultWidth: 160 },
] as const;

const FUNCTION_COLS = [
  { key: "name", label: "名称", defaultWidth: 180 },
  { key: "routineType", label: "类型", defaultWidth: 88 },
  { key: "returns", label: "返回类型", defaultWidth: 120 },
  { key: "definer", label: "定义者", defaultWidth: 140 },
  { key: "securityType", label: "SQL 安全性", defaultWidth: 110 },
  { key: "created", label: "创建日期", defaultWidth: 150 },
  { key: "lastAltered", label: "修改日期", defaultWidth: 150 },
  { key: "comment", label: "注释", defaultWidth: 160 },
] as const;

const EVENT_COLS = [
  { key: "name", label: "名称", defaultWidth: 160 },
  { key: "status", label: "状态", defaultWidth: 88 },
  { key: "eventType", label: "类型", defaultWidth: 88 },
  { key: "schedule", label: "执行计划", defaultWidth: 220 },
  { key: "definer", label: "定义者", defaultWidth: 140 },
  { key: "created", label: "创建日期", defaultWidth: 140 },
  { key: "lastAltered", label: "修改日期", defaultWidth: 140 },
  { key: "lastExecuted", label: "上次执行", defaultWidth: 140 },
  { key: "comment", label: "注释", defaultWidth: 140 },
] as const;

function formatBytes(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRows(n?: number | null) {
  if (n == null) return "—";
  return n.toLocaleString();
}

export function ObjectListGrid() {
  const connection = useWorkspaceStore((s) => s.activeConnection);
  const database = useWorkspaceStore((s) => s.selectedDatabase);
  const folder = useWorkspaceStore((s) => s.selectedFolder);
  const openTable = useWorkspaceStore((s) => s.openTable);
  const openTableDesigner = useWorkspaceStore((s) => s.openTableDesigner);
  const openViewDesigner = useWorkspaceStore((s) => s.openViewDesigner);
  const openFunctionDesigner = useWorkspaceStore((s) => s.openFunctionDesigner);
  const openEventDesigner = useWorkspaceStore((s) => s.openEventDesigner);
  const selectTableMeta = useWorkspaceStore((s) => s.selectTableMeta);
  const selectedTable = useWorkspaceStore((s) => s.selectedTable);
  const objectListFilter = useWorkspaceStore((s) => s.objectListFilter);
  const focusObjectListFilter = useWorkspaceStore(
    (s) => s.focusObjectListFilter,
  );
  const setObjectListFilter = useWorkspaceStore((s) => s.setObjectListFilter);
  const consumeObjectListFilterFocus = useWorkspaceStore(
    (s) => s.consumeObjectListFilterFocus,
  );
  const [tables, setTables] = useState<DbObject[]>([]);
  const [routines, setRoutines] = useState<RoutineMeta[]>([]);
  const [events, setEvents] = useState<EventMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState<TableMenuTarget | null>(null);
  const [routineMenu, setRoutineMenu] = useState<RoutineMenuTarget | null>(
    null,
  );
  const [eventMenu, setEventMenu] = useState<EventMenuTarget | null>(null);
  const [viewsFolderMenu, setViewsFolderMenu] =
    useState<ViewsFolderMenuTarget | null>(null);
  const [functionsFolderMenu, setFunctionsFolderMenu] =
    useState<FunctionsFolderMenuTarget | null>(null);
  const [eventsFolderMenu, setEventsFolderMenu] =
    useState<EventsFolderMenuTarget | null>(null);
  const [groupMap, setGroupMap] = useState<Record<string, string>>({});
  const [viewMetaMap, setViewMetaMap] = useState<Record<string, ViewMeta>>({});
  const [routineMetaMap, setRoutineMetaMap] = useState<
    Record<string, RoutineMeta>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const listResetKey = useMemo(
    () => `${connection?.id ?? ""}:${database ?? ""}:${folder ?? ""}`,
    [connection?.id, database, folder],
  );
  const { widths: colWidths, startResize } = useColumnResize({
    defaultWidth: 120,
    minWidth: 48,
    resetKey: listResetKey,
  });
  function colW(key: string, fallback: number) {
    return colWidths[key] ?? fallback;
  }

  const wantViews = folder === "views";
  const wantFunctions = folder === "functions";
  const wantEvents = folder === "events";
  const title = wantEvents
    ? "事件"
    : wantFunctions
      ? "函数"
      : wantViews
        ? "视图"
        : "表";

  useEffect(() => {
    setFilter(objectListFilter);
  }, [objectListFilter]);

  useEffect(() => {
    if (!focusObjectListFilter) return;
    filterRef.current?.focus();
    filterRef.current?.select();
    consumeObjectListFilterFocus();
  }, [focusObjectListFilter, consumeObjectListFilterFocus]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".dg-context-menu, .modal, .modal-backdrop")) return;
      setMenu(null);
      setViewsFolderMenu(null);
      setFunctionsFolderMenu(null);
      setEventsFolderMenu(null);
      setRoutineMenu(null);
      setEventMenu(null);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  useEffect(() => {
    function onRefresh() {
      setTick((x) => x + 1);
    }
    window.addEventListener("mycat:object-list-refresh", onRefresh);
    return () =>
      window.removeEventListener("mycat:object-list-refresh", onRefresh);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!connection || !database) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "r") {
        e.preventDefault();
        setTick((x) => x + 1);
        return;
      }
      if (key === "o" && selectedTable) {
        e.preventDefault();
        if (wantFunctions) {
          setRunOpen(true);
        } else if (!wantEvents) {
          openTable(selectedTable);
        }
        return;
      }
      if (key === "d" && selectedTable) {
        e.preventDefault();
        if (wantEvents) {
          openEventDesigner({
            connection,
            database,
            event: selectedTable,
            mode: "alter",
          });
        } else if (wantFunctions) {
          const rt = routineMetaMap[selectedTable]?.routineType ?? "PROCEDURE";
          openFunctionDesigner({
            connection,
            database,
            routine: selectedTable,
            mode: "alter",
            routineType: rt,
          });
        } else if (wantViews) {
          openViewDesigner({
            connection,
            database,
            view: selectedTable,
            mode: "alter",
          });
        } else {
          openTableDesigner({
            connection,
            database,
            table: selectedTable,
            mode: "alter",
          });
        }
        return;
      }
      if (key === "n") {
        e.preventDefault();
        if (wantEvents) {
          openEventDesigner({
            connection,
            database,
            event: "Untitled",
            mode: "create",
          });
        } else if (wantFunctions) {
          openFunctionDesigner({
            connection,
            database,
            routine: "new_proc",
            mode: "create",
            routineType: "PROCEDURE",
          });
        } else if (wantViews) {
          openViewDesigner({
            connection,
            database,
            view: "new_view",
            mode: "create",
          });
        } else if (folder === "tables" || !folder) {
          openTableDesigner({
            connection,
            database,
            table: "new_table",
            mode: "create",
          });
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    connection,
    database,
    selectedTable,
    folder,
    wantViews,
    wantFunctions,
    wantEvents,
    routineMetaMap,
    openTable,
    openTableDesigner,
    openViewDesigner,
    openFunctionDesigner,
    openEventDesigner,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!connection || !database) {
        setTables([]);
        setRoutines([]);
        setEvents([]);
        setViewMetaMap({});
        setRoutineMetaMap({});
        return;
      }
      if (
        folder &&
        folder !== "tables" &&
        folder !== "views" &&
        folder !== "functions" &&
        folder !== "events"
      ) {
        setTables([]);
        setRoutines([]);
        setEvents([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (wantEvents) {
          const map = await listEventMeta({
            connectionId: connection.id,
            engine: String(connection.engine),
            database,
          });
          if (cancelled) return;
          const list = Object.values(map).sort((a, b) =>
            a.name.localeCompare(b.name, "zh"),
          );
          setEvents(list);
          setTables([]);
          setRoutines([]);
          setRoutineMetaMap({});
          setViewMetaMap({});
        } else if (wantFunctions) {
          const map = await listRoutineMeta({
            connectionId: connection.id,
            engine: String(connection.engine),
            database,
          });
          if (cancelled) return;
          const list = Object.values(map).sort((a, b) =>
            a.name.localeCompare(b.name, "zh"),
          );
          setRoutineMetaMap(map);
          setRoutines(list);
          setTables([]);
          setEvents([]);
          setViewMetaMap({});
        } else {
          const items = await listTables(connection.id, database);
          const filtered = items.filter((t) =>
            wantViews ? t.kind === "view" : t.kind !== "view",
          );
          if (!cancelled) setTables(filtered);
          setRoutines([]);
          setRoutineMetaMap({});
          setEvents([]);
          if (wantViews && !cancelled) {
            try {
              const meta = await listViewMeta({
                connectionId: connection.id,
                engine: String(connection.engine),
                database,
              });
              if (!cancelled) setViewMetaMap(meta);
            } catch {
              if (!cancelled) setViewMetaMap({});
            }
          } else if (!cancelled) {
            setViewMetaMap({});
          }
        }
      } catch (err) {
        if (!cancelled) {
          setTables([]);
          setRoutines([]);
          setEvents([]);
          setViewMetaMap({});
          setRoutineMetaMap({});
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [connection, database, folder, wantViews, wantFunctions, wantEvents, tick]);

  useEffect(() => {
    if (!connection || !database || wantViews || wantFunctions || wantEvents) {
      if (wantViews || wantFunctions || wantEvents) setGroupMap({});
      return;
    }
    void loadTableGroups(connection.id, database)
      .then((s) => setGroupMap(s.membership))
      .catch(() => setGroupMap({}));
  }, [connection, database, tick, wantViews, wantFunctions, wantEvents]);

  const cols = wantEvents
    ? EVENT_COLS
    : wantFunctions
      ? FUNCTION_COLS
      : wantViews
        ? VIEW_COLS
        : TABLE_COLS;

  if (!connection) {
    return <p className="pane-placeholder">请先打开一个连接。</p>;
  }
  if (!database) {
    return (
      <p className="pane-placeholder">
        请在左侧展开连接，点击数据库下的「表」查看对象列表。
      </p>
    );
  }

  const filteredTables = tables
    .filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .slice()
    .sort((a, b) => {
      const ga = groupMap[a.name] || "";
      const gb = groupMap[b.name] || "";
      if (ga !== gb) return ga.localeCompare(gb, "zh");
      return a.name.localeCompare(b.name, "zh");
    });

  const filteredRoutines = routines.filter((r) =>
    r.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const filteredEvents = events.filter((ev) =>
    ev.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const count = wantEvents
    ? filteredEvents.length
    : wantFunctions
      ? filteredRoutines.length
      : filteredTables.length;
  const selectedRoutine = selectedTable
    ? routineMetaMap[selectedTable]
    : undefined;

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }

  return (
    <div
      className="object-list-grid"
      onContextMenu={(e) => {
        if (!connection || !database) return;
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("tr, .dg-context-menu, .modal")) return;
        e.preventDefault();
        setMenu(null);
        setRoutineMenu(null);
        setEventMenu(null);
        if (wantViews) {
          setFunctionsFolderMenu(null);
          setEventsFolderMenu(null);
          setViewsFolderMenu({
            x: e.clientX,
            y: e.clientY,
            conn: connection,
            database,
          });
        } else if (wantFunctions) {
          setViewsFolderMenu(null);
          setEventsFolderMenu(null);
          setFunctionsFolderMenu({
            x: e.clientX,
            y: e.clientY,
            conn: connection,
            database,
          });
        } else if (wantEvents) {
          setViewsFolderMenu(null);
          setFunctionsFolderMenu(null);
          setEventsFolderMenu({
            x: e.clientX,
            y: e.clientY,
            conn: connection,
            database,
          });
        }
      }}
    >
      <div className="object-list-toolbar navicat-obj-toolbar">
        <div className="obj-toolbar-left">
          <button
            type="button"
            className="obj-tool-btn"
            title="刷新"
            onClick={() => setTick((x) => x + 1)}
          >
            ↻
          </button>
          {wantFunctions ? (
            <button
              type="button"
              className="obj-tool-btn"
              title="运行函数 (⌘O)"
              disabled={!selectedTable}
              onClick={() => selectedTable && setRunOpen(true)}
            >
              ▶ 运行
            </button>
          ) : wantEvents ? null : (
            <button
              type="button"
              className="obj-tool-btn"
              title={wantViews ? "打开视图 (⌘O)" : "打开表 (⌘O)"}
              disabled={!selectedTable}
              onClick={() => selectedTable && openTable(selectedTable)}
            >
              ⊞ 打开
            </button>
          )}
          <button
            type="button"
            className="obj-tool-btn"
            title={
              wantEvents
                ? "设计事件 (⌘D)"
                : wantFunctions
                  ? "设计函数 (⌘D)"
                  : wantViews
                    ? "设计视图 (⌘D)"
                    : "设计表 (⌘D)"
            }
            disabled={!selectedTable}
            onClick={() => {
              if (!selectedTable || !connection || !database) return;
              if (wantEvents) {
                openEventDesigner({
                  connection,
                  database,
                  event: selectedTable,
                  mode: "alter",
                });
              } else if (wantFunctions) {
                openFunctionDesigner({
                  connection,
                  database,
                  routine: selectedTable,
                  mode: "alter",
                  routineType: selectedRoutine?.routineType ?? "PROCEDURE",
                });
              } else if (wantViews) {
                openViewDesigner({
                  connection,
                  database,
                  view: selectedTable,
                  mode: "alter",
                });
              } else {
                openTableDesigner({
                  connection,
                  database,
                  table: selectedTable,
                  mode: "alter",
                });
              }
            }}
          >
            设计
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            title={
              wantEvents
                ? "新建事件 (⌘N)"
                : wantFunctions
                  ? "新建函数 (⌘N)"
                  : wantViews
                    ? "新建视图 (⌘N)"
                    : "新建表 (⌘N)"
            }
            disabled={!connection || !database}
            onClick={() => {
              if (!connection || !database) return;
              if (wantEvents) {
                openEventDesigner({
                  connection,
                  database,
                  event: "Untitled",
                  mode: "create",
                });
              } else if (wantFunctions) {
                openFunctionDesigner({
                  connection,
                  database,
                  routine: "new_proc",
                  mode: "create",
                  routineType: "PROCEDURE",
                });
              } else if (wantViews) {
                openViewDesigner({
                  connection,
                  database,
                  view: "new_view",
                  mode: "create",
                });
              } else {
                openTableDesigner({
                  connection,
                  database,
                  table: "new_table",
                  mode: "create",
                });
              }
            }}
          >
            新建
          </button>
          {(wantViews || wantFunctions || wantEvents) && (
            <button
              type="button"
              className="obj-tool-btn is-danger-text"
              title={
                wantEvents
                  ? "删除事件"
                  : wantFunctions
                    ? "删除函数"
                    : "删除视图"
              }
              disabled={!selectedTable || deleteBusy}
              onClick={() => {
                if (!selectedTable) return;
                setDeleteConfirm(selectedTable);
              }}
            >
              删除
            </button>
          )}
          <span className="obj-tool-sep" />
          <span className="object-list-title">
            对象 · {title}
            <span className="object-list-count">{count}</span>
          </span>
        </div>
        <input
          ref={filterRef}
          className="object-list-filter"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setObjectListFilter(e.target.value);
          }}
          placeholder={
            wantFunctions || wantViews || wantEvents
              ? "搜索"
              : "搜索 / 在数据库中查找"
          }
        />
      </div>
      {toast && <p className="obj-toast">{toast}</p>}
      {error && <p className="pane-error">{error}</p>}
      {wantFunctions &&
        !loading &&
        !error &&
        routines.length === 0 &&
        /sqlite/i.test(String(connection.engine)) && (
          <p className="pane-placeholder">SQLite 不支持存储函数/过程。</p>
        )}
      {wantEvents &&
        !loading &&
        !error &&
        events.length === 0 &&
        !/mysql|mariadb/i.test(String(connection.engine)) && (
          <p className="pane-placeholder">
            当前引擎不支持 MySQL Event Scheduler。
          </p>
        )}
      {loading &&
        (wantEvents
          ? events.length === 0
          : wantFunctions
            ? routines.length === 0
            : tables.length === 0) && (
          <p className="pane-placeholder">加载中…</p>
        )}
      {((wantEvents
        ? events.length > 0
        : wantFunctions
          ? routines.length > 0
          : tables.length > 0) ||
        (!loading && !error)) && (
        <div className={`object-list-table-wrap ${loading ? "is-loading" : ""}`}>
          <table className="object-list-table">
            <thead>
              <tr>
                {cols.map((c) => {
                  const w = colW(c.key, c.defaultWidth);
                  return (
                    <th
                      key={c.key}
                      style={{ width: w, minWidth: w, maxWidth: w }}
                    >
                      {c.label}
                      <span
                        className="col-resize-handle"
                        onMouseDown={(e) => startResize(c.key, e)}
                        title="拖拽调整列宽"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {wantEvents
                ? filteredEvents.map((ev) => (
                    <tr
                      key={`event-${ev.name}`}
                      className={
                        selectedTable === ev.name ? "is-selected" : undefined
                      }
                      onClick={() => selectTableMeta(ev.name)}
                      onDoubleClick={() =>
                        openEventDesigner({
                          connection,
                          database,
                          event: ev.name,
                          mode: "alter",
                        })
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectTableMeta(ev.name);
                        setMenu(null);
                        setRoutineMenu(null);
                        setViewsFolderMenu(null);
                        setFunctionsFolderMenu(null);
                        setEventsFolderMenu(null);
                        setEventMenu({
                          x: e.clientX,
                          y: e.clientY,
                          conn: connection,
                          database,
                          name: ev.name,
                        });
                      }}
                    >
                      <td
                        style={{
                          width: colW("name", 160),
                          maxWidth: colW("name", 160),
                        }}
                      >
                        <span className="object-kind is-event">Ev</span>
                        {ev.name}
                      </td>
                      <td>{formatEventStatus(ev.status)}</td>
                      <td>{formatEventType(ev.eventType)}</td>
                      <td className="comment-cell">
                        {formatEventSchedule(ev)}
                      </td>
                      <td className="comment-cell">{ev.definer || "—"}</td>
                      <td>{ev.created || "—"}</td>
                      <td>{ev.lastAltered || "—"}</td>
                      <td>{ev.lastExecuted || "—"}</td>
                      <td className="comment-cell">{ev.comment || "—"}</td>
                    </tr>
                  ))
                : wantFunctions
                ? filteredRoutines.map((r) => (
                    <tr
                      key={`${r.routineType}-${r.name}`}
                      className={
                        selectedTable === r.name ? "is-selected" : undefined
                      }
                      onClick={() => selectTableMeta(r.name)}
                      onDoubleClick={() =>
                        openFunctionDesigner({
                          connection,
                          database,
                          routine: r.name,
                          mode: "alter",
                          routineType: r.routineType,
                        })
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectTableMeta(r.name);
                        setMenu(null);
                        setEventMenu(null);
                        setViewsFolderMenu(null);
                        setFunctionsFolderMenu(null);
                        setEventsFolderMenu(null);
                        setRoutineMenu({
                          x: e.clientX,
                          y: e.clientY,
                          conn: connection,
                          database,
                          name: r.name,
                          routineType: r.routineType,
                        });
                      }}
                    >
                      <td
                        style={{
                          width: colW("name", 180),
                          maxWidth: colW("name", 180),
                        }}
                      >
                        <span
                          className={`object-kind ${
                            r.routineType === "FUNCTION"
                              ? "is-function"
                              : "is-procedure"
                          }`}
                        >
                          {r.routineType === "FUNCTION" ? "fx" : "Px"}
                        </span>
                        {r.name}
                      </td>
                      <td>{formatRoutineType(r.routineType)}</td>
                      <td>{r.returns || "—"}</td>
                      <td className="comment-cell">{r.definer || "—"}</td>
                      <td>{r.securityType || "—"}</td>
                      <td>{r.created || "—"}</td>
                      <td>{r.lastAltered || "—"}</td>
                      <td className="comment-cell">{r.comment || "—"}</td>
                    </tr>
                  ))
                : filteredTables.map((t) => {
                    const vm = viewMetaMap[t.name];
                    return (
                      <tr
                        key={`${t.kind}-${t.name}`}
                        className={
                          selectedTable === t.name ? "is-selected" : undefined
                        }
                        onClick={() => selectTableMeta(t.name)}
                        onDoubleClick={() => openTable(t.name)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          selectTableMeta(t.name);
                          setRoutineMenu(null);
                          setMenu({
                            x: e.clientX,
                            y: e.clientY,
                            conn: connection,
                            database,
                            table: t.name,
                            kind: t.kind,
                          });
                        }}
                      >
                        <td
                          style={{
                            width: colW("name", wantViews ? 200 : 180),
                            maxWidth: colW("name", wantViews ? 200 : 180),
                          }}
                        >
                          <span
                            className={`object-kind ${wantViews ? "is-view" : ""}`}
                          >
                            {t.kind === "view" ? "V" : "T"}
                          </span>
                          {t.name}
                        </td>
                        {wantViews ? (
                          <>
                            <td>{vm?.securityType || "—"}</td>
                            <td>{formatCheckOption(vm?.checkOption) || ""}</td>
                            <td>{formatUpdatable(vm?.isUpdatable)}</td>
                            <td className="comment-cell">
                              {vm?.definer || "—"}
                            </td>
                          </>
                        ) : (
                          <>
                            <td>{groupMap[t.name] || "—"}</td>
                            <td>{formatRows(t.tableRows)}</td>
                            <td>{formatBytes(t.dataLength)}</td>
                            <td>{t.engine ?? "—"}</td>
                            <td>{t.createTime ?? "—"}</td>
                            <td>{t.updateTime ?? "—"}</td>
                            <td>{t.collation ?? "—"}</td>
                            <td className="comment-cell">
                              {t.comment || "—"}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
              {count === 0 && (
                <tr>
                  <td colSpan={cols.length} className="pane-placeholder">
                    {loading ? "加载中…" : `无匹配${title}`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {menu && (
        <TableContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onRefresh={() => setTick((x) => x + 1)}
          onMessage={showToast}
        />
      )}
      {routineMenu && (
        <RoutineContextMenu
          target={routineMenu}
          onClose={() => setRoutineMenu(null)}
          onRefresh={() => setTick((x) => x + 1)}
          onMessage={showToast}
        />
      )}
      {viewsFolderMenu && (
        <ViewsFolderContextMenu
          target={viewsFolderMenu}
          onClose={() => setViewsFolderMenu(null)}
          onRefresh={() => setTick((x) => x + 1)}
          onMessage={showToast}
        />
      )}
      {functionsFolderMenu && (
        <FunctionsFolderContextMenu
          target={functionsFolderMenu}
          onClose={() => setFunctionsFolderMenu(null)}
          onRefresh={() => setTick((x) => x + 1)}
          onMessage={showToast}
        />
      )}
      {eventsFolderMenu && (
        <EventsFolderContextMenu
          target={eventsFolderMenu}
          onClose={() => setEventsFolderMenu(null)}
          onRefresh={() => setTick((x) => x + 1)}
          onMessage={showToast}
        />
      )}
      {eventMenu && (
        <EventContextMenu
          target={eventMenu}
          onClose={() => setEventMenu(null)}
          onRefresh={() => setTick((x) => x + 1)}
          onMessage={showToast}
        />
      )}

      {runOpen && connection && database && selectedTable && selectedRoutine && (
        <RunRoutineDialog
          conn={connection}
          database={database}
          name={selectedTable}
          routineType={selectedRoutine.routineType}
          onClose={() => setRunOpen(false)}
          onMessage={showToast}
        />
      )}

      {deleteConfirm && connection && database && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !deleteBusy) {
              setDeleteConfirm(null);
            }
          }}
        >
          <div
            className="modal danger-confirm-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2>
              {wantEvents
                ? "删除事件"
                : wantFunctions
                  ? "删除函数"
                  : "删除视图"}
            </h2>
            <p className="danger-confirm-text">
              确定删除
              {wantEvents
                ? "事件"
                : wantFunctions
                  ? "函数/过程"
                  : "视图"}{" "}
              <strong>
                {database}.{deleteConfirm}
              </strong>{" "}
              吗？此操作不可恢复。
            </p>
            <div className="modal-actions">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeleteConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={deleteBusy}
                autoFocus
                onClick={() => {
                  const name = deleteConfirm;
                  void (async () => {
                    setDeleteBusy(true);
                    try {
                      if (wantEvents) {
                        await dropEvent({
                          conn: connection,
                          database,
                          name,
                        });
                      } else if (wantFunctions) {
                        const rt =
                          routineMetaMap[name]?.routineType ?? "PROCEDURE";
                        await dropRoutine({
                          conn: connection,
                          database,
                          name,
                          routineType: rt,
                        });
                      } else {
                        await dropTableOrView({
                          conn: connection,
                          database,
                          table: name,
                          isView: true,
                        });
                      }
                      emitTableDataChanged({
                        connectionId: connection.id,
                        database,
                        table: name,
                      });
                      selectTableMeta(null);
                      setDeleteConfirm(null);
                      setTick((x) => x + 1);
                      showToast(
                        `已删除${
                          wantEvents
                            ? "事件"
                            : wantFunctions
                              ? "函数"
                              : "视图"
                        } ${name}`,
                      );
                    } catch (err) {
                      showToast(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setDeleteBusy(false);
                    }
                  })();
                }}
              >
                {deleteBusy ? "删除中…" : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
