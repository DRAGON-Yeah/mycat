import { useEffect, useMemo, useState } from "react";
import { listConnections } from "../connections/api";
import type { ConnectionDto } from "../connections/types";
import {
  executeSql,
  listDatabases,
  openConnection,
} from "../connections/sessionApi";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { confirmDialog } from "../../lib/confirm";
import { formatDateTime } from "../../lib/localDocs";
import {
  BI_CHANGED,
  deleteDashboard,
  duplicateDashboard,
  getDashboard,
  listDashboards,
  saveDashboard,
} from "./biApi";
import { BiWidgetCard } from "./BiWidgetCard";
import { ChartView, type ChartData } from "./charts";
import {
  CHART_TYPES,
  newDashboard,
  newWidget,
  type BiChartType,
  type BiDashboard,
  type BiWidget,
} from "./types";

export function BiPane() {
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);
  const selectedDatabase = useWorkspaceStore((s) => s.selectedDatabase);

  const [dashboards, setDashboards] = useState<BiDashboard[]>(() =>
    listDashboards(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const items = listDashboards();
    return items[items.length - 1]?.id ?? null;
  });
  const [dash, setDash] = useState<BiDashboard | null>(() => {
    const items = listDashboards();
    const first = items[items.length - 1];
    return first ? getDashboard(first.id) : null;
  });
  const [connections, setConnections] = useState<ConnectionDto[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [editing, setEditing] = useState<{
    widget: BiWidget;
    isNew: boolean;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    void (async () => {
      try {
        setConnections(await listConnections());
      } catch {
        setConnections([]);
      }
    })();
  }, []);

  useEffect(() => {
    function onChanged() {
      setDashboards(listDashboards());
    }
    window.addEventListener(BI_CHANGED, onChanged);
    return () => window.removeEventListener(BI_CHANGED, onChanged);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDash(null);
      return;
    }
    setDash(getDashboard(selectedId));
    setDirty(false);
  }, [selectedId]);

  useEffect(() => {
    if (!dash || !dirty) return;
    const timer = window.setTimeout(() => {
      saveDashboard(dash);
      setDirty(false);
      setSavedAt(new Date().toISOString());
    }, 600);
    return () => window.clearTimeout(timer);
  }, [dash, dirty]);

  function updateDash(fn: (d: BiDashboard) => BiDashboard) {
    setDash((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
  }

  function createDashboard() {
    const created = saveDashboard(newDashboard(`仪表板 ${dashboards.length + 1}`));
    setDashboards(listDashboards());
    setSelectedId(created.id);
    showToast(`已创建「${created.name}」`);
  }

  async function removeDashboard() {
    if (!dash) return;
    const ok = await confirmDialog({
      title: "删除仪表板",
      message: `确定删除仪表板「${dash.name}」及其全部图表？`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    deleteDashboard(dash.id);
    const rest = listDashboards();
    setDashboards(rest);
    setSelectedId(rest[0]?.id ?? null);
    showToast("已删除仪表板");
  }

  function copyDashboard() {
    if (!dash) return;
    const copy = duplicateDashboard(dash.id);
    setDashboards(listDashboards());
    if (copy) {
      setSelectedId(copy.id);
      showToast(`已复制为「${copy.name}」`);
    }
  }

  function addWidget() {
    if (!dash) return;
    const conn = activeConnection ?? connections[0];
    if (!conn) {
      showToast("请先在左侧新建并打开一个连接");
      return;
    }
    setEditing({
      isNew: true,
      widget: newWidget({
        title: `图表 ${dash.widgets.length + 1}`,
        connectionId: conn.id,
        connectionName: conn.name,
        database:
          (activeConnection ? selectedDatabase : null) ||
          conn.database?.trim() ||
          "",
      }),
    });
  }

  function saveWidget(widget: BiWidget) {
    if (!dash) return;
    updateDash((d) => {
      const exists = d.widgets.some((w) => w.id === widget.id);
      return {
        ...d,
        widgets: exists
          ? d.widgets.map((w) => (w.id === widget.id ? widget : w))
          : [...d.widgets, widget],
      };
    });
    setEditing(null);
    setRefreshToken((v) => v + 1);
    showToast("已保存图表");
  }

  function removeWidget(id: string) {
    updateDash((d) => ({
      ...d,
      widgets: d.widgets.filter((w) => w.id !== id),
    }));
  }

  return (
    <div className="feature-pane bi-pane">
      <div className="object-list-toolbar navicat-obj-toolbar">
        <div className="obj-toolbar-left">
          <button
            type="button"
            className="obj-tool-btn"
            onClick={createDashboard}
          >
            新建仪表板
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            disabled={!dash}
            onClick={addWidget}
          >
            添加图表
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            disabled={!dash}
            onClick={() => setRefreshToken((v) => v + 1)}
          >
            ↻ 刷新
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            disabled={!dash}
            onClick={copyDashboard}
          >
            复制
          </button>
          <button
            type="button"
            className="obj-tool-btn is-danger-text"
            disabled={!dash}
            onClick={() => void removeDashboard()}
          >
            删除
          </button>
          <span className="obj-tool-sep" />
          <span className="object-list-title">
            BI 仪表板
            <span className="object-list-count">{dashboards.length}</span>
          </span>
        </div>
        {dash && (
          <span className="model-save-hint">
            {dirty ? "保存中…" : savedAt ? `已保存 ${formatDateTime(savedAt)}` : ""}
          </span>
        )}
      </div>

      {toast && <p className="obj-toast">{toast}</p>}

      <div className="bi-body">
        <ul className="model-list">
          {dashboards.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className={`auto-item ${d.id === selectedId ? "is-active" : ""}`}
                onClick={() => setSelectedId(d.id)}
              >
                <span className="bi-item-icon">BI</span>
                <span className="auto-item-main">
                  <span className="auto-item-name">{d.name}</span>
                  <span className="auto-item-sub">{d.widgets.length} 个图表</span>
                  <span className="auto-item-sub">
                    {formatDateTime(d.updatedAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {dashboards.length === 0 && (
            <li className="pane-placeholder">
              还没有仪表板，点击「新建仪表板」开始。
            </li>
          )}
        </ul>

        <div className="bi-detail">
          {dash ? (
            <>
              <div className="model-detail-head">
                <input
                  className="auto-name"
                  value={dash.name}
                  onChange={(e) =>
                    updateDash((d) => ({ ...d, name: e.target.value }))
                  }
                  aria-label="仪表板名称"
                />
                <span className="model-detail-meta">
                  {dash.widgets.length} 个图表
                </span>
              </div>
              <div className="bi-grid">
                {dash.widgets.map((w) => (
                  <BiWidgetCard
                    key={w.id}
                    widget={w}
                    refreshToken={refreshToken}
                    onEdit={() => setEditing({ widget: w, isNew: false })}
                    onDelete={() => removeWidget(w.id)}
                  />
                ))}
                {dash.widgets.length === 0 && (
                  <div className="bi-empty">
                    <p>仪表板还是空的。</p>
                    <p>点击「添加图表」，用 SQL 取数并选择图表类型。</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="feature-empty">
              <h2>BI</h2>
              <p>
                把 SQL 查询变成图表：柱状图、折线图、饼图、数据表与指标卡，组合成仪表板。
              </p>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <WidgetEditor
          widget={editing.widget}
          isNew={editing.isNew}
          connections={connections}
          onClose={() => setEditing(null)}
          onSave={saveWidget}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function WidgetEditor({
  widget,
  isNew,
  connections,
  onClose,
  onSave,
}: {
  widget: BiWidget;
  isNew: boolean;
  connections: ConnectionDto[];
  onClose: () => void;
  onSave: (widget: BiWidget) => void;
}) {
  const [draft, setDraft] = useState<BiWidget>({ ...widget });
  const [databases, setDatabases] = useState<string[]>([]);
  const [preview, setPreview] = useState<ChartData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!draft.connectionId) {
      setDatabases([]);
      return;
    }
    void (async () => {
      try {
        await openConnection(draft.connectionId);
        const list = await listDatabases(draft.connectionId);
        if (!cancelled) setDatabases(list);
      } catch {
        if (!cancelled) setDatabases([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draft.connectionId]);

  function patch(next: Partial<BiWidget>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  async function runPreview() {
    if (!draft.sql.trim()) {
      setPreviewError("请先填写 SQL");
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    try {
      await openConnection(draft.connectionId);
      const out = await executeSql(
        draft.connectionId,
        draft.sql,
        draft.database || null,
      );
      setPreview({ columns: out.columns, rows: out.rows });
      if (out.columns.length > 1) {
        const cat = Math.min(draft.categoryColumn, out.columns.length - 1);
        const val = Math.min(draft.valueColumn, out.columns.length - 1);
        patch({ categoryColumn: cat, valueColumn: val });
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  const columnOptions = useMemo(
    () => preview?.columns ?? [],
    [preview],
  );

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal modal-wide bi-editor-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{isNew ? "添加图表" : "编辑图表"}</h2>

        <div className="bi-editor-grid">
          <label>
            标题
            <input
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              autoFocus
            />
          </label>
          <label>
            图表类型
            <select
              value={draft.type}
              onChange={(e) => patch({ type: e.target.value as BiChartType })}
            >
              {CHART_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            连接
            <select
              value={draft.connectionId}
              onChange={(e) => {
                const conn = connections.find((c) => c.id === e.target.value);
                patch({
                  connectionId: e.target.value,
                  connectionName: conn?.name ?? "",
                  database: conn?.database?.trim() ?? "",
                });
              }}
            >
              <option value="">— 选择连接 —</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            数据库
            <select
              value={draft.database}
              onChange={(e) => patch({ database: e.target.value })}
            >
              <option value="">— 默认 —</option>
              {databases.map((db) => (
                <option key={db} value={db}>
                  {db}
                </option>
              ))}
            </select>
          </label>
          <label>
            分类列
            {columnOptions.length > 0 ? (
              <select
                value={draft.categoryColumn}
                onChange={(e) =>
                  patch({ categoryColumn: Number(e.target.value) })
                }
              >
                {columnOptions.map((c, i) => (
                  <option key={`${c}-${i}`} value={i}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={0}
                value={draft.categoryColumn}
                onChange={(e) =>
                  patch({ categoryColumn: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            )}
          </label>
          <label>
            数值列
            {columnOptions.length > 0 ? (
              <select
                value={draft.valueColumn}
                onChange={(e) => patch({ valueColumn: Number(e.target.value) })}
              >
                {columnOptions.map((c, i) => (
                  <option key={`${c}-${i}`} value={i}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={0}
                value={draft.valueColumn}
                onChange={(e) =>
                  patch({ valueColumn: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            )}
          </label>
          <label>
            宽度
            <select
              value={draft.span}
              onChange={(e) =>
                patch({ span: Number(e.target.value) === 2 ? 2 : 1 })
              }
            >
              <option value={1}>半宽</option>
              <option value={2}>整行</option>
            </select>
          </label>
          <label>
            高度 (px)
            <input
              type="number"
              min={140}
              max={800}
              value={draft.height}
              onChange={(e) =>
                patch({
                  height: Math.min(800, Math.max(140, Number(e.target.value) || 240)),
                })
              }
            />
          </label>
        </div>

        <label className="bi-editor-sql">
          SQL 查询
          <textarea
            value={draft.sql}
            spellCheck={false}
            placeholder="SELECT category, SUM(amount) AS total FROM orders GROUP BY category"
            onChange={(e) => patch({ sql: e.target.value })}
          />
        </label>

        <div className="bi-editor-preview">
          <div className="bi-editor-preview-head">
            <button
              type="button"
              className="obj-tool-btn"
              disabled={previewing}
              onClick={() => void runPreview()}
            >
              {previewing ? "查询中…" : "预览"}
            </button>
            {preview && (
              <span className="bi-editor-preview-meta">
                {preview.rows.length} 行 · {preview.columns.length} 列
              </span>
            )}
          </div>
          {previewError && <p className="pane-error">{previewError}</p>}
          {preview && (
            <div className="bi-editor-preview-body">
              <ChartView
                type={draft.type}
                data={preview}
                categoryColumn={draft.categoryColumn}
                valueColumn={draft.valueColumn}
                height={draft.height}
              />
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            disabled={!draft.title.trim() || !draft.connectionId}
            onClick={() => onSave({ ...draft, title: draft.title.trim() })}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
