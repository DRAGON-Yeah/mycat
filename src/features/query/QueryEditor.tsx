import Editor from "@monaco-editor/react";
import { useMemo, useState } from "react";
import { executeSql } from "../connections/sessionApi";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

export function QueryEditor() {
  const theme = useUiStore((s) => s.theme);
  const connection = useWorkspaceStore((s) => s.activeConnection);
  const [sql, setSql] = useState("SELECT 1;");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState<string | null>(null);
  const [result, setResult] = useState<{
    columns: string[];
    rows: unknown[][];
    rowsAffected: number;
    elapsedMs: number;
  } | null>(null);

  const monacoTheme = useMemo(
    () => (theme === "dark" ? "vs-dark" : "light"),
    [theme],
  );

  async function run() {
    if (!connection) {
      setError("请先打开一个连接");
      return;
    }
    setRunning(true);
    setError(null);
    setCancelNote(null);
    setResult(null);
    try {
      const selected =
        typeof window !== "undefined"
          ? window.getSelection()?.toString()?.trim()
          : "";
      const payload = selected || sql;
      const out = await executeSql(connection.id, payload);
      setResult(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="query-panel">
      <div className="query-toolbar">
        <span className="query-title">
          查询 {connection ? `· ${connection.name}` : "· 未连接"}
        </span>
        <div className="query-actions">
          <button type="button" disabled={running} onClick={() => void run()}>
            {running ? "执行中…" : "执行"}
          </button>
          <button
            type="button"
            disabled={!running}
            onClick={() =>
              setCancelNote("当前为同步驱动，取消将在语句结束后生效（尽力中断）。")
            }
          >
            取消
          </button>
        </div>
      </div>
      <div className="query-editor">
        <Editor
          height="220px"
          defaultLanguage="sql"
          theme={monacoTheme}
          value={sql}
          onChange={(v) => setSql(v ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            wordWrap: "on",
            automaticLayout: true,
          }}
        />
      </div>
      {error && <p className="pane-error">{error}</p>}
      {cancelNote && <p className="pane-placeholder">{cancelNote}</p>}
      {result && (
        <div className="query-result">
          <div className="pane-placeholder">
            影响 {result.rowsAffected} 行 · {result.elapsedMs} ms ·{" "}
            {result.rows.length} 行结果
          </div>
          <div className="data-grid-scroll query-result-table">
            <table>
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>
                        {cell === null ? "NULL" : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
