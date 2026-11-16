import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  buildCsvData,
  buildCsvHeaders,
  buildInsertSql,
  buildJsonRow,
  buildTsvData,
  buildTsvHeaders,
  buildUpdateSql,
} from "../data-grid/copyAs";
import { useColumnResize } from "../data-grid/useColumnResize";
import { downloadTextFile } from "../import-export/csv";

export type QueryResultData = {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number;
  elapsedMs: number;
};

type Props = {
  result: QueryResultData;
  tableHint?: string;
  embedded?: boolean;
};

type MenuState = {
  x: number;
  y: number;
  rowIndex: number;
  colIndex: number;
};

type CopyAsKind =
  | "insert"
  | "update"
  | "tsv-data"
  | "tsv-headers"
  | "tsv-both"
  | "csv-data"
  | "csv-headers"
  | "csv-both"
  | "json";

const DEFAULT_COL_WIDTH = 140;
const MIN_COL_WIDTH = 60;
const MAX_AUTO_WIDTH = 420;
const CHECK_W = 28;
const ROWNUM_W = 44;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

function measureWidth(text: string, header: string): number {
  const sample = text.length > header.length ? text : header;
  const approx = Math.ceil(sample.length * 7.2 + 28);
  return Math.min(MAX_AUTO_WIDTH, Math.max(MIN_COL_WIDTH, approx));
}

