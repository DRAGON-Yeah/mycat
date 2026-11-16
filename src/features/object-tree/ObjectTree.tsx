import { useEffect, useState } from "react";
import {
  closeConnection,
  listDatabases,
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
  const [databases, setDatabases] = useState<string[]>([]);
  const [activeDb, setActiveDb] = useState<string | null>(null);
  const [tables, setTables] = useState<DbObject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const openTable = useWorkspaceStore((s) => s.openTable);
  const clearConnection = useWorkspaceStore((s) => s.clearConnection);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!connection) {
        setDatabases([]);
        setActiveDb(null);
        setTables([]);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await openConnection(connection.id);
        if (cancelled) return;

        const configuredDb = connection.database?.trim() || null;
        if (configuredDb) {
          setDatabases([]);
          setActiveDb(configuredDb);
          const items = await listTables(connection.id, configuredDb);
          if (!cancelled) setTables(items);
          return;
        }

        // No default database: browse databases first (MySQL 1046 otherwise).
        if (connection.engine === "sqlite") {
          setDatabases([]);
          setActiveDb(null);
          const items = await listTables(connection.id);
          if (!cancelled) setTables(items);
          return;
        }

        const dbs = await listDatabases(connection.id);
        if (cancelled) return;
        setDatabases(dbs);
        setActiveDb(null);
        setTables([]);
      } catch (err) {
        if (!cancelled) {
          setDatabases([]);
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

  async function selectDatabase(db: string) {
    if (!connection) return;
    setLoading(true);
    setError(null);
    try {
      const items = await listTables(connection.id, db);
      setActiveDb(db);
      setTables(items);
    } catch (err) {
      setTables([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

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
      {databases.length > 0 && (
        <div className="object-section">
          <div className="object-section-title">数据库</div>
          <ul className="object-list">
            {databases.map((db) => (
              <li key={db}>
                <button
                  type="button"
                  className={`object-item ${activeDb === db ? "is-active" : ""}`}
                  onClick={() => void selectDatabase(db)}
                >
                  <span className="object-kind">D</span>
                  {db}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {activeDb && (
        <div className="object-section">
          <div className="object-section-title">表 · {activeDb}</div>
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
            {!loading && tables.length === 0 && (
              <li className="pane-placeholder">该库暂无表</li>
            )}
          </ul>
        </div>
      )}
      {!activeDb && databases.length === 0 && !loading && !error && (
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
      )}
    </aside>
  );
}
