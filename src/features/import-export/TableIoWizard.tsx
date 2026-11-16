import { useMemo, useState } from "react";
import {
  exportTableCsv,
  importTableCsv,
} from "../nav-tree/tableMenuActions";
import {
  exportMaskedCsv,
  previewMaskedRows,
} from "../nav-tree/tableDataTools";
import { fetchTablePage, openConnection } from "../connections/sessionApi";
import { parseCsv, stripBom } from "./csv";

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
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
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

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal table-io-wizard"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>
          {mode === "import"
            ? "导入向导"
            : mode === "mask"
              ? "数据脱敏导出"
              : "导出向导"}
          · {table}
        </h2>
        {error && <p className="pane-error">{error}</p>}

        {step === 1 && (
          <>
            <p>
              {mode === "import"
                ? "将从 CSV 导入到当前表。第一步：确认目标表并加载列。"
                : mode === "mask"
                  ? "将导出脱敏后的 CSV。第一步：加载列信息。"
                  : "将导出当前表为 CSV。第一步：确认源表。"}
            </p>
            <p className="table-io-meta">
              库：{database}　表：{table}
            </p>
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
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
            <p>表列（选择 CSV 后可映射）：</p>
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
            <p>列映射（CSV → 表列）与预览：</p>
            <div className="table-io-map">
              {csvHeaders.map((h) => (
                <label key={h}>
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
            <label className="table-io-check">
              <input
                type="checkbox"
                checked={truncateFirst}
                onChange={(e) => setTruncateFirst(e.target.checked)}
              />
              导入前清空表（TRUNCATE）
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
            <p>选择要导出的列：</p>
            <div className="table-io-mask-list">
              {columns.map((c) => (
                <label key={c}>
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
                  {c}
                </label>
              ))}
            </div>
            <label className="table-io-check">
              <input
                type="checkbox"
                checked={bom}
                onChange={(e) => setBom(e.target.checked)}
              />
              UTF-8 BOM（Excel 友好）
            </label>
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setStep(1)}>
                上一步
              </button>
              <button
                type="button"
                disabled={busy || exportCols.length === 0}
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
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                {busy ? "导出中…" : "导出"}
              </button>
            </div>
          </>
        )}

        {step === 2 && mode === "mask" && (
          <>
            <p>勾选需要脱敏的列：</p>
            <div className="table-io-mask-list">
              {columns.map((c) => (
                <label key={c}>
                  <input
                    type="checkbox"
                    checked={maskCols.includes(c)}
                    onChange={(e) => {
                      setMaskCols((prev) =>
                        e.target.checked
                          ? [...prev, c]
                          : prev.filter((x) => x !== c),
                      );
                      setMaskPreview(null);
                    }}
                  />
                  {c}
                </label>
              ))}
            </div>
            <label>
              脱敏方式
              <select
                value={maskMode}
                onChange={(e) => {
                  setMaskMode(e.target.value as "stars" | "hash");
                  setMaskPreview(null);
                }}
              >
                <option value="stars">星号掩码</option>
                <option value="hash">哈希替换</option>
              </select>
            </label>
            <label>
              文件名
              <input
                value={maskFileName}
                onChange={(e) => setMaskFileName(e.target.value)}
                placeholder={`${table}-masked`}
              />
            </label>
            <label className="table-io-check">
              <input
                type="checkbox"
                checked={bom}
                onChange={(e) => setBom(e.target.checked)}
              />
              UTF-8 BOM
            </label>
            {maskPreview && (
              <div className="table-io-preview">
                <table>
                  <thead>
                    <tr>
                      {maskPreview.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {maskPreview.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>
                            {cell == null ? "" : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setStep(1)}>
                上一步
              </button>
              <button
                type="button"
                disabled={busy || maskCols.length === 0}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const preview = await previewMaskedRows({
                        connectionId,
                        database,
                        table,
                        maskColumns: maskCols,
                        mode: maskMode,
                        limit: 5,
                      });
                      setMaskPreview(preview);
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
                预览
              </button>
              <button
                type="button"
                disabled={busy || maskCols.length === 0 || !maskFileName.trim()}
                onClick={() =>
                  void (async () => {
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
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                {busy ? "导出中…" : "导出脱敏 CSV"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
