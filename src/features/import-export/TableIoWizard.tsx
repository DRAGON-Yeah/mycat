import { useState } from "react";
import {
  exportTableCsv,
  importTableCsv,
} from "../nav-tree/tableMenuActions";
import { exportMaskedCsv } from "../nav-tree/tableDataTools";
import { fetchTablePage, openConnection } from "../connections/sessionApi";

type Props = {
  mode: "import" | "export" | "mask";
  connectionId: string;
  database: string;
  table: string;
  onClose: () => void;
  onDone: (msg: string) => void;
};

export function TableIoWizard({
  mode,
  connectionId,
  database,
  table,
  onClose,
  onDone,
}: Props) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [maskCols, setMaskCols] = useState<string[]>([]);
  const [maskMode, setMaskMode] = useState<"stars" | "hash">("stars");

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
      setColumns(page.columns.map((c) => c.name));
      setStep(2);
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
      <div className="modal table-io-wizard" onMouseDown={(e) => e.stopPropagation()}>
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
                ? "将从 CSV 导入到当前表。第一步：确认目标表。"
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
            <p>选择 CSV 文件（表头需匹配列名）：</p>
            <ul className="table-io-cols">
              {columns.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setStep(1)}>
                上一步
              </button>
              <label className={`ghost-btn file-btn ${busy ? "is-disabled" : ""}`}>
                {busy ? "导入中…" : "选择文件并导入"}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void (async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        const r = await importTableCsv({
                          connectionId,
                          table,
                          database,
                          file,
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
                    })();
                  }}
                />
              </label>
            </div>
          </>
        )}

        {step === 2 && mode === "export" && (
          <>
            <p>将导出 {columns.length} 列全部数据为 CSV。</p>
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={() => setStep(1)}>
                上一步
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const n = await exportTableCsv({
                        connectionId,
                        table,
                        database,
                      });
                      onDone(`已导出 ${n} 行 CSV`);
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
                onChange={(e) =>
                  setMaskMode(e.target.value as "stars" | "hash")
                }
              >
                <option value="stars">星号掩码</option>
                <option value="hash">哈希替换</option>
              </select>
            </label>
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
                      const n = await exportMaskedCsv({
                        connectionId,
                        database,
                        table,
                        maskColumns: maskCols,
                        mode: maskMode,
                      });
                      onDone(`已导出脱敏 CSV（${n} 行）`);
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
