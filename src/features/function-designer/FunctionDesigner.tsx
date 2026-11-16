import Editor from "@monaco-editor/react";
import { useEffect, useState } from "react";
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
  buildCreateRoutineSql,
  parseRoutineDdl,
  type RoutineParam,
} from "./routineDdl";
import { RunRoutineDialog } from "./RunRoutineDialog";

type Props = { tab: DesignerTab };

export function FunctionDesigner({ tab }: Props) {
  const markDirty = useWorkspaceStore((s) => s.markDesignerDirty);
  const updateDesignerTab = useWorkspaceStore((s) => s.updateDesignerTab);
  const promoteDesignerToAlter = useWorkspaceStore(
    (s) => s.promoteDesignerToAlter,
  );
  const closeDesignerTab = useWorkspaceStore((s) => s.closeDesignerTab);
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);

  const [name, setName] = useState(tab.table || "new_proc");
  const [routineType, setRoutineType] = useState<RoutineType>(
    tab.routineType ?? "PROCEDURE",
  );
  const [params, setParams] = useState<RoutineParam[]>([]);
  const [returns, setReturns] = useState("INT");
  const [body, setBody] = useState("BEGIN\n\nEND");
  const [securityType, setSecurityType] = useState("");
  const [deterministic, setDeterministic] = useState(false);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(tab.mode === "alter");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [readonlyHint, setReadonlyHint] = useState<string | null>(null);

  const conn =
    activeConnection?.id === tab.connectionId ? activeConnection : null;
  const engine = tab.connectionEngine;
  const isPg =
    /postgres/i.test(engine) || String(engine).toLowerCase() === "postgresql";

  useEffect(() => {
    if (tab.mode !== "alter") return;
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
          setName(tab.table);
          setBody(ddl);
          setReadonlyHint("PostgreSQL 目前以只读 DDL 展示，保存请用手动 SQL。");
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
        setName(parsed.name || tab.table);
        setRoutineType(parsed.routineType);
        setParams(parsed.params);
        setReturns(parsed.returns || "INT");
        setBody(parsed.body);
        setSecurityType(parsed.securityType);
        setDeterministic(parsed.deterministic);
        setComment(parsed.comment);
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
  }, [tab.id, tab.mode, tab.table, tab.database, tab.routineType, conn, isPg]);

  function touchDirty() {
    if (!tab.dirty) markDirty(tab.id, true);
  }

  function previewSql(): string {
    try {
      if (isPg && tab.mode === "alter") return body;
      return buildCreateRoutineSql({
        engine,
        database: tab.database,
        name: name.trim() || "new_proc",
        routineType,
        params,
        returns,
        body,
        securityType,
        deterministic,
        comment,
      });
    } catch (err) {
      return `-- ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function save() {
    const n = name.trim();
    if (!identOk(n)) {
      setError("名称仅允许字母、数字、下划线，且不能以数字开头");
      return;
    }
    if (!conn) {
      setError("连接不可用");
      return;
    }
    if (isPg) {
      setError("PostgreSQL 设计器暂不支持保存，请使用查询窗口。");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const sql = buildCreateRoutineSql({
        engine,
        database: tab.database,
        name: n,
        routineType,
        params,
        returns,
        body,
        securityType,
        deterministic,
        comment,
      });
      await openConnection(conn.id);
      if (tab.mode === "alter") {
        await dropRoutine({
          conn,
          database: tab.database,
          name: tab.table,
          routineType: tab.routineType ?? routineType,
        });
      }
      await executeSql(conn.id, sql, tab.database);
      updateDesignerTab(tab.id, {
        table: n,
        dirty: false,
        routineType,
      });
      if (tab.mode === "create") {
        promoteDesignerToAlter(tab.id, n);
      }
      emitTableDataChanged({
        connectionId: tab.connectionId,
        database: tab.database,
        table: n,
      });
      window.dispatchEvent(new Event("mycat:object-list-refresh"));
      setMessage(`已保存${routineType === "FUNCTION" ? "函数" : "过程"} ${n}`);
      markDirty(tab.id, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  useModSaveShortcut(() => {
    if (!loading && !saving) void save();
  });

  function updateParam(i: number, patch: Partial<RoutineParam>) {
    setParams((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
    touchDirty();
  }

  return (
    <div className="view-designer function-designer">
      <div className="view-designer-toolbar">
        <div className="view-designer-title">
          {tab.mode === "create" ? "新建函数" : "设计函数"}
          <span className="view-designer-meta">
            {tab.connectionName} · {tab.database}
          </span>
        </div>
        <div className="view-designer-actions">
          {tab.mode === "alter" && (
            <button
              type="button"
              disabled={loading || saving}
              onClick={() => setRunOpen(true)}
            >
              运行
            </button>
          )}
          <button
            type="button"
            disabled={loading || saving}
            onClick={() => setPreviewOpen(true)}
          >
            预览 SQL
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={loading || saving || !!readonlyHint}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => closeDesignerTab(tab.id)}
          >
            关闭
          </button>
        </div>
      </div>

      {error && <p className="pane-error">{error}</p>}
      {message && <p className="pane-ok">{message}</p>}
      {readonlyHint && <p className="pane-placeholder">{readonlyHint}</p>}

      {loading ? (
        <p className="pane-placeholder">加载定义…</p>
      ) : (
        <div className="view-designer-body function-designer-body">
          <div className="function-designer-meta-row">
            <label className="view-designer-field">
              <span>名称</span>
              <input
                value={name}
                disabled={tab.mode === "alter"}
                onChange={(e) => {
                  setName(e.target.value);
                  touchDirty();
                }}
              />
            </label>
            <label className="view-designer-field">
              <span>类型</span>
              <select
                value={routineType}
                disabled={tab.mode === "alter"}
                onChange={(e) => {
                  setRoutineType(e.target.value as RoutineType);
                  touchDirty();
                }}
              >
                <option value="PROCEDURE">过程 (PROCEDURE)</option>
                <option value="FUNCTION">函数 (FUNCTION)</option>
              </select>
            </label>
            {routineType === "FUNCTION" && (
              <label className="view-designer-field">
                <span>返回类型</span>
                <input
                  value={returns}
                  onChange={(e) => {
                    setReturns(e.target.value);
                    touchDirty();
                  }}
                />
              </label>
            )}
          </div>

          <div className="function-designer-params">
            <div className="view-designer-sql-label">
              参数
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setParams((prev) => [
                    ...prev,
                    { name: `p${prev.length + 1}`, mode: "IN", dataType: "INT" },
                  ]);
                  touchDirty();
                }}
              >
                + 添加
              </button>
            </div>
            <table className="run-routine-params">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>模式</th>
                  <th>类型</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {params.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        value={p.name}
                        onChange={(e) =>
                          updateParam(i, { name: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <select
                        value={p.mode}
                        disabled={routineType === "FUNCTION"}
                        onChange={(e) =>
                          updateParam(i, {
                            mode: e.target.value as RoutineParam["mode"],
                          })
                        }
                      >
                        <option value="IN">IN</option>
                        <option value="OUT">OUT</option>
                        <option value="INOUT">INOUT</option>
                      </select>
                    </td>
                    <td>
                      <input
                        value={p.dataType}
                        onChange={(e) =>
                          updateParam(i, { dataType: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setParams((prev) => prev.filter((_, j) => j !== i));
                          touchDirty();
                        }}
                      >
                        删
                      </button>
                    </td>
                  </tr>
                ))}
                {params.length === 0 && (
                  <tr>
                    <td colSpan={4} className="pane-placeholder">
                      无参数
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="function-designer-advanced">
            <label className="view-designer-field">
              <span>SQL 安全性</span>
              <select
                value={securityType}
                onChange={(e) => {
                  setSecurityType(e.target.value);
                  touchDirty();
                }}
              >
                <option value="">默认</option>
                <option value="DEFINER">DEFINER</option>
                <option value="INVOKER">INVOKER</option>
              </select>
            </label>
            <label className="view-designer-field modal-check">
              <input
                type="checkbox"
                checked={deterministic}
                onChange={(e) => {
                  setDeterministic(e.target.checked);
                  touchDirty();
                }}
              />
              <span>DETERMINISTIC</span>
            </label>
            <label className="view-designer-field">
              <span>注释</span>
              <input
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  touchDirty();
                }}
              />
            </label>
          </div>

          <div className="view-designer-sql-label">定义</div>
          <div className="view-designer-editor">
            <Editor
              height="100%"
              defaultLanguage="sql"
              theme="vs"
              value={body}
              onChange={(v) => {
                setBody(v ?? "");
                touchDirty();
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: "on",
                automaticLayout: true,
                scrollBeyondLastLine: false,
              }}
            />
          </div>
        </div>
      )}

      {previewOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPreviewOpen(false);
          }}
        >
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <h2>预览 SQL</h2>
            <pre className="view-designer-preview">{previewSql()}</pre>
            <div className="modal-actions">
              <button type="button" onClick={() => setPreviewOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {runOpen && conn && (
        <RunRoutineDialog
          conn={conn}
          database={tab.database}
          name={tab.table}
          routineType={tab.routineType ?? routineType}
          onClose={() => setRunOpen(false)}
          onMessage={(msg) => setMessage(msg)}
        />
      )}
    </div>
  );
}