export function QueryResultGrid({
  result,
  tableHint = "query_result",
  embedded = false,
}: Props) {
  const [view, setView] = useState<"data" | "info">("data");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set([0]));
  const [selectedCol, setSelectedCol] = useState(0);
  const [anchorRow, setAnchorRow] = useState(0);
  const [rowHeight, setRowHeight] = useState(24);
  const [zoom, setZoom] = useState(100);
  const [frozenUntil, setFrozenUntil] = useState<number>(-1);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [copyAsOpen, setCopyAsOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const columns = result.columns;
  const rows = result.rows;
  const resultKey = useMemo(
    () => `${columns.join("\0")}|${rows.length}|${result.elapsedMs}`,
    [columns, rows.length, result.elapsedMs],
  );
  const {
    widths: colWidths,
    setWidths: setColWidths,
    setWidth,
    startResize,
  } = useColumnResize({
    defaultWidth: DEFAULT_COL_WIDTH,
    minWidth: MIN_COL_WIDTH,
    resetKey: resultKey,
  });

  useEffect(() => {
    setSelectedRows(new Set(rows.length ? [0] : []));
    setSelectedCol(0);
    setAnchorRow(0);
    setView("data");
    setFrozenUntil(-1);
    setMenu(null);
  }, [result, rows.length]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".qr-context-menu")) return;
      setMenu(null);
      setCopyAsOpen(false);
      setZoomOpen(false);
    }
    // mousedown — avoid closing immediately after contextmenu (which also fires click)
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const widths = useMemo(() => {
    return columns.map((c) => colWidths[c] ?? DEFAULT_COL_WIDTH);
  }, [columns, colWidths]);

  const selectedList = useMemo(
    () => [...selectedRows].sort((a, b) => a - b),
    [selectedRows],
  );

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }

  function selectRow(ri: number, e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) {
    setSelectedCol(0);
    if (e.shiftKey) {
      const from = Math.min(anchorRow, ri);
      const to = Math.max(anchorRow, ri);
      const next = new Set<number>();
      for (let i = from; i <= to; i++) next.add(i);
      setSelectedRows(next);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (next.has(ri)) next.delete(ri);
        else next.add(ri);
        return next;
      });
      setAnchorRow(ri);
      return;
    }
    setSelectedRows(new Set([ri]));
    setAnchorRow(ri);
  }

  function toggleRowChecked(ri: number) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(ri)) next.delete(ri);
      else next.add(ri);
      return next;
    });
    setAnchorRow(ri);
  }

  function toggleSelectAll() {
    if (selectedRows.size === rows.length && rows.length > 0) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(rows.map((_, i) => i)));
    }
  }

  function fitColumn(colIndex: number) {
    const name = columns[colIndex];
    if (!name) return;
    let max = name.length;
    for (const row of rows.slice(0, 200)) {
      max = Math.max(max, cellText(row[colIndex]).length);
    }
    const w = measureWidth("x".repeat(max), name);
    setWidth(name, w);
  }

  function fitAllColumns() {
    const next: Record<string, number> = {};
    columns.forEach((name, colIndex) => {
      let max = name.length;
      for (const row of rows.slice(0, 200)) {
        max = Math.max(max, cellText(row[colIndex]).length);
      }
      next[name] = measureWidth("x".repeat(max), name);
    });
    setColWidths(next);
  }

  function setColumnWidth(colIndex: number) {
    const name = columns[colIndex];
    if (!name) return;
    const cur = colWidths[name] ?? DEFAULT_COL_WIDTH;
    const raw = window.prompt("列宽（像素）", String(cur));
    if (!raw) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < MIN_COL_WIDTH) return;
    setWidth(name, n);
  }

  function setAllColumnWidths() {
    const raw = window.prompt("所有列宽度（像素）", String(DEFAULT_COL_WIDTH));
    if (!raw) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < MIN_COL_WIDTH) return;
    const next: Record<string, number> = {};
    for (const c of columns) next[c] = Math.round(n);
    setColWidths(next);
  }

  function setRowHeightPrompt() {
    const raw = window.prompt("行高（像素）", String(rowHeight));
    if (!raw) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 18 || n > 120) return;
    setRowHeight(Math.round(n));
  }

  function targetRows(): number[] {
    if (selectedList.length > 0) return selectedList;
    if (menu) return [menu.rowIndex];
    return [];
  }

  async function copyAs(kind: CopyAsKind) {
    const idxs = targetRows();
    if (idxs.length === 0) return;
    const cols = columns;
    const picked = idxs.map((i) => rows[i]!).filter(Boolean);
    let text = "";

    switch (kind) {
      case "insert":
        text = picked.map((r) => buildInsertSql(tableHint, cols, r)).join("\n");
        break;
      case "update":
        text = picked
          .map((r) => buildUpdateSql(tableHint, cols, r, cols[0] ?? "id", r[0]))
          .join("\n");
        break;
      case "tsv-data":
        text = picked.map((r) => buildTsvData(r)).join("\n");
        break;
      case "tsv-headers":
        text = buildTsvHeaders(cols);
        break;
      case "tsv-both":
        text = [
          buildTsvHeaders(cols),
          ...picked.map((r) => buildTsvData(r)),
        ].join("\n");
        break;
      case "csv-data":
        text = picked.map((r) => buildCsvData(r)).join("\n");
        break;
      case "csv-headers":
        text = buildCsvHeaders(cols);
        break;
      case "csv-both":
        text = [
          buildCsvHeaders(cols),
          ...picked.map((r) => buildCsvData(r)),
        ].join("\n");
        break;
      case "json":
        text =
          picked.length === 1
            ? buildJsonRow(cols, picked[0]!)
            : JSON.stringify(
                picked.map((r) => {
                  const obj: Record<string, unknown> = {};
                  cols.forEach((c, i) => {
                    obj[c] = r[i] ?? null;
                  });
                  return obj;
                }),
                null,
                2,
              );
        break;
    }
    await copyText(text);
    showToast(
      idxs.length > 1 ? `已复制 ${idxs.length} 行` : "已复制到剪贴板",
    );
    setMenu(null);
  }

  function exportCsv() {
    const lines = [
      buildCsvHeaders(columns),
      ...rows.map((r) => buildCsvData(r)),
    ];
    downloadTextFile(
      `${tableHint}-result.csv`,
      lines.join("\n"),
      "text/csv;charset=utf-8",
    );
    showToast("已导出 CSV");
  }

  function openMenu(e: ReactMouseEvent, ri: number, ci: number) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedRows.has(ri)) {
      setSelectedRows(new Set([ri]));
      setAnchorRow(ri);
    }
    setSelectedCol(ci);
    setCopyAsOpen(false);
    setZoomOpen(false);
    setMenu({ x: e.clientX, y: e.clientY, rowIndex: ri, colIndex: ci });
  }

  function frozenOffset(colIndex: number): number | undefined {
    if (colIndex > frozenUntil) return undefined;
    let left = CHECK_W + ROWNUM_W;
    for (let i = 0; i < colIndex; i++) left += widths[i] ?? DEFAULT_COL_WIDTH;
    return left;
  }

  const allSelected = rows.length > 0 && selectedRows.size === rows.length;

  return (
    <div className={`qr-panel ${embedded ? "is-embedded" : ""}`}>
      {!embedded && (
        <div className="qr-tabs">
          <div className="qr-tabs-left">
            <button type="button" className="qr-result-tab is-active">
              结果
            </button>
            <span className="qr-tabs-meta">
              {`${rows.length} 行 · ${result.elapsedMs} ms · 影响 ${result.rowsAffected}`}
              {selectedRows.size > 0 ? ` · 已选 ${selectedRows.size}` : ""}
            </span>
          </div>
          <div className="qr-tabs-right">
            <button
              type="button"
              className="qr-tool-btn"
              title="导出 CSV"
              onClick={exportCsv}
            >
              ⇩
            </button>
            <button
              type="button"
              className="qr-tool-btn"
              title="适应所有列宽"
              onClick={fitAllColumns}
            >
              ⟷
            </button>
          </div>
        </div>
      )}

      <div className="qr-subtabs">
        <button
          type="button"
          className={view === "data" ? "is-active" : ""}
          onClick={() => setView("data")}
        >
          数据
        </button>
        <button
          type="button"
          className={view === "info" ? "is-active" : ""}
          onClick={() => setView("info")}
        >
          信息
        </button>
        {embedded && (
          <div className="qr-subtabs-tools">
            <span className="qr-sel-hint">
              {selectedRows.size > 0 ? `已选 ${selectedRows.size} 行` : ""}
            </span>
            <button
              type="button"
              className="qr-tool-btn"
              title="导出 CSV"
              onClick={exportCsv}
            >
              ⇩
            </button>
            <button
              type="button"
              className="qr-tool-btn"
              title="适应所有列宽"
              onClick={fitAllColumns}
            >
              ⟷
            </button>
          </div>
        )}
      </div>

      {view === "info" ? (
        <div className="qr-info">
          <dl>
            <div>
              <dt>行数</dt>
              <dd>{rows.length}</dd>
            </div>
            <div>
              <dt>影响行数</dt>
              <dd>{result.rowsAffected}</dd>
            </div>
            <div>
              <dt>耗时</dt>
              <dd>{result.elapsedMs} ms</dd>
            </div>
            <div>
              <dt>列数</dt>
              <dd>{columns.length}</dd>
            </div>
            <div>
              <dt>列名</dt>
              <dd>{columns.join(", ") || "—"}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="qr-grid-scroll"
          onContextMenu={(e) => e.preventDefault()}
        >
          <table
            className="qr-grid"
            style={{
              ["--qr-row-h" as string]: `${rowHeight}px`,
              zoom: `${zoom}%`,
            }}
          >
            <thead>
              <tr>
                <th className="qr-check-h sticky-left sticky-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="全选"
                  />
                </th>
                <th className="qr-rownum-h sticky-left sticky-rownum">#</th>
                {columns.map((c, ci) => {
                  const left = frozenOffset(ci);
                  return (
                    <th
                      key={c}
                      className={left != null ? "is-frozen" : ""}
                      style={{
                        width: widths[ci],
                        minWidth: widths[ci],
                        maxWidth: widths[ci],
                        left: left != null ? left : undefined,
                      }}
                      title={c}
                    >
                      {c}
                      <span
                        className="col-resize-handle"
                        onMouseDown={(e) => startResize(c, e)}
                        title="拖拽调整列宽"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const rowSelected = selectedRows.has(ri);
                return (
                  <tr
                    key={ri}
                    className={`${ri % 2 ? "is-alt" : ""} ${rowSelected ? "is-selected" : ""}`}
                    onClick={(e) => selectRow(ri, e)}
                    onContextMenu={(e) => openMenu(e, ri, selectedCol)}
                  >
                    <td
                      className="qr-check sticky-left sticky-check"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={rowSelected}
                        onChange={() => toggleRowChecked(ri)}
                        aria-label={`选择第 ${ri + 1} 行`}
                      />
                    </td>
                    <td className="qr-rownum sticky-left sticky-rownum">
                      {ri + 1}
                    </td>
                    {row.map((cell, ci) => {
                      const left = frozenOffset(ci);
                      const cellSelected =
                        rowSelected &&
                        selectedRows.size === 1 &&
                        ci === selectedCol;
                      return (
                        <td
                          key={ci}
                          className={`${left != null ? "is-frozen" : ""} ${cellSelected ? "is-cell-selected" : ""}`}
                          style={{
                            width: widths[ci],
                            minWidth: widths[ci],
                            maxWidth: widths[ci],
                            left: left != null ? left : undefined,
                          }}
                          title={cellText(cell)}
                          onClick={(e) => {
                            e.stopPropagation();
                            selectRow(ri, e);
                            setSelectedCol(ci);
                          }}
                          onContextMenu={(e) => openMenu(e, ri, ci)}
                        >
                          <span className={cell === null ? "is-null" : ""}>
                            {cellText(cell)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    className="qr-empty"
                    colSpan={Math.max(columns.length + 2, 1)}
                  >
                    （无行）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {toast && <div className="qr-toast">{toast}</div>}

      {menu && (
        <div
          className="dg-context-menu qr-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={() => {
              void copyText(columns[menu.colIndex] ?? "");
              showToast("已复制字段名称");
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
              复制为
              <span className="dg-menu-arrow">›</span>
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
          <div className="dg-menu-sep" />
          <button
            type="button"
            onClick={() => {
              fitColumn(menu.colIndex);
              setMenu(null);
            }}
          >
            调整列宽以适应内容
          </button>
          <button
            type="button"
            onClick={() => {
              fitAllColumns();
              setMenu(null);
            }}
          >
            调整所有列的适合大小
          </button>
          <button
            type="button"
            onClick={() => {
              setColumnWidth(menu.colIndex);
              setMenu(null);
            }}
          >
            设置列宽…
          </button>
          <button
            type="button"
            onClick={() => {
              setAllColumnWidths();
              setMenu(null);
            }}
          >
            设置所有列宽度…
          </button>
          <button
            type="button"
            onClick={() => {
              setRowHeightPrompt();
              setMenu(null);
            }}
          >
            设置行高…
          </button>
          <div className="dg-menu-sep" />
          <button
            type="button"
            onClick={() => {
              setFrozenUntil(menu.colIndex);
              setMenu(null);
            }}
          >
            冻结列
          </button>
          <button
            type="button"
            onClick={() => {
              setFrozenUntil(-1);
              setMenu(null);
            }}
          >
            解除所有冻结列
          </button>
          <div
            className={`dg-menu-item has-sub ${zoomOpen ? "is-open" : ""}`}
            onMouseEnter={() => {
              setZoomOpen(true);
              setCopyAsOpen(false);
            }}
          >
            <button type="button" className="dg-menu-trigger">
              缩放
              <span className="dg-menu-arrow">›</span>
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
