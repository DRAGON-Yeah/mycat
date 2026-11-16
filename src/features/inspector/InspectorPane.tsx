import { useEffect, useState } from "react";
import { executeSql, openConnection } from "../connections/sessionApi";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { IconEngine } from "../nav-tree/EngineIcons";
import {
  formatCheckOption,
  formatUpdatable,
  listViewMeta,
  type ViewMeta,
} from "../object-list/viewMeta";
import {
  formatRoutineType,
  listRoutineMeta,
  type RoutineMeta,
} from "../object-list/routineMeta";
import {
  formatEventSchedule,
  formatEventStatus,
  formatEventType,
  listEventMeta,
  type EventMeta,
} from "../object-list/eventMeta";

export function InspectorPane() {
  const connection = useWorkspaceStore((s) => s.activeConnection);
  const database = useWorkspaceStore((s) => s.selectedDatabase);
  const table = useWorkspaceStore((s) => s.selectedTable);
  const folder = useWorkspaceStore((s) => s.selectedFolder);
  const kind = useWorkspaceStore((s) => s.selectionKind);
  const centerMode = useWorkspaceStore((s) => s.centerMode);
  const activeQueryId = useWorkspaceStore((s) => s.activeQueryId);
  const queryTabs = useWorkspaceStore((s) => s.queryTabs);
  const activeQuery = queryTabs.find((t) => t.id === activeQueryId) ?? null;

  const [viewMeta, setViewMeta] = useState<ViewMeta | null>(null);
  const [routineMeta, setRoutineMeta] = useState<RoutineMeta | null>(null);
  const [eventMeta, setEventMeta] = useState<EventMeta | null>(null);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [rowBusy, setRowBusy] = useState(false);

  useEffect(() => {
    if (!connection || !database || !table || folder !== "views") {
      setViewMeta(null);
      setRowCount(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const map = await listViewMeta({
          connectionId: connection.id,
          engine: String(connection.engine),
          database,
        });
        if (!cancelled) setViewMeta(map[table] ?? null);
      } catch {
        if (!cancelled) setViewMeta(null);
      }
    })();
    setRowCount(null);
    return () => {
      cancelled = true;
    };
  }, [connection, database, table, folder]);

  useEffect(() => {
    if (!connection || !database || !table || folder !== "functions") {
      setRoutineMeta(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const map = await listRoutineMeta({
          connectionId: connection.id,
          engine: String(connection.engine),
          database,
        });
        if (!cancelled) setRoutineMeta(map[table] ?? null);
      } catch {
        if (!cancelled) setRoutineMeta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, database, table, folder]);

  useEffect(() => {
    if (!connection || !database || !table || folder !== "events") {
      setEventMeta(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const map = await listEventMeta({
          connectionId: connection.id,
          engine: String(connection.engine),
          database,
        });
        if (!cancelled) setEventMeta(map[table] ?? null);
      } catch {
        if (!cancelled) setEventMeta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, database, table, folder]);

  async function fetchRowCount() {
    if (!connection || !database || !table) return;
    setRowBusy(true);
    try {
      await openConnection(connection.id);
      const out = await executeSql(
        connection.id,
        `SELECT COUNT(*) FROM \`${database.replace(/`/g, "``")}\`.\`${table.replace(/`/g, "``")}\``,
        database,
      );
      const n = Number(out.rows[0]?.[0] ?? 0);
      setRowCount(Number.isFinite(n) ? n : 0);
    } catch {
      setRowCount(null);
    } finally {
      setRowBusy(false);
    }
  }

  if (kind === "none" || !connection) {
    return (
      <aside className="pane inspector-pane" aria-label="信息">
        <div className="pane-title">信息</div>
        <p className="pane-placeholder">选中连接、数据库或表以查看详情。</p>
      </aside>
    );
  }

  if (kind === "table" && table && folder === "events") {
    return (
      <aside className="pane inspector-pane" aria-label="信息">
        <div className="pane-title">信息</div>
        <div className="inspector-hero">
          <div className="inspector-badge event">Ev</div>
          <div>
            <h3>{table}</h3>
            <p className="inspector-sub">事件</p>
          </div>
        </div>
        <p className="inspector-conn-line">
          {connection.name}
          <span> · </span>
          {database}
        </p>
        <dl className="inspector-meta">
          <div>
            <dt>状态</dt>
            <dd>{formatEventStatus(eventMeta?.status)}</dd>
          </div>
          <div>
            <dt>类型</dt>
            <dd>{formatEventType(eventMeta?.eventType)}</dd>
          </div>
          <div>
            <dt>执行计划</dt>
            <dd>{formatEventSchedule(eventMeta)}</dd>
          </div>
          <div>
            <dt>定义者</dt>
            <dd>{eventMeta?.definer || "—"}</dd>
          </div>
          <div>
            <dt>ON COMPLETION</dt>
            <dd>{eventMeta?.onCompletion || "—"}</dd>
          </div>
          <div>
            <dt>上次执行</dt>
            <dd>{eventMeta?.lastExecuted || "—"}</dd>
          </div>
          <div>
            <dt>创建日期</dt>
            <dd>{eventMeta?.created || "—"}</dd>
          </div>
          <div>
            <dt>修改日期</dt>
            <dd>{eventMeta?.lastAltered || "—"}</dd>
          </div>
          <div>
            <dt>注释</dt>
            <dd>{eventMeta?.comment || "—"}</dd>
          </div>
        </dl>
      </aside>
    );
  }

  if (kind === "table" && table && folder === "functions") {
    const badge =
      routineMeta?.routineType === "FUNCTION" ? "fx" : "Px";
    return (
      <aside className="pane inspector-pane" aria-label="信息">
        <div className="pane-title">信息</div>
        <div className="inspector-hero">
          <div
            className={`inspector-badge ${
              routineMeta?.routineType === "FUNCTION"
                ? "function"
                : "procedure"
            }`}
          >
            {badge}
          </div>
          <div>
            <h3>{table}</h3>
            <p className="inspector-sub">
              {formatRoutineType(routineMeta?.routineType)}
            </p>
          </div>
        </div>
        <p className="inspector-conn-line">
          {connection.name}
          <span> · </span>
          {database}
        </p>
        <dl className="inspector-meta">
          <div>
            <dt>类型</dt>
            <dd>{formatRoutineType(routineMeta?.routineType)}</dd>
          </div>
          <div>
            <dt>返回类型</dt>
            <dd>{routineMeta?.returns || "—"}</dd>
          </div>
          <div>
            <dt>定义者</dt>
            <dd>{routineMeta?.definer || "—"}</dd>
          </div>
          <div>
            <dt>SQL 安全性</dt>
            <dd>{routineMeta?.securityType || "—"}</dd>
          </div>
          <div>
            <dt>确定性</dt>
            <dd>{routineMeta?.isDeterministic || "—"}</dd>
          </div>
          <div>
            <dt>创建日期</dt>
            <dd>{routineMeta?.created || "—"}</dd>
          </div>
          <div>
            <dt>修改日期</dt>
            <dd>{routineMeta?.lastAltered || "—"}</dd>
          </div>
          <div>
            <dt>注释</dt>
            <dd>{routineMeta?.comment || "—"}</dd>
          </div>
        </dl>
      </aside>
    );
  }

  if (kind === "table" && table && folder === "views") {
    const check = formatCheckOption(viewMeta?.checkOption);
    return (
      <aside className="pane inspector-pane" aria-label="信息">
        <div className="pane-title">信息</div>
        <div className="inspector-hero">
          <div className="inspector-badge view">V</div>
          <div>
            <h3>{table}</h3>
            <p className="inspector-sub">视图</p>
          </div>
        </div>
        <p className="inspector-conn-line">
          {connection.name}
          <span> · </span>
          {database}
        </p>
        <dl className="inspector-meta">
          <div>
            <dt>行</dt>
            <dd>
              {rowCount != null ? (
                rowCount.toLocaleString()
              ) : (
                <button
                  type="button"
                  className="link-btn"
                  disabled={rowBusy}
                  onClick={() => void fetchRowCount()}
                >
                  {rowBusy ? "统计中…" : "获取行的总数"}
                </button>
              )}
            </dd>
          </div>
          <div>
            <dt>是否可以更新</dt>
            <dd>{formatUpdatable(viewMeta?.isUpdatable)}</dd>
          </div>
          <div>
            <dt>定义者</dt>
            <dd>{viewMeta?.definer || "—"}</dd>
          </div>
          <div>
            <dt>定义者安全性</dt>
            <dd>{viewMeta?.securityType || "—"}</dd>
          </div>
          <div>
            <dt>检查选项</dt>
            <dd>{check || "—"}</dd>
          </div>
        </dl>
      </aside>
    );
  }

  if (kind === "table" && table) {
    return (
      <aside className="pane inspector-pane" aria-label="信息">
        <div className="pane-title">表</div>
        <div className="inspector-hero">
          <div className="inspector-badge">T</div>
          <h3>{table}</h3>
        </div>
        <dl className="inspector-meta">
          <div>
            <dt>连接</dt>
            <dd>{connection.name}</dd>
          </div>
          <div>
            <dt>数据库</dt>
            <dd>{database ?? "—"}</dd>
          </div>
          <div>
            <dt>引擎</dt>
            <dd>{connection.engine}</dd>
          </div>
        </dl>
      </aside>
    );
  }

  if (kind === "database" && database && centerMode !== "query") {
    return (
      <aside className="pane inspector-pane" aria-label="信息">
        <div className="pane-title">数据库</div>
        <div className="inspector-hero">
          <div className="inspector-badge db">D</div>
          <h3>{database}</h3>
        </div>
        <dl className="inspector-meta">
          <div>
            <dt>连接</dt>
            <dd>{connection.name}</dd>
          </div>
          <div>
            <dt>主机</dt>
            <dd>{connection.host ?? "—"}</dd>
          </div>
          <div>
            <dt>引擎</dt>
            <dd>{connection.engine}</dd>
          </div>
        </dl>
      </aside>
    );
  }

  return (
    <aside className="pane inspector-pane" aria-label="信息">
      <div className="pane-title">连接</div>
      <div className="inspector-hero">
        <div className="inspector-badge conn inspector-engine-badge">
          <IconEngine engine={connection.engine} active large />
        </div>
        <h3>{connection.name}</h3>
      </div>
      <dl className="inspector-meta">
        <div>
          <dt>引擎</dt>
          <dd>{connection.engine}</dd>
        </div>
        <div>
          <dt>主机</dt>
          <dd>{connection.host ?? "—"}</dd>
        </div>
        <div>
          <dt>端口</dt>
          <dd>{connection.port ?? "—"}</dd>
        </div>
        <div>
          <dt>数据库</dt>
          <dd>{connection.database?.trim() || "—"}</dd>
        </div>
        <div>
          <dt>用户名</dt>
          <dd>{connection.user ?? "—"}</dd>
        </div>
        <div>
          <dt>分组</dt>
          <dd>{connection.groupName ?? "—"}</dd>
        </div>
        {centerMode === "query" && activeQuery && (
          <div>
            <dt>查询库</dt>
            <dd>{activeQuery.database || "—"}</dd>
          </div>
        )}
      </dl>
    </aside>
  );
}
