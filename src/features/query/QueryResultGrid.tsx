import { useEffect, useMemo, useRef, useState } from "react";
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
} from "../data-grid/copyAs";
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
  /** When embedded in QueryResultPanel, hide duplicate chrome. */
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
  const [selectedRow, setSelectedRow] = useState(0);
  const [selectedCol, setSelectedCol] = useState(0);
  const [rowHeight, setRowHeight] = useState(24);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [frozenUntil, setFrozenUntil] = useState<number>(-1); // inclusive col index
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [copyAsOpen, setCopyAsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const columns = result.columns;
  const rows = result.rows;

  useEffect(() => {
    setSelectedRow(0);
    setSelectedCol(0);
    setView("data");
    setColWidths({});
    setFrozenUntil(-1);
    setMenu(null);
  }, [result]);

  useEffect(() => {
    function onDoc() {
      setMenu(null);
      setCopyAsOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const widths = useMemo(() => {
    return columns.map((c) => colWidths[c] ?? DEFAULT_COL_WIDTH);
  }, [columns, colWidths]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }

  function fitColumn(colIndex: number) {
    const name = columns[colIndex];
    if (!name) return;
    let max = name.length;
    for (const row of rows.slice(0, 200)) {
      max = Math.max(max, cellText(row[colIndex]).length);
    }
    const w = measureWidth("x".repeat(max), name);
    setColWidths((prev) => ({ ...prev, [name]: w }));
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
    setColWidths((prev) => ({ ...prev, [name]: Math.round(n) }));
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

  async function copyAs(kind: CopyAsKind) {
    if (!menu) return;
    const row = rows[menu.rowIndex];
    if (!row) return;
    const cols = columns;
    let text = "";
    switch (kind) {
      case "insert":
        text = buildInsertSql(tableHint, cols, row);
        break;
      case "update":
        text = buildUpdateSql(tableHint, cols, row, cols[0] ?? "id", row[0]);
        break;
      case "tsv-data":
        text = buildTsvData(row);
        break;
      case "tsv-headers":
        text = buildTsvHeaders(cols);
        break;
      case "tsv-both":
        text = buildTsvHeadersAndData(cols, row);
        break;
      case "csv-data":
        text = buildCsvData(row);
        break;
      case "csv-headers":
        text = buildCsvHeaders(cols);
        break;
      case "csv-both":
        text = buildCsvHeadersAndData(cols, row);
        break;
      case "json":
        text = buildJsonRow(cols, row);
        break;
    }
    await copyText(text);
    showToast("已复制到剪贴板");
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

  function frozenOffset(colIndex: number): number | undefined {
    if (colIndex > frozenUntil) return undefined;
    // row# col ~ 44px
    let left = 44;
    for (let i = 0; i < colIndex; i++) left += widths[i] ?? DEFAULT_COL_WIDTH;
    return left;
  }

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
          <table className="qr-grid" style={{ ["--qr-row-h" as string]: `${rowHeight}px` }}>
            <thead>
              <tr>
                <th className="qr-rownum-h sticky-left">#</th>
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
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={`${ri % 2 ? "is-alt" : ""} ${ri === selectedRow ? "is-selected" : ""}`}
                  onClick={() => setSelectedRow(ri)}
                >
                  <td className="qr-rownum sticky-left">{ri + 1}</td>
                  {row.map((cell, ci) => {
                    const left = frozenOffset(ci);
                    const selected = ri === selectedRow && ci === selectedCol;
                    return (
                      <td
                        key={ci}
                        className={`${left != null ? "is-frozen" : ""} ${selected ? "is-cell-selected" : ""}`}
                        style={{
                          width: widths[ci],
                          minWidth: widths[ci],
                          maxWidth: widths[ci],
                          left: left != null ? left : undefined,
                        }}
                        title={cellText(cell)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedRow(ri);
                          setSelectedCol(ci);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedRow(ri);
                          setSelectedCol(ci);
                          setCopyAsOpen(false);
                          setMenu({
                            x: e.clientX,
                            y: e.clientY,
                            rowIndex: ri,
                            colIndex: ci,
                          });
                        }}
                      >
                        <span className={cell === null ? "is-null" : ""}>
                          {cellText(cell)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    className="qr-empty"
                    colSpan={Math.max(columns.length + 1, 1)}
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
            onMouseEnter={() => setCopyAsOpen(true)}
            onMouseLeave={() => setCopyAsOpen(false)}
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
        </div>
      )}
    </div>
  );
}
