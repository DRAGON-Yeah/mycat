import { useCallback, useEffect, useState } from "react";
import {
  deleteConnection,
  exportConnections,
  importConnections,
  listConnections,
  upsertConnection,
} from "../connections/api";
import { ConnectionForm } from "../connections/ConnectionForm";
import type { ConnectionDto, UpsertConnectionInput } from "../connections/types";
import {
  closeConnection,
  listDatabases,
  openConnection,
} from "../connections/sessionApi";
import { useWorkspaceStore } from "../../stores/workspaceStore";

type ConnNode = {
  conn: ConnectionDto;
  expanded: boolean;
  loading: boolean;
  error: string | null;
  databases: string[];
  openDbs: Record<string, boolean>;
};

export function ConnectionTree() {
  const [nodes, setNodes] = useState<ConnNode[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ConnectionDto | null | undefined>(
    undefined,
  );

  const activeConnectionId = useWorkspaceStore((s) => s.activeConnectionId);
  const selectedDatabase = useWorkspaceStore((s) => s.selectedDatabase);
  const openConn = useWorkspaceStore((s) => s.openConnection);
  const clearConnection = useWorkspaceStore((s) => s.clearConnection);
  const selectDatabase = useWorkspaceStore((s) => s.selectDatabase);

  const reload = useCallback(async () => {
    try {
      const items = await listConnections();
      setNodes((prev) => {
        const prevMap = new Map(prev.map((n) => [n.conn.id, n]));
        return items.map((conn) => {
          const old = prevMap.get(conn.id);
          return old
            ? { ...old, conn }
            : {
                conn,
                expanded: false,
                loading: false,
                error: null,
                databases: [],
                openDbs: {},
              };
        });
      });
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
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

  async function toggleConnection(id: string) {
    const node = nodes.find((n) => n.conn.id === id);
    if (!node) return;

    if (node.expanded) {
      setNodes((prev) =>
        prev.map((n) => (n.conn.id === id ? { ...n, expanded: false } : n)),
      );
      return;
    }

    setNodes((prev) =>
      prev.map((n) =>
        n.conn.id === id ? { ...n, loading: true, error: null, expanded: true } : n,
      ),
    );
    try {
      openConn(node.conn);
      await openConnection(node.conn.id);
      let databases: string[] = [];
      if (node.conn.engine === "sqlite") {
        databases = [node.conn.host || "main"];
      } else {
        databases = await listDatabases(node.conn.id);
      }
      setNodes((prev) =>
        prev.map((n) =>
          n.conn.id === id
            ? { ...n, loading: false, databases, error: null, expanded: true }
            : n,
        ),
      );
      if (node.conn.database?.trim()) {
        selectDatabase(node.conn.database.trim());
      }
    } catch (err) {
      setNodes((prev) =>
        prev.map((n) =>
          n.conn.id === id
            ? {
                ...n,
                loading: false,
                error: err instanceof Error ? err.message : String(err),
                expanded: true,
              }
            : n,
        ),
      );
    }
  }

  function toggleDbFolder(connId: string, db: string) {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.conn.id !== connId) return n;
        return {
          ...n,
          openDbs: { ...n.openDbs, [db]: !n.openDbs[db] },
        };
      }),
    );
  }

  return (
    <aside className="pane connection-tree" aria-label="我的连接">
      <div className="pane-title-row">
        <div className="pane-title">我的连接</div>
        <div className="pane-title-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setEditing(null)}
          >
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
                  await importConnections(JSON.parse(text));
                  await reload();
                } catch (err) {
                  setListError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </label>
        </div>
      </div>

      {listError && <p className="pane-error">{listError}</p>}

      <ul className="tree-root">
        {nodes.map((n) => (
          <li key={n.conn.id} className="tree-conn">
            <div
              className={`tree-row ${activeConnectionId === n.conn.id ? "is-active" : ""}`}
            >
              <button
                type="button"
                className="tree-twist"
                onClick={() => void toggleConnection(n.conn.id)}
                aria-label={n.expanded ? "折叠" : "展开"}
              >
                {n.expanded ? "▾" : "▸"}
              </button>
              <button
                type="button"
                className="tree-label"
                onClick={() => void toggleConnection(n.conn.id)}
              >
                <span
                  className="color-dot"
                  style={{ background: n.conn.color || "var(--accent)" }}
                />
                {n.conn.starred ? "★ " : ""}
                {n.conn.name}
              </button>
              <div className="tree-actions">
                <button type="button" onClick={() => setEditing(n.conn)}>
                  编辑
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await closeConnection(n.conn.id);
                    } catch {
                      // ignore
                    }
                    if (activeConnectionId === n.conn.id) clearConnection();
                    await deleteConnection(n.conn.id);
                    await reload();
                  }}
                >
                  删除
                </button>
              </div>
            </div>
            {n.expanded && (
              <ul className="tree-children">
                {n.loading && <li className="pane-placeholder">加载中…</li>}
                {n.error && <li className="pane-error">{n.error}</li>}
                {!n.loading &&
                  n.databases.map((db) => (
                    <li key={db}>
                      <div
                        className={`tree-row tree-db ${selectedDatabase === db && activeConnectionId === n.conn.id ? "is-active" : ""}`}
                      >
                        <button
                          type="button"
                          className="tree-twist"
                          onClick={() => toggleDbFolder(n.conn.id, db)}
                        >
                          {n.openDbs[db] ? "▾" : "▸"}
                        </button>
                        <button
                          type="button"
                          className="tree-label"
                          onClick={() => {
                            openConn(n.conn);
                            selectDatabase(db);
                            setNodes((prev) =>
                              prev.map((x) =>
                                x.conn.id === n.conn.id
                                  ? {
                                      ...x,
                                      openDbs: { ...x.openDbs, [db]: true },
                                    }
                                  : x,
                              ),
                            );
                          }}
                        >
                          <span className="tree-icon">D</span>
                          {db}
                        </button>
                      </div>
                      {n.openDbs[db] && (
                        <ul className="tree-children">
                          <li>
                            <button
                              type="button"
                              className={`tree-row tree-folder ${selectedDatabase === db && activeConnectionId === n.conn.id ? "is-active" : ""}`}
                              onClick={() => {
                                openConn(n.conn);
                                selectDatabase(db);
                              }}
                            >
                              <span className="tree-icon">T</span>
                              表
                            </button>
                          </li>
                          <li>
                            <div className="tree-row tree-folder is-muted">
                              <span className="tree-icon">V</span>
                              视图
                            </div>
                          </li>
                          <li>
                            <div className="tree-row tree-folder is-muted">
                              <span className="tree-icon">F</span>
                              函数
                            </div>
                          </li>
                          <li>
                            <div className="tree-row tree-folder is-muted">
                              <span className="tree-icon">Q</span>
                              查询
                            </div>
                          </li>
                        </ul>
                      )}
                    </li>
                  ))}
                {!n.loading && !n.error && n.databases.length === 0 && (
                  <li className="pane-placeholder">无数据库</li>
                )}
              </ul>
            )}
          </li>
        ))}
        {nodes.length === 0 && (
          <li className="pane-placeholder">暂无连接，点击「新建」开始</li>
        )}
      </ul>

      {activeConnectionId && (
        <div className="tree-footer">
          <button
            type="button"
            className="ghost-btn"
            onClick={async () => {
              try {
                await closeConnection(activeConnectionId);
              } catch {
                // ignore
              }
              clearConnection();
              setNodes((prev) =>
                prev.map((n) =>
                  n.conn.id === activeConnectionId
                    ? { ...n, expanded: false, databases: [], openDbs: {} }
                    : n,
                ),
              );
            }}
          >
            断开当前连接
          </button>
        </div>
      )}

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
