import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyRowChanges,
  dumpTableSql,
  fetchTablePage,
  writeLog,
  type RowChange,
  type RowsPage,
} from "../connections/sessionApi";
import { ExportCsvButton } from "../import-export/ExportCsvButton";
import { ImportCsvButton } from "../import-export/ImportCsvButton";
import { downloadTextFile } from "../import-export/csv";
import type { TableTab } from "../../stores/workspaceStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

type Props = {
  tab: TableTab;
};

type GridRow = {
  key: string;
  values: unknown[];
  deleted?: boolean;
  inserted?: boolean;
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function parseCellInput(raw: string): unknown {
  if (raw === "NULL") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.trim() !== "" && !Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
    return Number(raw);
  }
  return raw;
}

function pickPkColumn(columns: { name: string }[]): string {
  const id = columns.find((c) => c.name.toLowerCase() === "id");
  return id?.name ?? columns[0]?.name ?? "id";
}

export function DataGrid({ tab }: Props) {
  const markDirty = useWorkspaceStore((s) => s.markTabDirty);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);
  const [sortCol, setSortCol] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"ASC" | "DESC">("ASC");
  const [filterCol, setFilterCol] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [appliedFilter, setAppliedFilter] = useState<{
    col?: string;
    value?: string;
  }>({});
  const [data, setData] = useState<RowsPage | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [baseline, setBaseline] = useState<GridRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    if (rows.length !== baseline.length) return true;
    return rows.some((r, i) => {
      const b = baseline[i];
      if (!b) return true;
      if (r.deleted !== b.deleted || r.inserted !== b.inserted) return true;
      return JSON.stringify(r.values) !== JSON.stringify(b.values);
    });
  }, [rows, baseline]);

  useEffect(() => {
    markDirty(tab.id, dirty);
  }, [dirty, markDirty, tab.id]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTablePage({
        connectionId: tab.connectionId,
        table: tab.table,
        page,
        pageSize,
        sortCol,
        sortDir,
        filterCol: appliedFilter.col,
        filterValue: appliedFilter.value,
      });
      setData(result);
      const mapped: GridRow[] = result.rows.map((values, idx) => ({
        key: `r-${page}-${idx}`,
        values: [...values],
      }));
      setRows(mapped);
      setBaseline(mapped.map((r) => ({ ...r, values: [...r.values] })));
    } catch (err) {
      setData(null);
      setRows([]);
      setBaseline([]);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      void writeLog("ERROR", `fetch_table_page ${tab.table}: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [
    tab.connectionId,
    tab.table,
    page,
    pageSize,
    sortCol,
    sortDir,
    appliedFilter.col,
    appliedFilter.value,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
    setSortCol(undefined);
    setSortDir("ASC");
    setFilterCol("");
    setFilterValue("");
    setAppliedFilter({});
  }, [tab.id]);

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / Math.max(1, data.pageSize)))
    : 1;

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortCol(col);
      setSortDir("ASC");
    }
    setPage(1);
  }

  function updateCell(rowIndex: number, colIndex: number, raw: string) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIndex || r.deleted) return r;
        const values = [...r.values];
        values[colIndex] = parseCellInput(raw);
        return { ...r, values };
      }),
    );
  }

  async function commit() {
    if (!data || !dirty) return;
    const pk = pickPkColumn(data.columns);
    const pkIdx = data.columns.findIndex((c) => c.name === pk);
    if (pkIdx < 0) {
      setError("无法确定主键列（需要 id 或首列）");
      return;
    }

    const changes: RowChange[] = [];
    const baseByKey = new Map(baseline.map((b) => [b.key, b]));

    for (const row of rows) {
      const base = baseByKey.get(row.key);
      if (row.inserted && !row.deleted) {
        changes.push({
          op: "insert",
          pkColumns: [],
          pkValues: [],
          columns: data.columns.map((c) => c.name),
          values: row.values,
        });
        continue;
      }
      if (row.deleted && base && !base.inserted) {
        changes.push({
          op: "delete",
          pkColumns: [pk],
          pkValues: [base.values[pkIdx]],
          columns: [],
          values: [],
        });
        continue;
      }
      if (!base || row.deleted) continue;
      const changedCols: string[] = [];
      const changedVals: unknown[] = [];
      data.columns.forEach((c, i) => {
        if (JSON.stringify(row.values[i]) !== JSON.stringify(base.values[i])) {
          changedCols.push(c.name);
          changedVals.push(row.values[i]);
        }
      });
      if (changedCols.length > 0) {
        changes.push({
          op: "update",
          pkColumns: [pk],
          pkValues: [base.values[pkIdx]],
          columns: changedCols,
          values: changedVals,
        });
      }
    }

    if (changes.length === 0) {
      setBaseline(rows.map((r) => ({ ...r, values: [...r.values] })));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await applyRowChanges({
        connectionId: tab.connectionId,
        table: tab.table,
        changes,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="data-grid">
      <div className="data-grid-toolbar">
        <div className="data-grid-title">
          {tab.connectionName} / {tab.table}
          {data ? ` · ${data.total} 行` : ""}
          {dirty ? " · 未保存" : ""}
        </div>
        <div className="data-grid-filters">
          <select
            value={filterCol}
            onChange={(e) => setFilterCol(e.target.value)}
          >
            <option value="">过滤列</option>
            {(data?.columns ?? []).map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            placeholder="包含…"
          />
          <button
            type="button"
            onClick={() => {
              setPage(1);
              setAppliedFilter({
                col: filterCol || undefined,
                value: filterValue || undefined,
              });
            }}
          >
            应用
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterCol("");
              setFilterValue("");
              setAppliedFilter({});
              setPage(1);
            }}
          >
            清除
          </button>
          <button
            type="button"
            onClick={() => {
              if (!data) return;
              const empty = data.columns.map(() => null);
              setRows((prev) => [
                ...prev,
                {
                  key: `new-${Date.now()}`,
                  values: empty,
                  inserted: true,
                },
              ]);
            }}
          >
            增行
          </button>
          <button type="button" disabled={!dirty || saving} onClick={() => void commit()}>
            {saving ? "提交中…" : "提交"}
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => {
              setRows(baseline.map((r) => ({ ...r, values: [...r.values] })));
              setError(null);
            }}
          >
            撤销
          </button>
          <button type="button" onClick={() => void load()} disabled={loading || dirty}>
            刷新
          </button>
          <ExportCsvButton connectionId={tab.connectionId} table={tab.table} />
          {data && (
            <ImportCsvButton
              connectionId={tab.connectionId}
              table={tab.table}
              tableColumns={data.columns.map((c) => c.name)}
            />
          )}
          <button
            type="button"
            onClick={async () => {
              try {
                const sql = await dumpTableSql({
                  connectionId: tab.connectionId,
                  table: tab.table,
                  includeData: true,
                  engine: tab.connectionEngine,
                });
                downloadTextFile(`${tab.table}.sql`, sql, "application/sql");
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setError(msg);
                void writeLog("ERROR", `dump_table_sql ${tab.table}: ${msg}`);
              }
            }}
          >
            Dump SQL
          </button>
        </div>
      </div>

      {error && <p className="pane-error">{error}</p>}
      {loading && !data && <p className="pane-placeholder">加载中…</p>}

      <div className="data-grid-scroll">
        <table>
          <thead>
            <tr>
              <th className="row-actions-col" />
              {(data?.columns ?? []).map((c) => (
                <th key={c.name}>
                  <button type="button" onClick={() => toggleSort(c.name)}>
                    {c.name}
                    {sortCol === c.name ? (sortDir === "ASC" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={row.key}
                className={
                  row.deleted ? "is-deleted" : row.inserted ? "is-inserted" : undefined
                }
              >
                <td className="row-actions-col">
                  <button
                    type="button"
                    disabled={row.deleted}
                    onClick={() =>
                      setRows((prev) =>
                        prev.map((r, i) =>
                          i === ri
                            ? r.inserted
                              ? { ...r, deleted: true }
                              : { ...r, deleted: true }
                            : r,
                        ).filter((r) => !(r.inserted && r.deleted)),
                      )
                    }
                  >
                    删
                  </button>
                </td>
                {row.values.map((cell, ci) => (
                  <td key={ci} className={cell === null ? "is-null" : undefined}>
                    <input
                      className="cell-input"
                      disabled={!!row.deleted}
                      value={cellText(cell)}
                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="data-grid-pager">
        <button
          type="button"
          disabled={page <= 1 || loading || dirty}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          上一页
        </button>
        <span>
          第 {page} / {totalPages} 页（每页 {pageSize}）
        </span>
        <button
          type="button"
          disabled={page >= totalPages || loading || dirty}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
