import { useEffect, useMemo, useRef, useState } from "react";
import { listConnections } from "../connections/api";
import type { ConnectionDto } from "../connections/types";
import {
  listDatabases,
  listTables,
  openConnection,
  type DbObject,
} from "../connections/sessionApi";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { confirmDialog } from "../../lib/confirm";
import { formatDateTime } from "../../lib/localDocs";
import { downloadTextFile, isSaveCancelled } from "../import-export/csv";
import {
  MODEL_CHANGED,
  deleteModel,
  duplicateModel,
  getModel,
  listModels,
  saveModel,
} from "./modelApi";
import { modelToSql } from "./modelDdl";
import { buildModelTables } from "./modelImport";
import { ModelCanvas } from "./ModelCanvas";
import {
  MODEL_TABLE_WIDTH,
  modelTableHeight,
  newModel,
  type DataModel,
  type ModelTable,
} from "./types";

const LAYOUT_COLS = 3;
const LAYOUT_GAP_X = 80;
const LAYOUT_GAP_Y = 60;

export function ModelPane() {
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);
  const selectedDatabase = useWorkspaceStore((s) => s.selectedDatabase);

  const [models, setModels] = useState<DataModel[]>(() => listModels());
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const items = listModels();
    return items[items.length - 1]?.id ?? null;
  });
  const [model, setModel] = useState<DataModel | null>(() => {
    const items = listModels();
    const first = items[items.length - 1];
    return first ? getModel(first.id) : null;
  });
  const [connections, setConnections] = useState<ConnectionDto[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const savedTimer = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setToast(null), 3000);
  };

  const reloadList = () => setModels(listModels());

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
      reloadList();
    }
    window.addEventListener(MODEL_CHANGED, onChanged);
    return () => window.removeEventListener(MODEL_CHANGED, onChanged);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setModel(null);
      return;
    }
    setModel(getModel(selectedId));
    setSelectedTableId(null);
    setDirty(false);
  }, [selectedId]);

  // 自动保存（600ms 防抖）
  useEffect(() => {
    if (!model || !dirty) return;
    const timer = window.setTimeout(() => {
      saveModel(model);
      setDirty(false);
      setSavedAt(new Date().toISOString());
    }, 600);
    return () => window.clearTimeout(timer);
  }, [model, dirty]);

  const engine = useMemo(() => {
    const conn = connections.find((c) => c.id === model?.connectionId);
    return String(conn?.engine ?? "mysql");
  }, [connections, model?.connectionId]);

  function updateModel(fn: (m: DataModel) => DataModel) {
    setModel((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
  }

  function createModel(args: {
    name: string;
    connectionId: string;
    connectionName: string;
    database: string;
  }) {
    const created = saveModel(newModel(args));
    reloadList();
    setSelectedId(created.id);
    setNewOpen(false);
    showToast(`已创建模型「${created.name}」`);
  }

  async function removeModel() {
    if (!model) return;
    const ok = await confirmDialog({
      title: "删除模型",
      message: `确定删除模型「${model.name}」？`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    deleteModel(model.id);
    reloadList();
    const rest = listModels();
    setSelectedId(rest[0]?.id ?? null);
    showToast("已删除模型");
  }

  function copyModel() {
    if (!model) return;
    const copy = duplicateModel(model.id);
    reloadList();
    if (copy) {
      setSelectedId(copy.id);
      showToast(`已复制为「${copy.name}」`);
    }
  }

  function autoLayout() {
    updateModel((m) => {
      const sorted = [...m.tables].sort((a, b) =>
        a.name.localeCompare(b.name, "zh"),
      );
      const positioned: ModelTable[] = [];
      let y = 40;
      for (let i = 0; i < sorted.length; i += LAYOUT_COLS) {
        const row = sorted.slice(i, i + LAYOUT_COLS);
        let x = 40;
        let rowHeight = 0;
        for (const t of row) {
          positioned.push({ ...t, x, y });
          rowHeight = Math.max(rowHeight, modelTableHeight(t));
          x += MODEL_TABLE_WIDTH + LAYOUT_GAP_X;
        }
        y += rowHeight + LAYOUT_GAP_Y;
      }
      return { ...m, tables: positioned };
    });
    showToast("已重新布局");
  }

  function removeTable(id: string) {
    updateModel((m) => ({
      ...m,
      tables: m.tables.filter((t) => t.id !== id),
      links: m.links.filter((l) => l.fromTable !== id && l.toTable !== id),
    }));
    setSelectedTableId((prev) => (prev === id ? null : prev));
  }

  async function importTables(names: string[]) {
    if (!model || names.length === 0) return;
    setBusy(true);
    try {
      await openConnection(model.connectionId);
      const built = await buildModelTables({
        connectionId: model.connectionId,
        engine,
        database: model.database,
        tableNames: names,
        existing: model.tables,
        existingLinks: model.links,
      });
      updateModel((m) => ({
        ...m,
        tables: [...m.tables, ...built.tables],
        links: built.links,
      }));
      setAddOpen(false);
      showToast(
        built.tables.length > 0
          ? `已导入 ${built.tables.length} 张表`
          : "所选表已在模型中",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportSql() {
    if (!model) return;
    try {
      const sql = modelToSql(model, engine);
      await downloadTextFile(
        `${model.name || "model"}.sql`,
        sql,
        "application/sql",
      );
      showToast("已导出建表 SQL");
    } catch (err) {
      if (!isSaveCancelled(err)) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    }
  }

  return (
    <div className="feature-pane model-pane">
      <div className="object-list-toolbar navicat-obj-toolbar">
        <div className="obj-toolbar-left">
          <button
            type="button"
            className="obj-tool-btn"
            onClick={() => setNewOpen(true)}
          >
            新建模型
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            disabled={!model || busy}
            onClick={() => setAddOpen(true)}
          >
            添加表
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            disabled={!model || model.tables.length === 0}
            onClick={autoLayout}
          >
            自动布局
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            disabled={!model || model.tables.length === 0}
            onClick={() => void exportSql()}
          >
            导出 SQL
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            disabled={!model}
            onClick={copyModel}
          >
            复制
          </button>
          <button
            type="button"
            className="obj-tool-btn is-danger-text"
            disabled={!model}
            onClick={() => void removeModel()}
          >
            删除
          </button>
          <span className="obj-tool-sep" />
          <span className="object-list-title">
            数据模型
            <span className="object-list-count">{models.length}</span>
          </span>
        </div>
        {model && (
          <span className="model-save-hint">
            {dirty
              ? "保存中…"
              : savedAt
                ? `已保存 ${formatDateTime(savedAt)}`
                : ""}
          </span>
        )}
      </div>

      {toast && <p className="obj-toast">{toast}</p>}

      <div className="model-body">
        <ul className="model-list">
          {models.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className={`auto-item ${m.id === selectedId ? "is-active" : ""}`}
                onClick={() => setSelectedId(m.id)}
              >
                <span className="model-item-icon">ER</span>
                <span className="auto-item-main">
                  <span className="auto-item-name">{m.name}</span>
                  <span className="auto-item-sub">
                    {m.connectionName || "未设置连接"}
                    {m.database ? ` · ${m.database}` : ""}
                  </span>
                  <span className="auto-item-sub">
                    {m.tables.length} 张表 · {formatDateTime(m.updatedAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {models.length === 0 && (
            <li className="pane-placeholder">
              还没有模型，点击「新建模型」开始。
            </li>
          )}
        </ul>

        <div className="model-detail">
          {model ? (
            <>
              <div className="model-detail-head">
                <input
                  className="auto-name"
                  value={model.name}
                  onChange={(e) =>
                    updateModel((m) => ({ ...m, name: e.target.value }))
                  }
                  aria-label="模型名称"
                />
                <span className="model-detail-meta">
                  {model.connectionName}
                  {model.database ? ` · ${model.database}` : ""} ·{" "}
                  {model.tables.length} 表 / {model.links.length} 关系
                </span>
              </div>
              <ModelCanvas
                model={model}
                selectedTableId={selectedTableId}
                onSelectTable={setSelectedTableId}
                onMoveTable={(id, x, y) =>
                  updateModel((m) => ({
                    ...m,
                    tables: m.tables.map((t) =>
                      t.id === id ? { ...t, x, y } : t,
                    ),
                  }))
                }
                onDeleteTable={removeTable}
              />
            </>
          ) : (
            <div className="feature-empty">
              <h2>模型</h2>
              <p>
                把数据库表结构画成 ER 图：拖拽实体、查看外键关系，并一键导出建表 SQL。
              </p>
            </div>
          )}
        </div>
      </div>

      {newOpen && (
        <NewModelDialog
          connections={connections}
          defaultConnection={activeConnection}
          defaultDatabase={selectedDatabase}
          onClose={() => setNewOpen(false)}
          onCreate={createModel}
        />
      )}

      {addOpen && model && (
        <AddTablesDialog
          connectionId={model.connectionId}
          database={model.database}
          existing={model.tables.map((t) => t.name)}
          busy={busy}
          onClose={() => setAddOpen(false)}
          onConfirm={(names) => void importTables(names)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NewModelDialog({
  connections,
  defaultConnection,
  defaultDatabase,
  onClose,
  onCreate,
}: {
  connections: ConnectionDto[];
  defaultConnection: ConnectionDto | null;
  defaultDatabase: string | null;
  onClose: () => void;
  onCreate: (args: {
    name: string;
    connectionId: string;
    connectionName: string;
    database: string;
  }) => void;
}) {
  const [name, setName] = useState("新建模型");
  const [connectionId, setConnectionId] = useState(
    defaultConnection?.id ?? connections[0]?.id ?? "",
  );
  const [database, setDatabase] = useState(
    defaultDatabase ?? defaultConnection?.database?.trim() ?? "",
  );
  const [databases, setDatabases] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!connectionId) {
      setDatabases([]);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        await openConnection(connectionId);
        const list = await listDatabases(connectionId);
        if (!cancelled) setDatabases(list);
      } catch {
        if (!cancelled) setDatabases([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  const conn = connections.find((c) => c.id === connectionId);

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !connectionId) return;
          onCreate({
            name: name.trim(),
            connectionId,
            connectionName: conn?.name ?? "",
            database: database.trim(),
          });
        }}
      >
        <h2>新建模型</h2>
        <label>
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label>
          连接
          <select
            value={connectionId}
            onChange={(e) => {
              setConnectionId(e.target.value);
              const next = connections.find((c) => c.id === e.target.value);
              setDatabase(next?.database?.trim() ?? "");
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
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            disabled={loading || databases.length === 0}
          >
            <option value="">{loading ? "加载中…" : "— 选择数据库 —"}</option>
            {databases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" disabled={!name.trim() || !connectionId}>
            创建
          </button>
        </div>
      </form>
    </div>
  );
}

function AddTablesDialog({
  connectionId,
  database,
  existing,
  busy,
  onClose,
  onConfirm,
}: {
  connectionId: string;
  database: string;
  existing: string[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (names: string[]) => void;
}) {
  const [tables, setTables] = useState<DbObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await openConnection(connectionId);
        const all = await listTables(connectionId, database || undefined);
        if (!cancelled) {
          setTables(all.filter((t) => t.kind !== "view"));
          setError(null);
        }
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
  }, [connectionId, database]);

  const existingSet = useMemo(() => new Set(existing), [existing]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables.filter(
      (t) => !q || t.name.toLowerCase().includes(q),
    );
  }, [tables, search]);

  const selectedNames = Object.entries(checked)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal modal-wide"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>添加表到模型</h2>
        <div className="model-add-tools">
          <input
            className="object-list-filter"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索表名"
          />
          <button
            type="button"
            className="obj-tool-btn"
            onClick={() =>
              setChecked(
                Object.fromEntries(
                  filtered
                    .filter((t) => !existingSet.has(t.name))
                    .map((t) => [t.name, true]),
                ),
              )
            }
          >
            全选
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            onClick={() => setChecked({})}
          >
            清空
          </button>
        </div>
        {loading && <p className="pane-placeholder">加载表清单…</p>}
        {error && <p className="pane-error">{error}</p>}
        {!loading && !error && (
          <ul className="model-add-list">
            {filtered.map((t) => {
              const already = existingSet.has(t.name);
              return (
                <li key={t.name}>
                  <label className={already ? "is-disabled" : undefined}>
                    <input
                      type="checkbox"
                      disabled={already}
                      checked={!!checked[t.name]}
                      onChange={(e) =>
                        setChecked((prev) => ({
                          ...prev,
                          [t.name]: e.target.checked,
                        }))
                      }
                    />
                    <span className="object-kind">{already ? "✓" : "T"}</span>
                    {t.name}
                    {already && <em>（已在模型中）</em>}
                  </label>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="pane-placeholder">无匹配表</li>
            )}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            disabled={busy || selectedNames.length === 0}
            onClick={() => onConfirm(selectedNames)}
          >
            {busy ? "导入中…" : `导入 ${selectedNames.length} 张表`}
          </button>
        </div>
      </div>
    </div>
  );
}
