import { useState } from "react";
import { applyRowChanges } from "../connections/sessionApi";
import { parseCsv } from "./csv";

type Props = {
  connectionId: string;
  table: string;
  tableColumns: string[];
};

export function ImportCsvButton({ connectionId, table, tableColumns }: Props) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage("解析中…");
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      const mappedCols = parsed.columns.map((c) => c.trim());
      const unknown = mappedCols.filter((c) => c && !tableColumns.includes(c));
      if (unknown.length > 0) {
        throw new Error(`CSV 列不在表中: ${unknown.join(", ")}`);
      }
      const usable = mappedCols
        .map((name, idx) => ({ name, idx }))
        .filter((c) => c.name && tableColumns.includes(c.name));
      if (usable.length === 0) {
        throw new Error("没有可映射的列");
      }

      let ok = 0;
      let failed = 0;
      const batch: { columns: string[]; values: unknown[] }[] = [];
      for (const row of parsed.rows) {
        if (row.every((c) => c.trim() === "")) continue;
        batch.push({
          columns: usable.map((c) => c.name),
          values: usable.map((c) => {
            const raw = row[c.idx] ?? "";
            if (raw === "") return null;
            if (raw === "NULL") return null;
            return raw;
          }),
        });
      }

      // commit in chunks
      const chunkSize = 100;
      for (let i = 0; i < batch.length; i += chunkSize) {
        const slice = batch.slice(i, i + chunkSize);
        try {
          await applyRowChanges({
            connectionId,
            table,
            changes: slice.map((item) => ({
              op: "insert",
              pkColumns: [],
              pkValues: [],
              columns: item.columns,
              values: item.values,
            })),
          });
          ok += slice.length;
        } catch {
          // fallback one-by-one for partial success reporting
          for (const item of slice) {
            try {
              await applyRowChanges({
                connectionId,
                table,
                changes: [
                  {
                    op: "insert",
                    pkColumns: [],
                    pkValues: [],
                    columns: item.columns,
                    values: item.values,
                  },
                ],
              });
              ok += 1;
            } catch {
              failed += 1;
            }
          }
        }
        setMessage(`导入中 成功 ${ok} / 失败 ${failed}`);
      }
      setMessage(`完成：成功 ${ok}，失败 ${failed}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="import-csv">
      <label className={`ghost-btn file-btn ${busy ? "is-disabled" : ""}`}>
        {busy ? "导入中…" : "导入 CSV"}
        <input
          type="file"
          accept=".csv,text/csv"
          hidden
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void onFile(file);
          }}
        />
      </label>
      {message && <span className="export-progress">{message}</span>}
    </span>
  );
}
