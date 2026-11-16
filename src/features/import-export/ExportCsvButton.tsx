import { useRef, useState } from "react";
import { fetchTablePage } from "../connections/sessionApi";
import { downloadTextFile, isSaveCancelled, rowsToCsv } from "./csv";

type Props = {
  connectionId: string;
  table: string;
  database?: string;
};

export function ExportCsvButton({ connectionId, table, database }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const cancelRef = useRef(false);

  async function onExport() {
    cancelRef.current = false;
    setBusy(true);
    setProgress("准备导出…");
    try {
      const pageSize = 500;
      let page = 1;
      let columns: string[] = [];
      const allRows: unknown[][] = [];
      let total = 0;

      while (true) {
        if (cancelRef.current) {
          setProgress("已取消");
          return;
        }
        const chunk = await fetchTablePage({
          connectionId,
          table,
          page,
          pageSize,
          database,
        });
        if (page === 1) {
          columns = chunk.columns.map((c) => c.name);
          total = chunk.total;
        }
        allRows.push(...chunk.rows);
        setProgress(`导出中 ${allRows.length}/${total}`);
        if (allRows.length >= total || chunk.rows.length === 0) break;
        page += 1;
      }

      if (cancelRef.current) {
        setProgress("已取消");
        return;
      }
      const csv = rowsToCsv(columns, allRows);
      await downloadTextFile(`${table}.csv`, csv, "text/csv;charset=utf-8");
      setProgress(`完成 ${allRows.length} 行`);
    } catch (err) {
      if (isSaveCancelled(err)) {
        setProgress("已取消");
        return;
      }
      setProgress(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="export-csv">
      <button type="button" disabled={busy} onClick={() => void onExport()}>
        {busy ? "导出中…" : "导出 CSV"}
      </button>
      {busy && (
        <button
          type="button"
          onClick={() => {
            cancelRef.current = true;
          }}
        >
          取消导出
        </button>
      )}
      {progress && <span className="export-progress">{progress}</span>}
    </span>
  );
}
