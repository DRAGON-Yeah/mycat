import { useEffect, useRef, useState } from "react";
import {
  listTables,
  type DbObject,
} from "../connections/sessionApi";
import {
  TableContextMenu,
  type TableMenuTarget,
} from "../nav-tree/TableContextMenu";
import { loadTableGroups } from "../nav-tree/tableGroups";
import { useWorkspaceStore } from "../../stores/workspaceStore";

function formatBytes(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRows(n?: number | null) {
  if (n == null) return "—";
  return n.toLocaleString();
}

export function ObjectListGrid() {
  const connection = useWorkspaceStore((s) => s.activeConnection);
  const database = useWorkspaceStore((s) => s.selectedDatabase);
  const folder = useWorkspaceStore((s) => s.selectedFolder);
  const openTable = useWorkspaceStore((s) => s.openTable);
  const openTableDesigner = useWorkspaceStore((s) => s.openTableDesigner);
  const selectTableMeta = useWorkspaceStore((s) => s.selectTableMeta);
  const selectedTable = useWorkspaceStore((s) => s.selectedTable);
  const objectListFilter = useWorkspaceStore((s) => s.objectListFilter);
  const focusObjectListFilter = useWorkspaceStore(
    (s) => s.focusObjectListFilter,
  );
  const setObjectListFilter = useWorkspaceStore((s) => s.setObjectListFilter);
  const consumeObjectListFilterFocus = useWorkspaceStore(
    (s) => s.consumeObjectListFilterFocus,
  );
  const [tables, setTables] = useState<DbObject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState<TableMenuTarget | null>(null);
  const [groupMap, setGroupMap] = useState<Record<string, string>>({});
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFilter(objectListFilter);
  }, [objectListFilter]);

  useEffect(() => {
    if (!focusObjectListFilter) return;
    filterRef.current?.focus();
    filterRef.current?.select();
    consumeObjectListFilterFocus();
  }, [focusObjectListFilter, consumeObjectListFilterFocus]);

  useEffect(() => {
    function onDoc() {
      setMenu(null);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!connection || !database) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "r") {
        e.preventDefault();
        setTick((x) => x + 1);
        return;
      }
      if (key === "o" && selectedTable) {
        e.preventDefault();
        openTable(selectedTable);
        return;
      }
      if (key === "d" && selectedTable && folder !== "views") {
        e.preventDefault();
        openTableDesigner({
          connection,
          database,
          table: selectedTable,
          mode: "alter",
        });
        return;
      }
      if (key === "n" && folder !== "views") {
        e.preventDefault();
        openTableDesigner({
          connection,
          database,
          table: "new_table",
          mode: "create",
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    connection,
    database,
    selectedTable,
    folder,
    openTable,
    openTableDesigner,
  ]);

  const wantViews = folder === "views";
  const title = wantViews ? "视图" : "表";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!connection || !database) {
        setTables([]);
        return;
      }
      if (folder && folder !== "tables" && folder !== "views") {
        setTables([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const items = await listTables(connection.id, database);
        if (!cancelled) {
          setTables(
            items.filter((t) =>
              wantViews ? t.kind === "view" : t.kind !== "view",
            ),
          );
        }
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
  }, [connection, database, folder, wantViews, tick]);

  useEffect(() => {
    if (!connection || !database) {
      setGroupMap({});
      return;
    }
    void loadTableGroups(connection.id, database)
      .then((s) => setGroupMap(s.membership))
      .catch(() => setGroupMap({}));
  }, [connection, database, tick]);

  if (!connection) {
    return <p className="pane-placeholder">请先打开一个连接。</p>;
  }
  if (!database) {
    return (
      <p className="pane-placeholder">
        请在左侧展开连接，点击数据库下的「表」查看对象列表。
      </p>
    );
  }

  const filtered = tables
    .filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .slice()
    .sort((a, b) => {
      const ga = groupMap[a.name] || "";
      const gb = groupMap[b.name] || "";
      if (ga !== gb) return ga.localeCompare(gb, "zh");
      return a.name.localeCompare(b.name, "zh");
    });

  return (
    <div className="object-list-grid">
      <div className="object-list-toolbar navicat-obj-toolbar">
        <div className="obj-toolbar-left">
          <button
            type="button"
            className="obj-tool-btn"
            title="刷新"
            onClick={() => setTick((x) => x + 1)}
          >
            ↻
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            title="打开表 (⌘O)"
            disabled={!selectedTable}
            onClick={() => selectedTable && openTable(selectedTable)}
          >
            ⊞ 打开
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            title="设计表 (⌘D)"
            disabled={!selectedTable || wantViews}
            onClick={() =>
              selectedTable &&
              connection &&
              database &&
              openTableDesigner({
                connection,
                database,
                table: selectedTable,
                mode: "alter",
              })
            }
          >
            设计
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            title="新建表 (⌘N)"
            disabled={wantViews || !connection || !database}
            onClick={() =>
              connection &&
              database &&
              openTableDesigner({
                connection,
                database,
                table: "new_table",
                mode: "create",
              })
            }
          >
            新建
          </button>
          <span className="obj-tool-sep" />
          <span className="object-list-title">
            对象 · {title}
            <span className="object-list-count">{filtered.length}</span>
          </span>
        </div>
        <input
          ref={filterRef}
          className="object-list-filter"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setObjectListFilter(e.target.value);
          }}
          placeholder="搜索 / 在数据库中查找"
        />
      </div>
      {toast && <p className="pane-placeholder">{toast}</p>}
      {loading && <p className="pane-placeholder">加载中…</p>}
      {error && <p className="pane-error">{error}</p>}
      {!loading && !error && (
        <div className="object-list-table-wrap">
          <table className="object-list-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>组</th>
                <th>行</th>
                <th>数据长度</th>
                <th>引擎</th>
                <th>创建日期</th>
                <th>修改日期</th>
                <th>排序规则</th>
                <th>注释</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={`${t.kind}-${t.name}`}
                  className={
                    selectedTable === t.name ? "is-selected" : undefined
                  }
                  onClick={() => selectTableMeta(t.name)}
                  onDoubleClick={() => openTable(t.name)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectTableMeta(t.name);
                    setMenu({
                      x: e.clientX,
                      y: e.clientY,
                      conn: connection,
                      database,
                      table: t.name,
                      kind: t.kind,
                    });
                  }}
                >
                  <td>
                    <span className="object-kind">
                      {t.kind === "view" ? "V" : "T"}
                    </span>
                    {t.name}
                  </td>
                  <td>{groupMap[t.name] || "—"}</td>
                  <td>{formatRows(t.tableRows)}</td>
                  <td>{formatBytes(t.dataLength)}</td>
                  <td>{t.engine ?? "—"}</td>
                  <td>{t.createTime ?? "—"}</td>
                  <td>{t.updateTime ?? "—"}</td>
                  <td>{t.collation ?? "—"}</td>
                  <td className="comment-cell">{t.comment || "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="pane-placeholder">
                    无匹配{title}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {menu && (
        <TableContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onRefresh={() => setTick((x) => x + 1)}
          onMessage={(msg) => {
            setToast(msg);
            window.setTimeout(() => setToast(null), 2800);
          }}
        />
      )}
    </div>
  );
}
