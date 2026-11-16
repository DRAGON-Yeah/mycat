import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyRowChanges,
  dumpTableSql,
  executeSql,
  fetchTablePage,
  openConnection,
  writeLog,
  type RowChange,
  type RowsPage,
} from "../connections/sessionApi";
import { ExportCsvButton } from "../import-export/ExportCsvButton";
import { ImportCsvButton } from "../import-export/ImportCsvButton";
import { downloadTextFile } from "../import-export/csv";
import type { TableTab } from "../../stores/workspaceStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { CellEditorHost, needsChooser } from "./CellEditorHost";
import {
  classifyEditor,
  extrasFromShowColumns,
  formatDateOnly,
  formatDateTime,
  type ColumnExtra,
  type EditorKind,
} from "./columnEditors";
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

function cellDisplayText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function cellCopyText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

/** Empty input → SQL NULL when column is nullable (Navicat-like). */
function parseCellInput(raw: string, nullable: boolean): unknown {
  if (raw === "") return nullable ? null : "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (
    raw.trim() !== "" &&
    !Number.isNaN(Number(raw)) &&
    /^-?\d+(\.\d+)?$/.test(raw.trim())
  ) {
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
  const [pageSize, setPageSize] = useState(tab.openOptions?.pageSize ?? 1000);
  const [sortCol, setSortCol] = useState<string | undefined>(
    tab.openOptions?.sortCol,
  );
  const [sortDir, setSortDir] = useState<"ASC" | "DESC">(
    tab.openOptions?.sortDir ?? "ASC",
  );
  const [filterCol, setFilterCol] = useState(tab.openOptions?.filterCol ?? "");
  const [filterValue, setFilterValue] = useState(
    tab.openOptions?.filterValue ?? "",
  );
  const [showFilter, setShowFilter] = useState(
    Boolean(tab.openOptions?.filterCol || tab.openOptions?.filterValue),
  );
  const [appliedFilter, setAppliedFilter] = useState<{
    col?: string;
    value?: string;
  }>({
    col: tab.openOptions?.filterCol,
    value: tab.openOptions?.filterValue,
  });
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
  const [editing, setEditing] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSnapshot, setEditSnapshot] = useState<unknown>(null);
  const [columnExtras, setColumnExtras] = useState<
    Record<string, ColumnExtra>
  >({});
  const [chooser, setChooser] = useState<{
    row: number;
    col: number;
    kind: EditorKind;
  } | null>(null);
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

  const loadColumnExtras = useCallback(async () => {
    try {
      await openConnection(tab.connectionId);
      const engine = String(tab.connectionEngine || "mysql").toLowerCase();
      const db = (database || "").replace(/`/g, "``");
      const table = tab.table.replace(/`/g, "``");
      let sql = "";
      if (engine === "postgres" || engine === "postgresql") {
        sql = `SELECT column_name AS "Field", udt_name AS "Type", is_nullable AS "Null"
FROM information_schema.columns
WHERE table_name = '${tab.table.replace(/'/g, "''")}'
ORDER BY ordinal_position`;
      } else if (engine === "sqlite") {
        sql = `PRAGMA table_info(\`${table}\`)`;
      } else {
        sql = db
          ? `SHOW FULL COLUMNS FROM \`${db}\`.\`${table}\``
          : `SHOW FULL COLUMNS FROM \`${table}\``;
      }
      const out = await executeSql(tab.connectionId, sql);
      if (engine === "sqlite") {
        // PRAGMA: cid, name, type, notnull, dflt_value, pk
        const map: Record<string, ColumnExtra> = {};
        for (const row of out.rows) {
          const name = String(row[1] ?? "");
          const rawType = String(row[2] ?? "");
          const notnull = Number(row[3] ?? 0) === 1;
          if (!name) continue;
          map[name] = { rawType, nullable: !notnull, enumValues: [] };
        }
        setColumnExtras(map);
        return;
      }
      setColumnExtras(extrasFromShowColumns(out.columns, out.rows));
    } catch {
      setColumnExtras({});
    }
  }, [tab.connectionId, tab.connectionEngine, tab.table, database]);

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
        database: database || undefined,
      });
      setData(result);
      const mapped: GridRow[] = result.rows.map((values, idx) => ({
        key: `r-${page}-${idx}`,
        values: [...values],
      }));
      setRows(mapped);
      setBaseline(mapped.map((r) => ({ ...r, values: [...r.values] })));
      setSelectedRow(0);
      void loadColumnExtras();
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
    database,
    page,
    pageSize,
    sortCol,
    sortDir,
    appliedFilter.col,
    appliedFilter.value,
    loadColumnExtras,
  ]);

  useEffect(() => {
    const opt = tab.openOptions;
    if (!opt) return;
    setPage(1);
    if (opt.pageSize) setPageSize(opt.pageSize);
    setSortCol(opt.sortCol);
    setSortDir(opt.sortDir ?? "ASC");
    setFilterCol(opt.filterCol ?? "");
    setFilterValue(opt.filterValue ?? "");
    setShowFilter(Boolean(opt.filterCol || opt.filterValue));
    setAppliedFilter({ col: opt.filterCol, value: opt.filterValue });
  }, [tab.id, tab.openOptions]);

  function editorKindForCol(colIndex: number): EditorKind {
    const col = data?.columns[colIndex];
    if (!col) return "text";
    return classifyEditor(col.dataType, columnExtras[col.name]);
  }

  function openCellEditor(rowIndex: number, colIndex: number, cell: unknown) {
    setSelectedRow(rowIndex);
    const col = data?.columns[colIndex];
    const extra = col ? columnExtras[col.name] : undefined;
    const kind = editorKindForCol(colIndex);
    if (needsChooser(kind, extra)) {
      setChooser({ row: rowIndex, col: colIndex, kind });
      setEditing(null);
      return;
    }
    beginEdit(rowIndex, colIndex, cell);
  }

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

  function updateCellValue(rowIndex: number, colIndex: number, value: unknown) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIndex || r.deleted) return r;
        const values = [...r.values];
        values[colIndex] = value;
        return { ...r, values };
      }),
    );
  }

  function updateCell(rowIndex: number, colIndex: number, raw: string) {
    const col = data?.columns[colIndex];
    const extra = col ? columnExtras[col.name] : undefined;
    const nullable = extra?.nullable ?? col?.nullable ?? true;
    updateCellValue(rowIndex, colIndex, parseCellInput(raw, nullable));
  }

  function setCellNull(rowIndex: number, colIndex: number) {
    updateCellValue(rowIndex, colIndex, null);
  }

  function beginEdit(rowIndex: number, colIndex: number, cell: unknown) {
    setSelectedRow(rowIndex);
    setEditing({ row: rowIndex, col: colIndex });
    setEditSnapshot(cell);
    setEditDraft(isNullish(cell) ? "" : cellDisplayText(cell));
  }

  function commitEdit() {
    if (!editing) return;
    updateCell(editing.row, editing.col, editDraft);
    setEditing(null);
  }

  function cancelEdit() {
    if (!editing) return;
    updateCellValue(editing.row, editing.col, editSnapshot);
    setEditing(null);
    setEditDraft("");
  }

  function addRow() {
    if (!data) return;
    const empty = data.columns.map((c) => {
      const extra = columnExtras[c.name];
      const kind = classifyEditor(c.dataType, extra);
      const nullable = extra?.nullable ?? c.nullable ?? true;
      if (!nullable) {
        if (kind === "datetime") return formatDateTime(new Date());
        if (kind === "date") return formatDateOnly(new Date());
        if (kind === "bool") return 0;
        if (kind === "number") return 0;
        if (kind === "enum" && extra?.enumValues?.[0]) return extra.enumValues[0];
        return "";
      }
      return null;
    });
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
        database: database || undefined,
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
    setEditing(null);
    setMenu(null);
  }

  const totalRecords = data?.total ?? 0;
  const canPage = !loading && !dirty;

  const visibleCount = rows.filter((r) => !r.deleted).length;
  const recordLabel =
    visibleCount === 0
      ? "无记录"
      : `记录 ${Math.min(selectedRow + 1, visibleCount)} / ${data?.total ?? visibleCount}`;

  return (
    <div className="data-grid navicat-grid" ref={rootRef}>
      <div className="dg-toolbar">
        <ExportCsvButton
          connectionId={tab.connectionId}
          table={tab.table}
          database={database || undefined}
        />
        {data && (
          <ImportCsvButton
            connectionId={tab.connectionId}
            table={tab.table}
            tableColumns={data.columns.map((c) => c.name)}
            database={database || undefined}
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
                database: database || undefined,
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
                {row.values.map((cell, ci) => {
                  const isEditing =
                    editing?.row === ri && editing?.col === ci;
                  const nullCell = isNullish(cell);
                  const colMeta = data?.columns[ci];
                  const extra = colMeta
                    ? columnExtras[colMeta.name]
                    : undefined;
                  const kind = editorKindForCol(ci);
                  const chooserCol = needsChooser(kind, extra);
                  return (
                    <td
                      key={ci}
                      className={[
                        nullCell && !isEditing ? "is-null" : "",
                        chooserCol ? "is-chooser" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined}
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
                      {chooserCol ? (
                        <button
                          type="button"
                          className={`cell-input cell-chooser-btn ${
                            nullCell ? "is-null-ph" : ""
                          }`}
                          disabled={!!row.deleted}
                          title={
                            kind === "datetime" || kind === "date" || kind === "time"
                              ? "点击选择日期/时间"
                              : kind === "enum"
                                ? "点击选择枚举值"
                                : "点击选择"
                          }
                          onClick={() => openCellEditor(ri, ci, cell)}
                        >
                          {nullCell ? (
                            <span className="cell-null-label">NULL</span>
                          ) : (
                            cellDisplayText(cell)
                          )}
                        </button>
                      ) : (
                        <input
                          className={`cell-input ${
                            nullCell && !isEditing ? "is-null-ph" : ""
                          }`}
                          disabled={!!row.deleted}
                          value={
                            isEditing
                              ? editDraft
                              : nullCell
                                ? ""
                                : cellDisplayText(cell)
                          }
                          placeholder={
                            nullCell && !isEditing ? "NULL" : undefined
                          }
                          onChange={(e) => {
                            setEditDraft(e.target.value);
                            updateCell(ri, ci, e.target.value);
                          }}
                          onFocus={() => beginEdit(ri, ci, cell)}
                          onBlur={() => commitEdit()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelEdit();
                            }
                          }}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dg-footer-bar" aria-label="表数据工具栏">
        <div className="dg-footer-left">
          <button
            type="button"
            className="dg-icon-btn"
            title="添加记录"
            onClick={addRow}
            disabled={!data}
          >
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
            title={dirty ? "请先应用或放弃更改后再刷新" : "刷新"}
            disabled={!canPage}
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
            ⌕
          </button>
        </div>

        <code className="dg-footer-sql" title={sqlPreview}>
          {sqlPreview}
        </code>

        <div className="dg-footer-right">
          <div className="dg-pager">
            <button
              type="button"
              title="首页"
              disabled={page <= 1 || !canPage}
              onClick={() => setPage(1)}
            >
              «
            </button>
            <button
              type="button"
              title="上一页"
              disabled={page <= 1 || !canPage}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹
            </button>
            <span className="dg-page-indicator" title={`共 ${totalRecords} 行`}>
              {page}/{totalPages}
            </span>
            <button
              type="button"
              title="下一页"
              disabled={page >= totalPages || !canPage}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              ›
            </button>
            <button
              type="button"
              title="末页"
              disabled={page >= totalPages || !canPage}
              onClick={() => setPage(totalPages)}
            >
              »
            </button>
          </div>
          <select
            className="dg-page-size"
            value={pageSize}
            title="每页行数"
            disabled={!canPage}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
          <span className="dg-footer-meta">
            {selectedRow >= 0 && rows[selectedRow] && !rows[selectedRow]?.deleted
              ? "已选 1 行"
              : "未选中"}
            {" · "}
            {recordLabel}
            {" · "}
            {loading ? "刷新中…" : saving ? "提交中…" : "就绪"}
          </span>
        </div>
      </div>

      {chooser && data && (
        <CellEditorHost
          kind={chooser.kind}
          value={rows[chooser.row]?.values[chooser.col]}
          nullable={
            columnExtras[data.columns[chooser.col]?.name ?? ""]?.nullable ??
            data.columns[chooser.col]?.nullable ??
            true
          }
          enumValues={
            columnExtras[data.columns[chooser.col]?.name ?? ""]?.enumValues
          }
          onCommit={(v) => {
            updateCellValue(chooser.row, chooser.col, v);
            setChooser(null);
          }}
          onCancel={() => setChooser(null)}
        />
      )}

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
              void copyText(
                cellCopyText(rows[menu.rowIndex]?.values[menu.colIndex]),
              );
              setMenu(null);
            }}
          >
            复制
          </button>
          <button
            type="button"
            onClick={() => {
              setCellNull(menu.rowIndex, menu.colIndex);
              setEditing(null);
              setMenu(null);
            }}
          >
            设为 NULL
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
