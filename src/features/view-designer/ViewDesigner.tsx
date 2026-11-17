import Editor from "@monaco-editor/react";
import { useEffect, useState } from "react";
import { executeSql, openConnection } from "../connections/sessionApi";
import { fetchCreateDdl } from "../nav-tree/tableMenuActions";
import { identOk } from "../nav-tree/sqlIdent";
import { emitTableDataChanged } from "../../lib/tableEvents";
import { useWorkspaceStore, type DesignerTab } from "../../stores/workspaceStore";
import { buildCreateViewSql, parseViewSelectBody } from "./viewDdl";
import { useModSaveShortcut } from "../../hooks/useModSaveShortcut";

type Props = { tab: DesignerTab };

export function ViewDesigner({ tab }: Props) {
  const markDirty = useWorkspaceStore((s) => s.markDesignerDirty);
  const updateDesignerTab = useWorkspaceStore((s) => s.updateDesignerTab);
  const promoteDesignerToAlter = useWorkspaceStore(
    (s) => s.promoteDesignerToAlter,
  );
  const closeDesignerTab = useWorkspaceStore((s) => s.closeDesignerTab);
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);

  const [viewName, setViewName] = useState(tab.table || "new_view");
  const [selectSql, setSelectSql] = useState("SELECT 1 AS col");
  const [loading, setLoading] = useState(tab.mode === "alter");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const conn =
    activeConnection?.id === tab.connectionId ? activeConnection : null;
  const engine = tab.connectionEngine;

  useEffect(() => {
    if (tab.mode !== "alter") return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        if (!conn) throw new Error("连接不可用");
        const ddl = await fetchCreateDdl({
          conn,
          database: tab.database,
          table: tab.table,
          isView: true,
        });
        if (cancelled) return;
        setViewName(tab.table);
        setSelectSql(parseViewSelectBody(ddl));
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
  }, [tab.id, tab.mode, tab.table, tab.database, conn]);

  function touchDirty() {
    if (!tab.dirty) markDirty(tab.id, true);
  }

  function previewSql(): string {
    try {
      return buildCreateViewSql({
        engine,
        database: tab.database,
        viewName: viewName.trim() || "new_view",
        selectSql,
        replace: tab.mode === "alter",
      });
    } catch (err) {
      return `-- ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function save() {
    const name = viewName.trim();
    if (!identOk(name)) {
      setError("视图名仅允许字母、数字、下划线，且不能以数字开头");
      return;
    }
    if (!conn) {
      setError("连接不可用");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const sql = buildCreateViewSql({
        engine,
        database: tab.database,
        viewName: name,
        selectSql,
        replace: tab.mode === "alter",
      });
      await openConnection(conn.id);
      // SQLite may return multiple statements joined by ;
      for (const part of sql.split(/;\s*(?=CREATE|DROP)/i)) {
        const stmt = part.trim();
        if (!stmt) continue;
        await executeSql(conn.id, stmt.endsWith(";") ? stmt : `${stmt};`, tab.database);
      }
      updateDesignerTab(tab.id, { table: name, dirty: false });
      if (tab.mode === "create") {
        promoteDesignerToAlter(tab.id, name);
      }
      emitTableDataChanged({
        connectionId: tab.connectionId,
        database: tab.database,
        table: name,
      });
      window.dispatchEvent(new Event("mycat:object-list-refresh"));
      setMessage(`已保存视图 ${name}`);
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

  return (
    <div className="view-designer">
      <div className="view-designer-toolbar">
        <div className="view-designer-title">
          {tab.mode === "create" ? "新建视图" : "设计视图"}
          <span className="view-designer-meta">
            {tab.connectionName} · {tab.database}
          </span>
        </div>
        <div className="view-designer-actions">
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
            disabled={loading || saving}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void closeDesignerTab(tab.id)}
          >
            关闭
          </button>
        </div>
      </div>

      {error && <p className="pane-error">{error}</p>}
      {message && <p className="pane-ok">{message}</p>}

      {loading ? (
        <p className="pane-placeholder">加载视图定义…</p>
      ) : (
        <div className="view-designer-body">
          <label className="view-designer-field">
            <span>视图名</span>
            <input
              value={viewName}
              disabled={tab.mode === "alter"}
              onChange={(e) => {
                setViewName(e.target.value);
                touchDirty();
              }}
            />
          </label>
          <div className="view-designer-sql-label">定义 (SELECT)</div>
          <div className="view-designer-editor">
            <Editor
              height="100%"
              defaultLanguage="sql"
              theme="vs"
              value={selectSql}
              onChange={(v) => {
                setSelectSql(v ?? "");
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
    </div>
  );
}
