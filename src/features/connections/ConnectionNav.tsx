import { useCallback, useEffect, useState } from "react";
import {
  deleteConnection,
  exportConnections,
  importConnections,
  listConnections,
  upsertConnection,
} from "./api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { ConnectionForm } from "./ConnectionForm";
import type { ConnectionDto, UpsertConnectionInput } from "./types";

export function ConnectionNav() {
  const openConnection = useWorkspaceStore((s) => s.openConnection);
  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId);
  const [items, setItems] = useState<ConnectionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ConnectionDto | null | undefined>(
    undefined,
  );

  const reload = useCallback(async () => {
    try {
      setItems(await listConnections());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save(input: UpsertConnectionInput) {
    const saved = await upsertConnection(input);
    await reload();
    return saved;
  }

  return (
    <aside className="pane connection-nav" aria-label="连接导航">
      <div className="pane-title-row">
        <div className="pane-title">连接</div>
        <div className="pane-title-actions">
          <button type="button" className="ghost-btn" onClick={() => setEditing(null)}>
            新建
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={async () => {
              const data = await exportConnections();
              const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "my-navicat-connections.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            导出
          </button>
          <label className="ghost-btn file-btn">
            导入
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const text = await file.text();
                  const items = JSON.parse(text);
                  await importConnections(items);
                  await reload();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </label>
        </div>
      </div>
      {error && <p className="pane-error">{error}</p>}
      <ul className="connection-list">
        {items.map((c) => (
          <li key={c.id} className="connection-item">
            <div className="connection-main">
              <span
                className="color-dot"
                style={{ background: c.color || "var(--accent)" }}
              />
              <div>
                <div className="connection-name">
                  {c.starred ? "★ " : ""}
                  {c.name}
                </div>
                <div className="connection-meta">
                  {c.engine}
                  {c.groupName ? ` · ${c.groupName}` : ""}
                </div>
              </div>
            </div>
            <div className="connection-actions">
              <button
                type="button"
                className={activeConnectionId === c.id ? "is-active" : undefined}
                onClick={() => openConnection(c)}
              >
                打开
              </button>
              <button type="button" onClick={() => setEditing(c)}>
                编辑
              </button>
              <button
                type="button"
                onClick={async () => {
                  await deleteConnection(c.id);
                  await reload();
                }}
              >
                删除
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && (
          <li className="pane-placeholder">暂无连接，点击「新建」开始</li>
        )}
      </ul>

      {editing !== undefined && (
        <ConnectionForm
          initial={editing}
          onCancel={() => setEditing(undefined)}
          onSaved={() => setEditing(undefined)}
          save={save}
        />
      )}
    </aside>
  );
}
