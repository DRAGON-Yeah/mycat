import { useEffect, useState } from "react";
import {
  closeConnection,
  listTables,
  openConnection,
  type DbObject,
} from "../connections/sessionApi";
import type { ConnectionDto } from "../connections/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";

type Props = {
  connection: ConnectionDto | null;
};

export function ObjectTree({ connection }: Props) {
  const [tables, setTables] = useState<DbObject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const openTable = useWorkspaceStore((s) => s.openTable);
  const clearConnection = useWorkspaceStore((s) => s.clearConnection);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!connection) {
        setTables([]);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await openConnection(connection.id);
        if (cancelled) return;
        const items = await listTables(connection.id);
        if (!cancelled) setTables(items);
      } catch (err) {
        if (!cancelled) {
          setTables([]);
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
  }, [connection]);

  if (!connection) {
    return (
      <aside className="pane object-tree" aria-label="对象树">
        <div className="pane-title">对象</div>
        <p className="pane-placeholder">打开一个连接以浏览对象</p>
      </aside>
    );
  }

  return (
    <aside className="pane object-tree" aria-label="对象树">
      <div className="pane-title-row">
        <div className="pane-title">{connection.name}</div>
        <button
          type="button"
          className="ghost-btn"
          onClick={async () => {
            try {
              await closeConnection(connection.id);
            } catch {
              // ignore
            }
            clearConnection();
          }}
        >
          断开
        </button>
      </div>
      {loading && <p className="pane-placeholder">加载中…</p>}
      {error && <p className="pane-error">{error}</p>}
      <ul className="object-list">
        {tables.map((t) => (
          <li key={`${t.kind}-${t.name}`}>
            <button
              type="button"
              className="object-item"
              onDoubleClick={() => openTable(t.name)}
              title="双击打开表"
            >
              <span className="object-kind">{t.kind === "view" ? "V" : "T"}</span>
              {t.name}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
