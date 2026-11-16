import { useEffect, useState } from "react";
import {
  listTables,
  type DbObject,
} from "../connections/sessionApi";
import { useWorkspaceStore } from "../../stores/workspaceStore";

export function ObjectListGrid() {
  const connection = useWorkspaceStore((s) => s.activeConnection);
  const database = useWorkspaceStore((s) => s.selectedDatabase);
  const openTable = useWorkspaceStore((s) => s.openTable);
  const selectTableMeta = useWorkspaceStore((s) => s.selectTableMeta);
  const [tables, setTables] = useState<DbObject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!connection || !database) {
        setTables([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const items = await listTables(connection.id, database);
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
  }, [connection, database]);

  if (!connection) {
    return <p className="pane-placeholder">请先打开一个连接。</p>;
  }
  if (!database) {
    return <p className="pane-placeholder">请在左侧选择一个数据库以查看表清单。</p>;
  }

  const filtered = tables.filter((t) =>
    t.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="object-list-grid">
      <div className="object-list-toolbar">
        <div className="object-list-title">
          对象 · 表
          <span className="object-list-count">{filtered.length} 张表</span>
        </div>
        <input
          className="object-list-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="筛选表名"
        />
      </div>
      {loading && <p className="pane-placeholder">加载中…</p>}
      {error && <p className="pane-error">{error}</p>}
      {!loading && !error && (
        <div className="object-list-table-wrap">
          <table className="object-list-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>行</th>
                <th>引擎</th>
                <th>注释</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={`${t.kind}-${t.name}`}
                  onClick={() => selectTableMeta(t.name)}
                  onDoubleClick={() => openTable(t.name)}
                >
                  <td>
                    <span className="object-kind">
                      {t.kind === "view" ? "V" : "T"}
                    </span>
                    {t.name}
                  </td>
                  <td>{t.kind === "view" ? "视图" : "表"}</td>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="pane-placeholder">
                    无匹配表
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
