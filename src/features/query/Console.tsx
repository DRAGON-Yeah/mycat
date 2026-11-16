import { useState, type FormEvent } from "react";
import { executeSql } from "../connections/sessionApi";
import { useWorkspaceStore } from "../../stores/workspaceStore";

type Line = { kind: "in" | "out" | "err"; text: string };

export function ConsolePanel() {
  const connection = useWorkspaceStore((s) => s.activeConnection);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { kind: "out", text: "Console 就绪。输入 SQL 后回车执行。" },
  ]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const sql = input.trim();
    if (!sql) return;
    setLines((prev) => [...prev, { kind: "in", text: sql }]);
    setInput("");
    if (!connection) {
      setLines((prev) => [...prev, { kind: "err", text: "连接不可用，请先打开连接" }]);
      return;
    }
    try {
      const out = await executeSql(connection.id, sql);
      const summary = `OK · affected=${out.rowsAffected} · ${out.elapsedMs}ms · rows=${out.rows.length}`;
      setLines((prev) => [...prev, { kind: "out", text: summary }]);
      if (out.columns.length > 0) {
        setLines((prev) => [
          ...prev,
          {
            kind: "out",
            text: `${out.columns.join(" | ")}\n${out.rows
              .slice(0, 20)
              .map((r) => r.map((c) => (c === null ? "NULL" : String(c))).join(" | "))
              .join("\n")}`,
          },
        ]);
      }
    } catch (err) {
      setLines((prev) => [
        ...prev,
        { kind: "err", text: err instanceof Error ? err.message : String(err) },
      ]);
    }
  }

  return (
    <div className="console-panel">
      <div className="console-output">
        {lines.map((l, i) => (
          <pre key={i} className={`console-line is-${l.kind}`}>
            {l.kind === "in" ? "> " : ""}
            {l.text}
          </pre>
        ))}
      </div>
      <form className="console-input-row" onSubmit={(e) => void onSubmit(e)}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={connection ? "SQL…" : "请先打开连接"}
          disabled={!connection}
        />
        <button type="submit" disabled={!connection}>
          执行
        </button>
      </form>
    </div>
  );
}
