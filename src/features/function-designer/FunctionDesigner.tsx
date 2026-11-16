import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import { executeSql, openConnection } from "../connections/sessionApi";
import { identOk } from "../nav-tree/sqlIdent";
import {
  dropRoutine,
  fetchRoutineDdl,
} from "../nav-tree/routineMenuActions";
import { emitTableDataChanged } from "../../lib/tableEvents";
import { useWorkspaceStore, type DesignerTab } from "../../stores/workspaceStore";
import { useModSaveShortcut } from "../../hooks/useModSaveShortcut";
import type { RoutineType } from "../object-list/routineMeta";
import {
  buildRoutineTemplateSql,
  parseRoutineDdl,
} from "./routineDdl";
import { RunRoutineDialog } from "./RunRoutineDialog";

type Props = { tab: DesignerTab };
type Pane = "definition" | "preview";

export function FunctionDesigner({ tab }: Props) {
  const markDirty = useWorkspaceStore((s) => s.markDesignerDirty);
  const updateDesignerTab = useWorkspaceStore((s) => s.updateDesignerTab);
  const promoteDesignerToAlter = useWorkspaceStore(
    (s) => s.promoteDesignerToAlter,
  );
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);

  const [pane, setPane] = useState<Pane>("definition");
  const [sql, setSql] = useState("");
  const [routineType, setRoutineType] = useState<RoutineType>(
    tab.routineType ?? "FUNCTION",
  );
  const [name, setName] = useState(tab.table || "NewFunc");
  const [loading, setLoading] = useState(tab.mode === "alter");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [readonlyHint, setReadonlyHint] = useState<string | null>(null);

  const conn =
    activeConnection?.id === tab.connectionId ? activeConnection : null;
  const engine = tab.connectionEngine;
  const isPg =
    /postgres/i.test(engine) || String(engine).toLowerCase() === "postgresql";

  useEffect(() => {
    if (tab.mode === "create") {
      const seed =
        tab.seedSql?.trim() ||
        buildRoutineTemplateSql({
          engine,
          database: tab.database,
          name: tab.table || "NewFunc",
          routineType: tab.routineType ?? "FUNCTION",
        });
      setSql(seed);
      setName(tab.table || "NewFunc");
      setRoutineType(tab.routineType ?? "FUNCTION");
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        if (!conn) throw new Error("连接不可用");
        if (isPg) {
          const ddl = await fetchRoutineDdl({
            conn,
            database: tab.database,
            name: tab.table,
            routineType: tab.routineType ?? "FUNCTION",
          });
          if (cancelled) return;
          setSql(ddl);
          setName(tab.table);
          setReadonlyHint("PostgreSQL 目前以只读 DDL 展示，保存请用查询窗口。");
          return;
        }
        const ddl = await fetchRoutineDdl({
          conn,
          database: tab.database,
          name: tab.table,
          routineType: tab.routineType ?? "PROCEDURE",
        });
        if (cancelled) return;
        const parsed = parseRoutineDdl(ddl);
        setSql(ddl.endsWith(";") ? ddl : `${ddl};`);
        setName(parsed.name || tab.table);
        setRoutineType(parsed.routineType);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    tab.id,
    tab.mode,
    tab.table,
    tab.database,
    tab.routineType,
    tab.seedSql,
    conn,
    engine,
    isPg,
  ]);

  function touchDirty() {
    if (!tab.dirty) markDirty(tab.id, true);
  }

  const displayName = useMemo(() => {
    const m = sql.match(
      /(?:function|procedure)\s+(?:`?[\w]+`?\.)?`?([\w]+)`?/i,
    );
    return m?.[1] || name;
  }, [sql, name]);

  async function save() {
    if (!conn) {
      setError("连接不可用");
      return;
    }
    if (isPg) {
      setError("PostgreSQL 设计器暂不支持保存");
      return;
    }
    const parsed = parseRoutineDdl(sql);
    const n = parsed.name || name.trim();
    if (!identOk(n)) {
      setError("例程名仅允许字母、数字、下划线，且不能以数字开头");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await openConnection(conn.id);
      if (tab.mode === "alter") {
        await dropRoutine({
          conn,
          database: tab.database,
          name: tab.table,
          routineType: tab.routineType ?? routineType,
        });
      }
      const stmt = sql.trim().endsWith(";") ? sql.trim() : `${sql.trim()};`;
      await executeSql(conn.id, stmt, tab.database);
      const nextType = parsed.routineType || routineType;
      updateDesignerTab(tab.id, {
        table: n,
        dirty: false,
        routineType: nextType,
      });
      setName(n);
      setRoutineType(nextType);
      if (tab.mode === "create") {
        promoteDesignerToAlter(tab.id, n);
      }
      emitTableDataChanged({
        connectionId: tab.connectionId,
        database: tab.database,
        table: n,
      });
      window.dispatchEvent(new Event("mycat:object-list-refresh"));
      setMessage(`已保存${nextType === "FUNCTION" ? "函数" : "过程"} ${n}`);
      markDirty(tab.id, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  useModSaveShortcut(() => {
    if (!loading && !saving && !readonlyHint) void save();
  });

  const canRun = tab.mode === "alter" && !loading;

  return (
    <div className="fn-designer-navicat">
      <div className="fn-toolbar">
        <button
          type="button"
          className="fn-tool-btn"
          title="保存 (⌘S)"
          disabled={loading || saving || !!readonlyHint}
          onClick={() => void save()}
        >
          💾
        </button>
        <button
          type="button"
          className="fn-tool-btn"
          title="运行"
          disabled={!canRun || running || saving}
          onClick={() => setRunOpen(true)}
        >
          ▶
        </button>
        <button type="button" className="fn-tool-btn" title="停止" disabled>
          ■
        </button>
        <div className="fn-tabs">
          <button
            type="button"
            className={`fn-tab ${pane === "definition" ? "is-active" : ""}`}
            onClick={() => setPane("definition")}
          >
            定义
          </button>
          <button
            type="button"
            className={`fn-tab ${pane === "preview" ? "is-active" : ""}`}
            onClick={() => setPane("preview")}
          >
            SQL 预览
          </button>
        </div>
        <span className="fn-toolbar-meta" title={displayName}>
          {routineType === "FUNCTION" ? "fx" : "Px"} {displayName}
        </span>
      </div>

      {error && <p className="pane-error">{error}</p>}
      {message && <p className="pane-ok">{message}</p>}
      {readonlyHint && <p className="pane-placeholder">{readonlyHint}</p>}

      {loading ? (
        <p className="pane-placeholder">加载定义…</p>
      ) : (
        <div className="fn-body">
          {pane === "definition" ? (
            <div className="fn-editor-wrap">
              <Editor
                height="100%"
                defaultLanguage="sql"
                theme="vs"
                value={sql}
                onChange={(v) => {
                  setSql(v ?? "");
                  touchDirty();
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  wordWrap: "on",
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  readOnly: !!readonlyHint,
                  lineNumbers: "on",
                }}
              />
            </div>
          ) : (
            <pre className="fn-preview-sql">{sql}</pre>
          )}
        </div>
      )}

      {runOpen && conn && (
        <RunRoutineDialog
          conn={conn}
          database={tab.database}
          name={tab.table}
          routineType={tab.routineType ?? routineType}
          onClose={() => {
            setRunOpen(false);
            setRunning(false);
          }}
          onMessage={(msg) => {
            setMessage(msg);
            setRunning(false);
          }}
        />
      )}
    </div>
  );
}
