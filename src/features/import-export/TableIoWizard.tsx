import { useEffect, useMemo, useState } from "react";
import {
  exportTableCsv,
  importTableCsv,
} from "../nav-tree/tableMenuActions";
import {
  exportMaskedCsv,
  previewMaskedRows,
} from "../nav-tree/tableDataTools";
import { fetchTablePage, openConnection } from "../connections/sessionApi";
import { isSaveCancelled, parseCsv, stripBom } from "./csv";

type Props = {
  mode: "import" | "export" | "mask";
  connectionId: string;
  database: string;
  table: string;
  engine?: string;
  onClose: () => void;
  onDone: (msg: string) => void;
};

export function TableIoWizard({
  mode,
  connectionId,
  database,
  table,
  engine = "mysql",
  onClose,
  onDone,
}: Props) {
  const [step, setStep] = useState(mode === "mask" || mode === "export" ? 2 : 1);
  const [busy, setBusy] = useState(false);
  const [loadingCols, setLoadingCols] = useState(
    mode === "mask" || mode === "export",
  );
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [exportCols, setExportCols] = useState<string[]>([]);
  const [bom, setBom] = useState(true);
  const [maskCols, setMaskCols] = useState<string[]>([]);
  const [maskMode, setMaskMode] = useState<"stars" | "hash">("stars");
  const [maskFileName, setMaskFileName] = useState(`${table}-masked`);
  const [maskPreview, setMaskPreview] = useState<{
    columns: string[];
    rows: unknown[][];
  } | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [truncateFirst, setTruncateFirst] = useState(false);

  const mappedCount = useMemo(
    () => Object.values(columnMap).filter(Boolean).length,
    [columnMap],
  );

  useEffect(() => {
    if (mode !== "mask" && mode !== "export") return;
    let cancelled = false;
    void (async () => {
      setLoadingCols(true);
      setError(null);
      try {
        await openConnection(connectionId);
        const page = await fetchTablePage({
          connectionId,
          table,
          page: 1,
          pageSize: 1,
          database,
        });
        if (cancelled) return;
        const cols = page.columns.map((c) => c.name);
        setColumns(cols);
        setExportCols(cols);
        // 脱敏默认勾选常见敏感列名
        if (mode === "mask") {
          const guessed = cols.filter((c) =>
            /name|email|phone|mobile|tel|address|id_card|passwd|password|secret/i.test(
              c,
            ),
          );
          setMaskCols(guessed.length ? guessed : []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoadingCols(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, connectionId, database, table]);

  async function loadCols() {
    setBusy(true);
    setError(null);
    try {
      await openConnection(connectionId);
      const page = await fetchTablePage({
        connectionId,
        table,
        page: 1,
        pageSize: 1,
        database,
      });
      const cols = page.columns.map((c) => c.name);
      setColumns(cols);
      setExportCols(cols);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPickCsv(file: File) {
    setBusy(true);
    setError(null);
    try {
      const text = stripBom(await file.text());
      const parsed = parseCsv(text);
      const headers = parsed.columns.map((c) => c.trim());
      setCsvFile(file);
      setCsvHeaders(headers);
      setCsvPreview(parsed.rows.slice(0, 5));
      const map: Record<string, string> = {};
      for (const h of headers) {
        map[h] = columns.includes(h) ? h : "";
      }
      setColumnMap(map);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleMaskCol(col: string, checked: boolean) {
    setMaskCols((prev) =>
      checked ? [...prev, col] : prev.filter((x) => x !== col),
    );
    setMaskPreview(null);
  }

  async function doPreview() {
    setBusy(true);
    setError(null);
    try {
      const preview = await previewMaskedRows({
        connectionId,
        database,
        table,
        maskColumns: maskCols,
        mode: maskMode,
        limit: 8,
      });
      setMaskPreview(preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function doExportMasked() {
    setBusy(true);
    setError(null);
    try {
      const r = await exportMaskedCsv({
        connectionId,
        database,
        table,
        maskColumns: maskCols,
        mode: maskMode,
        fileName: maskFileName.trim(),
        bom,
      });
      onDone(`已导出脱敏 CSV（${r.count} 行）`);
      onClose();
    } catch (err) {
      if (isSaveCancelled(err)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "import"
      ? "导入向导"
      : mode === "mask"
        ? "数据脱敏导出"
        : "导出向导";

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`modal table-io-wizard ${
          mode === "mask" ? "table-io-wizard--mask" : ""
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="table-io-header">
          <div>
            <h2>{title}</h2>
            <p className="table-io-meta">
              {database} · {table}
            </p>
          </div>
          <button
            type="button"
            className="table-io-close"
            disabled={busy}
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {error && <p className="pane-error">{error}</p>}

        {step === 1 && (
          <>
            <p className="table-io-hint">
              {mode === "import"
                ? "将从 CSV 导入到当前表。确认目标后继续。"
                : "将导出当前表为 CSV。确认源表后继续。"}
            </p>
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy}
                onClick={() => void loadCols()}
              >
                {busy ? "…" : "下一步"}
              </button>
            </div>
          </>
        )}

        {step === 2 && mode === "import" && (
          <>
            <p className="table-io-hint">表列（选择 CSV 后可映射）：</p>
            <ul className="table-io-cols">
              {columns.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setStep(1)}>
                上一步
              </button>
              <label
                className={`ghost-btn file-btn ${busy ? "is-disabled" : ""}`}
              >
                {busy ? "读取中…" : "选择 CSV"}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void onPickCsv(file);
                  }}
                />
              </label>
            </div>
          </>
        )}

        {step === 3 && mode === "import" && (
          <>
            <p className="table-io-hint">列映射（CSV → 表列）与预览：</p>
            <div className="table-io-map">
              {csvHeaders.map((h) => (
                <label key={h} className="table-io-field">
                  <span>{h}</span>
                  <select
                    value={columnMap[h] ?? ""}
                    onChange={(e) =>
                      setColumnMap((prev) => ({
                        ...prev,
                        [h]: e.target.value,
                      }))
                    }
                  >
                    <option value="">（跳过）</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label className="modal-check">
              <input
                type="checkbox"
                checked={truncateFirst}
                onChange={(e) => setTruncateFirst(e.target.checked)}
              />
              <span>导入前清空表（TRUNCATE）</span>
            </label>
            {csvPreview.length > 0 && (
              <div className="table-io-preview">
                <table>
                  <thead>
                    <tr>
                      {csvHeaders.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.map((row, i) => (
                      <tr key={i}>
                        {csvHeaders.map((_, j) => (
                          <td key={j}>{row[j] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setStep(2)}>
                上一步
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy || !csvFile || mappedCount === 0}
                onClick={() =>
                  void (async () => {
                    if (!csvFile) return;
                    setBusy(true);
                    setError(null);
                    try {
                      const r = await importTableCsv({
                        connectionId,
                        table,
                        database,
                        file: csvFile,
                        columnMap,
                        truncateFirst,
                        engine,
                      });
                      onDone(`导入完成：成功 ${r.ok}，失败 ${r.failed}`);
                      onClose();
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                {busy ? "导入中…" : "开始导入"}
              </button>
            </div>
          </>
        )}

        {step === 2 && mode === "export" && (
          <>
            {loadingCols ? (
              <p className="table-io-hint">正在加载列…</p>
            ) : (
              <>
                <div className="table-io-section-head">
                  <span>导出列</span>
                  <span className="table-io-section-actions">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setExportCols(columns)}
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setExportCols([])}
                    >
                      清空
                    </button>
                  </span>
                </div>
                <div className="table-io-col-list">
                  {columns.map((c) => (
                    <label key={c} className="modal-check">
                      <input
                        type="checkbox"
                        checked={exportCols.includes(c)}
                        onChange={(e) => {
                          setExportCols((prev) =>
                            e.target.checked
                              ? [...prev, c]
                              : prev.filter((x) => x !== c),
                          );
                        }}
                      />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>
                <label className="modal-check">
                  <input
                    type="checkbox"
                    checked={bom}
                    onChange={(e) => setBom(e.target.checked)}
                  />
                  <span>UTF-8 BOM（Excel 友好）</span>
                </label>
              </>
            )}
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={busy || loadingCols || exportCols.length === 0}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const n = await exportTableCsv({
                        connectionId,
                        table,
                        database,
                        columns: exportCols,
                        bom,
                      });
                      onDone(`已导出 ${n} 行 CSV（${exportCols.length} 列）`);
                      onClose();
                    } catch (err) {
                      if (isSaveCancelled(err)) return;
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                {busy ? "导出中…" : "导出 CSV"}
              </button>
            </div>
          </>
        )}

        {step === 2 && mode === "mask" && (
          <>
            {loadingCols ? (
              <p className="table-io-hint">正在加载列…</p>
            ) : (
              <>
                <div className="table-io-section-head">
                  <span>
                    脱敏列
                    <em className="table-io-count">
                      已选 {maskCols.length}/{columns.length}
                    </em>
                  </span>
                  <span className="table-io-section-actions">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setMaskCols(columns);
                        setMaskPreview(null);
                      }}
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setMaskCols([]);
                        setMaskPreview(null);
                      }}
                    >
                      清空
                    </button>
                  </span>
                </div>
                <div className="table-io-col-list">
                  {columns.map((c) => (
                    <label
                      key={c}
                      className={`table-io-col-chip ${
                        maskCols.includes(c) ? "is-on" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={maskCols.includes(c)}
                        onChange={(e) => toggleMaskCol(c, e.target.checked)}
                      />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>

                <div className="table-io-form-row">
                  <label className="table-io-field">
                    <span>脱敏方式</span>
                    <select
                      value={maskMode}
                      onChange={(e) => {
                        setMaskMode(e.target.value as "stars" | "hash");
                        setMaskPreview(null);
                      }}
                    >
                      <option value="stars">星号掩码（如 A****z）</option>
                      <option value="hash">哈希替换</option>
                    </select>
                  </label>
                  <label className="table-io-field table-io-field--grow">
                    <span>文件名</span>
                    <div className="table-io-filename">
                      <input
                        value={maskFileName}
                        onChange={(e) => setMaskFileName(e.target.value)}
                        placeholder={`${table}-masked`}
                      />
                      <span className="table-io-ext">.csv</span>
                    </div>
                  </label>
                </div>

                <label className="modal-check">
                  <input
                    type="checkbox"
                    checked={bom}
                    onChange={(e) => setBom(e.target.checked)}
                  />
                  <span>UTF-8 BOM（Excel 友好）</span>
                </label>

                <div className="table-io-preview-block">
                  <div className="table-io-section-head">
                    <span>预览（前几行）</span>
                    {!maskPreview && (
                      <span className="table-io-meta">勾选列后点预览</span>
                    )}
                  </div>
                  {maskPreview ? (
                    <div className="table-io-preview">
                      <table>
                        <thead>
                          <tr>
                            {maskPreview.columns.map((c) => (
                              <th
                                key={c}
                                className={
                                  maskCols.includes(c) ? "is-masked-col" : ""
                                }
                              >
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {maskPreview.rows.map((row, i) => (
                            <tr key={i}>
                              {row.map((cell, j) => {
                                const col = maskPreview.columns[j];
                                const masked = col
                                  ? maskCols.includes(col)
                                  : false;
                                return (
                                  <td
                                    key={j}
                                    className={masked ? "is-masked-cell" : ""}
                                  >
                                    {cell == null ? "" : String(cell)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="table-io-preview-empty">
                      尚未预览。可先选列，再点「预览」确认效果。
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                disabled={busy || loadingCols || maskCols.length === 0}
                onClick={() => void doPreview()}
              >
                {busy ? "…" : "预览"}
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={
                  busy ||
                  loadingCols ||
                  maskCols.length === 0 ||
                  !maskFileName.trim()
                }
                onClick={() => void doExportMasked()}
              >
                {busy ? "导出中…" : "导出 CSV"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
