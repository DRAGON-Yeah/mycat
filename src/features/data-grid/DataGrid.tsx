import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  buildCsvData,
  buildCsvHeaders,
  buildCsvHeadersAndData,
  buildInsertSql,
  buildJsonRow,
  buildTsvData,
  buildTsvHeaders,
  buildTsvHeadersAndData,
  buildUpdateSql,
} from "./copyAs";

type Props = {
  tab: TableTab;
};

type GridRow = {
  key: string;
  values: unknown[];
  deleted?: boolean;
  inserted?: boolean;
};

type MenuState = {
  x: number;
  y: number;
  rowIndex: number;
  colIndex: number;
} | null;

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

function typeHint(dataType: string): string {
  const t = dataType.toLowerCase();
  if (t.includes("int") || t.includes("decimal") || t.includes("numeric") || t.includes("float") || t.includes("double")) {
    return `# ${dataType}`;
  }
  if (t.includes("bool") || t === "bit") return `☑ ${dataType}`;
  if (t.includes("date") || t.includes("time")) return `◷ ${dataType}`;
  return `abc ${dataType}`;
}

export function DataGrid({ tab }: Props) {
  const markDirty = useWorkspaceStore((s) => s.markTabDirty);
  const selectedDatabase = useWorkspaceStore((s) => s.selectedDatabase);
  const database = tab.database || selectedDatabase;
  const [page, setPage] = useState(1);
  const [pageSize] = useState(1000);
  const [sortCol, setSortCol] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"ASC" | "DESC">("ASC");
  const [filterCol, setFilterCol] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [appliedFilter, setAppliedFilter] = useState<{
    col?: string;
    value?: string;
  }>({});
  const [data, setData] = useState<RowsPage | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [baseline, setBaseline] = useState<GridRow[]>([]);
  const [selectedRow, setSelectedRow] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<MenuState>(null);
  const [copyAsOpen, setCopyAsOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [rowHeight, setRowHeight] = useState(24);
  const [zoom, setZoom] = useState(100);
  const [clipboard, setClipboard] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function onDocClick() {
      setMenu(null);
      setCopyAsOpen(false);
      setZoomOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

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
      setSelectedRow(0);
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
    setShowFilter(false);
  }, [tab.id]);

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / Math.max(1, data.pageSize)))
    : 1;

  const sqlPreview = useMemo(() => {
    const db = database ? `\`${database}\`.` : "";
    const where =
      appliedFilter.col && appliedFilter.value
        ? ` WHERE \`${appliedFilter.col}\` LIKE '%${appliedFilter.value.replace(/'/g, "''")}%'`
        : "";
    const order = sortCol ? ` ORDER BY \`${sortCol}\` ${sortDir}` : "";
    const offset = (page - 1) * pageSize;
    return `SELECT * FROM ${db}\`${tab.table}\`${where}${order} LIMIT ${offset},${pageSize}`;
  }, [database, tab.table, appliedFilter, sortCol, sortDir, page, pageSize]);

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

  function addRow() {
    if (!data) return;
    const empty = data.columns.map(() => null);
    setRows((prev) => [
      ...prev,
      { key: `new-${Date.now()}`, values: empty, inserted: true },
    ]);
    setSelectedRow(rows.length);
  }

  function deleteSelected() {
    if (selectedRow < 0 || selectedRow >= rows.length) return;
    setRows((prev) =>
      prev
        .map((r, i) => (i === selectedRow ? { ...r, deleted: true } : r))
        .filter((r) => !(r.inserted && r.deleted)),
    );
  }

  function discard() {
    setRows(baseline.map((r) => ({ ...r, values: [...r.values] })));
    setError(null);
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

  async function copyText(text: string) {
    setClipboard(text);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  function currentRowValues(): unknown[] | null {
    if (!menu) return null;
    return rows[menu.rowIndex]?.values ?? null;
  }

  async function copyAs(
    kind:
      | "insert"
      | "update"
      | "tsv-data"
      | "tsv-headers"
      | "tsv-both"
      | "csv-data"
      | "csv-headers"
      | "csv-both"
      | "json",
  ) {
    if (!data || !menu) return;
    const values = currentRowValues();
    if (!values) return;
    const cols = data.columns.map((c) => c.name);
    let text = "";
    if (kind === "insert") {
      text = buildInsertSql(tab.table, cols, values);
    } else if (kind === "update") {
      const pk = pickPkColumn(data.columns);
      const pkIdx = cols.indexOf(pk);
      text = buildUpdateSql(tab.table, cols, values, pk, values[pkIdx]);
    } else if (kind === "tsv-data") text = buildTsvData(values);
    else if (kind === "tsv-headers") text = buildTsvHeaders(cols);
    else if (kind === "tsv-both") text = buildTsvHeadersAndData(cols, values);
    else if (kind === "csv-data") text = buildCsvData(values);
    else if (kind === "csv-headers") text = buildCsvHeaders(cols);
    else if (kind === "csv-both") text = buildCsvHeadersAndData(cols, values);
    else text = buildJsonRow(cols, values);
    await copyText(text);
    setMenu(null);
    setCopyAsOpen(false);
  }

  function pasteIntoCell() {
    if (!menu || !clipboard) return;
    updateCell(menu.rowIndex, menu.colIndex, clipboard);
    setMenu(null);
  }

  const visibleCount = rows.filter((r) => !r.deleted).length;
  const recordLabel =
    visibleCount === 0
      ? "无记录"
      : `记录 ${Math.min(selectedRow + 1, visibleCount)} / ${data?.total ?? visibleCount}`;

  return (
    <div className="data-grid navicat-grid" ref={rootRef}>
      <div className="dg-toolbar">
        <button type="button" className="dg-icon-btn" title="添加记录" onClick={addRow} disabled={!data}>
          <span className="dg-ico plus">+</span>
        </button>
        <button
          type="button"
          className="dg-icon-btn"
          title="删除记录"
          onClick={deleteSelected}
          disabled={!data || rows.length === 0}
        >
          <span className="dg-ico minus">−</span>
        </button>
        <span className="dg-sep" />
        <button
          type="button"
          className="dg-icon-btn is-ok"
          title="应用更改"
          disabled={!dirty || saving}
          onClick={() => void commit()}
        >
          ✓
        </button>
        <button
          type="button"
          className="dg-icon-btn is-danger"
          title="放弃更改"
          disabled={!dirty || saving}
          onClick={discard}
        >
          ✕
        </button>
        <span className="dg-sep" />
        <button
          type="button"
          className="dg-icon-btn"
          title="刷新"
          disabled={loading || dirty}
          onClick={() => void load()}
        >
          ↻
        </button>
        <button
          type="button"
          className={`dg-icon-btn ${showFilter ? "is-active" : ""}`}
          title="过滤"
          onClick={() => setShowFilter((v) => !v)}
        >
          ⚙︎
        </button>
        <span className="dg-sep" />
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
          className="dg-text-btn"
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
          Dump
        </button>
        <div className="dg-toolbar-spacer" />
        <span className="dg-title-chip">
          {tab.table}
          {dirty ? " · 未保存" : ""}
        </span>
      </div>

      {showFilter && (
        <div className="dg-filter-bar">
          <select value={filterCol} onChange={(e) => setFilterCol(e.target.value)}>
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
        </div>
      )}

      {error && <p className="pane-error">{error}</p>}
      {loading && !data && <p className="pane-placeholder">加载中…</p>}

      <div
        className="data-grid-scroll"
        style={{
          ["--dg-row-height" as string]: `${rowHeight}px`,
          zoom: `${zoom}%`,
        }}
      >
        <table>
          <thead>
            <tr>
              <th className="row-num-col">#</th>
              {(data?.columns ?? []).map((c) => (
                <th key={c.name}>
                  <button type="button" className="col-head-btn" onClick={() => toggleSort(c.name)}>
                    <span className="col-name">
                      {c.name}
                      {sortCol === c.name ? (sortDir === "ASC" ? " ↑" : " ↓") : ""}
                    </span>
                    <span className="col-type">{typeHint(c.dataType)}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={row.key}
                className={[
                  selectedRow === ri ? "is-selected" : "",
                  row.deleted ? "is-deleted" : "",
                  row.inserted ? "is-inserted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setSelectedRow(ri)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelectedRow(ri);
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    rowIndex: ri,
                    colIndex: 0,
                  });
                }}
              >
                <td className="row-num-col">{ri + 1}</td>
                {row.values.map((cell, ci) => (
                  <td
                    key={ci}
                    className={cell === null ? "is-null" : undefined}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSelectedRow(ri);
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        rowIndex: ri,
                        colIndex: ci,
                      });
                    }}
                  >
                    <input
                      className="cell-input"
                      disabled={!!row.deleted}
                      value={cellText(cell)}
                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                      onFocus={() => setSelectedRow(ri)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dg-sql-bar">
        <code title={sqlPreview}>{sqlPreview}</code>
        <div className="dg-pager">
          <button
            type="button"
            disabled={page <= 1 || loading || dirty}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading || dirty}
            onClick={() => setPage((p) => p + 1)}
          >
            ›
          </button>
        </div>
      </div>

      <div className="dg-status-bar">
        <span>{selectedRow >= 0 && rows[selectedRow] && !rows[selectedRow]?.deleted ? "已选 1 行" : "未选中"}</span>
        <span>{recordLabel}</span>
        <span>{loading ? "刷新中…" : saving ? "提交中…" : "就绪"}</span>
      </div>

      {menu && data && (
        <div
          className="dg-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              addRow();
              setMenu(null);
            }}
          >
            添加记录
          </button>
          <button
            type="button"
            onClick={() => {
              deleteSelected();
              setMenu(null);
            }}
          >
            删除记录
          </button>
          <div className="dg-menu-sep" />
          <button
            type="button"
            onClick={() => {
              void copyText(cellText(rows[menu.rowIndex]?.values[menu.colIndex]));
              setMenu(null);
            }}
          >
            复制
          </button>
          <button
            type="button"
            onClick={() => {
              void copyText(data.columns[menu.colIndex]?.name ?? "");
              setMenu(null);
            }}
          >
            复制字段名称
          </button>
          <div
            className={`dg-menu-item has-sub ${copyAsOpen ? "is-open" : ""}`}
            onMouseEnter={() => {
              setCopyAsOpen(true);
              setZoomOpen(false);
            }}
          >
            <button type="button" className="dg-menu-trigger">
              复制为<span className="dg-menu-arrow">›</span>
            </button>
            {copyAsOpen && (
              <div className="dg-submenu">
                <button type="button" onClick={() => void copyAs("insert")}>
                  Insert 语句
                </button>
                <button type="button" onClick={() => void copyAs("update")}>
                  Update 语句
                </button>
                <div className="dg-menu-sep" />
                <button type="button" onClick={() => void copyAs("tsv-data")}>
                  制表符分隔值（数据）
                </button>
                <button type="button" onClick={() => void copyAs("tsv-headers")}>
                  制表符分隔值（字段名称）
                </button>
                <button type="button" onClick={() => void copyAs("tsv-both")}>
                  制表符分隔值（字段名称和数据）
                </button>
                <div className="dg-menu-sep" />
                <button type="button" onClick={() => void copyAs("csv-data")}>
                  逗号分隔值（数据）
                </button>
                <button type="button" onClick={() => void copyAs("csv-headers")}>
                  逗号分隔值（字段名称）
                </button>
                <button type="button" onClick={() => void copyAs("csv-both")}>
                  逗号分隔值（字段名称和数据）
                </button>
                <div className="dg-menu-sep" />
                <button type="button" onClick={() => void copyAs("json")}>
                  JSON
                </button>
              </div>
            )}
          </div>
          <button type="button" onClick={pasteIntoCell} disabled={!clipboard}>
            粘贴
          </button>
          <div className="dg-menu-sep" />
          <button
            type="button"
            onClick={() => {
              const next = window.prompt("行高（像素）", String(rowHeight));
              if (!next) return;
              const n = Number(next);
              if (!Number.isNaN(n) && n >= 18 && n <= 64) setRowHeight(n);
              setMenu(null);
            }}
          >
            设置行高…
          </button>
          <div
            className={`dg-menu-item has-sub ${zoomOpen ? "is-open" : ""}`}
            onMouseEnter={() => {
              setZoomOpen(true);
              setCopyAsOpen(false);
            }}
          >
            <button type="button" className="dg-menu-trigger">
              缩放<span className="dg-menu-arrow">›</span>
            </button>
            {zoomOpen && (
              <div className="dg-submenu">
                {[75, 90, 100, 110, 125, 150].map((z) => (
                  <button
                    key={z}
                    type="button"
                    className={zoom === z ? "is-checked" : undefined}
                    onClick={() => {
                      setZoom(z);
                      setMenu(null);
                      setZoomOpen(false);
                    }}
                  >
                    {z}%
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
