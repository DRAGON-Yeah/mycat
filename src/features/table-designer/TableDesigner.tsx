import { useCallback, useEffect, useMemo, useState } from "react";
import {
  executeSql,
  openConnection,
} from "../connections/sessionApi";
import type { DesignerTab } from "../../stores/workspaceStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { identOk } from "../nav-tree/sqlIdent";
import { buildAlterTableSql, buildCreateTableSql } from "./ddl";
import { loadDesignerColumns } from "./loadColumns";
import { newColumn, type DesignerColumn } from "./types";

type Props = {
  tab: DesignerTab;
};

export function TableDesigner({ tab }: Props) {
  const markDirty = useWorkspaceStore((s) => s.markDesignerDirty);
  const updateTab = useWorkspaceStore((s) => s.updateDesignerTab);
  const openTable = useWorkspaceStore((s) => s.openTable);
  const [tableName, setTableName] = useState(tab.table);
  const [columns, setColumns] = useState<DesignerColumn[]>([]);
  const [baseline, setBaseline] = useState<DesignerColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (tab.mode === "create") {
      const cols = [
        newColumn({
          name: "id",
          rawType:
            String(tab.connectionEngine).toLowerCase() === "postgres"
              ? "serial"
              : String(tab.connectionEngine).toLowerCase() === "sqlite"
                ? "INTEGER"
                : "int",
          nullable: false,
          isPk: true,
          originalName: null,
        }),
        newColumn({ name: "name", rawType: "varchar(255)", originalName: null }),
      ];
      setColumns(cols);
      setBaseline([]);
      setTableName(tab.table || "new_table");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const cols = await loadDesignerColumns({
        connectionId: tab.connectionId,
        engine: tab.connectionEngine,
        database: tab.database,
        table: tab.table,
      });
      setColumns(cols);
      setBaseline(cols.map((c) => ({ ...c })));
      setTableName(tab.table);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setColumns([]);
      setBaseline([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchCol(key: string, patch: Partial<DesignerColumn>) {
    setColumns((prev) =>
      prev.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    );
    markDirty(tab.id, true);
    setMessage(null);
  }

  function addCol() {
    setColumns((prev) => [...prev, newColumn()]);
    markDirty(tab.id, true);
  }

  function removeCol(key: string) {
    setColumns((prev) => prev.filter((c) => c.key !== key));
    markDirty(tab.id, true);
  }

  const previewSql = useMemo(() => {
    try {
      if (tab.mode === "create") {
        return buildCreateTableSql({
          engine: tab.connectionEngine,
          database: tab.database,
          table: tableName.trim() || "new_table",
          columns,
        });
      }
      const stmts = buildAlterTableSql({
        engine: tab.connectionEngine,
        database: tab.database,
        table: tab.table,
        baseline,
        columns,
      });
      return stmts.length ? stmts.join(";\n") + ";" : "-- 无变更";
    } catch (err) {
      return `-- ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [tab, tableName, columns, baseline]);

  async function onSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await openConnection(tab.connectionId);
      if (tab.mode === "create") {
        const name = tableName.trim();
        if (!identOk(name)) {
          throw new Error("表名仅允许字母、数字、下划线");
        }
        const sql = buildCreateTableSql({
          engine: tab.connectionEngine,
          database: tab.database,
          table: name,
          columns,
        });
        await executeSql(tab.connectionId, sql);
        updateTab(tab.id, { table: name, dirty: false });
        markDirty(tab.id, false);
        setMessage(`已创建表 ${name}`);
        openTable(name);
        return;
      }
      const stmts = buildAlterTableSql({
        engine: tab.connectionEngine,
        database: tab.database,
        table: tab.table,
        baseline,
        columns,
      });
      if (stmts.length === 0) {
        setMessage("没有需要保存的变更");
        markDirty(tab.id, false);
        return;
      }
      for (const sql of stmts) {
        await executeSql(tab.connectionId, sql);
      }
      markDirty(tab.id, false);
      setMessage(`已应用 ${stmts.length} 条 ALTER`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="table-designer">
      <div className="table-designer-toolbar">
        <div className="table-designer-title">
          {tab.mode === "create" ? "新建表" : "设计表"}
          <span className="table-designer-meta">
            {tab.connectionName} · {tab.database}
          </span>
        </div>
        <label className="table-designer-name">
          表名
          <input
            value={tableName}
            disabled={tab.mode === "alter" || saving}
            onChange={(e) => {
              setTableName(e.target.value);
              markDirty(tab.id, true);
            }}
          />
        </label>
        <button type="button" disabled={saving || loading} onClick={addCol}>
          添加列
        </button>
        <button
          type="button"
          className="primary"
          disabled={saving || loading || columns.length === 0}
          onClick={() => void onSave()}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      {loading && <p className="pane-placeholder">加载列信息…</p>}
      {error && <p className="pane-error">{error}</p>}
      {message && <p className="pane-placeholder">{message}</p>}

      {!loading && (
        <div className="table-designer-grid-wrap">
          <table className="table-designer-grid">
            <thead>
              <tr>
                <th>列名</th>
                <th>类型</th>
                <th>可空</th>
                <th>主键</th>
                <th>默认值</th>
                <th>注释</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.key}>
                  <td>
                    <input
                      value={c.name}
                      onChange={(e) =>
                        patchCol(c.key, { name: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={c.rawType}
                      onChange={(e) =>
                        patchCol(c.key, { rawType: e.target.value })
                      }
                    />
                  </td>
                  <td className="td-check">
                    <input
                      type="checkbox"
                      checked={c.nullable}
                      onChange={(e) =>
                        patchCol(c.key, { nullable: e.target.checked })
                      }
                    />
                  </td>
                  <td className="td-check">
                    <input
                      type="checkbox"
                      checked={c.isPk}
                      onChange={(e) =>
                        patchCol(c.key, { isPk: e.target.checked })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={c.defaultValue ?? ""}
                      placeholder="NULL"
                      onChange={(e) =>
                        patchCol(c.key, {
                          defaultValue:
                            e.target.value.trim() === ""
                              ? null
                              : e.target.value,
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={c.comment ?? ""}
                      onChange={(e) =>
                        patchCol(c.key, { comment: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => removeCol(c.key)}
                    >
                      删
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="table-designer-preview">
        <div className="table-designer-preview-label">SQL 预览</div>
        <pre>{previewSql}</pre>
      </div>
    </div>
  );
}
