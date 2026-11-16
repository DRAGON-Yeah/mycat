import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  executeSql,
  openConnection,
} from "../connections/sessionApi";
import { useWorkspaceStore } from "../../stores/workspaceStore";

type Line = { kind: "meta" | "in" | "out" | "err"; text: string };

function escapeIdent(name: string) {
  return name.replace(/`/g, "``");
}

function formatCell(c: unknown): string {
  if (c === null || c === undefined) return "NULL";
  if (typeof c === "object") {
    try {
      return JSON.stringify(c);
    } catch {
      return String(c);
    }
  }
  return String(c);
}

function formatResultTable(columns: string[], rows: unknown[][]): string {
  if (columns.length === 0) return "";
  const cells = [
    columns,
    ...rows.slice(0, 50).map((r) => r.map(formatCell)),
  ];
  const widths = columns.map((_, i) =>
    Math.min(
      48,
      Math.max(...cells.map((row) => (row[i] ?? "").length), columns[i]!.length),
    ),
  );
  const pad = (s: string, w: number) =>
    s.length > w ? `${s.slice(0, w - 1)}…` : s.padEnd(w);
  const line = (row: string[]) =>
    row.map((c, i) => pad(c, widths[i]!)).join(" | ");
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  const body = [
    line(columns),
    sep,
    ...rows.slice(0, 50).map((r) => line(r.map(formatCell))),
  ];
  if (rows.length > 50) {
    body.push(`… 另有 ${rows.length - 50} 行未显示`);
  }
  return body.join("\n");
}

function promptFor(engine: string | undefined, database: string | null) {
  const e = String(engine || "mysql").toLowerCase();
  const db = database || "";
  if (e === "postgres" || e === "postgresql") {
    return `${db || "postgres"}=# `;
  }
  if (e === "sqlite") return "sqlite> ";
  return `${db || "mysql"}> `;
}

export function ConsolePanel() {
  const connection = useWorkspaceStore((s) => s.activeConnection);
  const database = useWorkspaceStore((s) => s.selectedDatabase);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const historyIndex = useRef<number>(-1);
  const draftRef = useRef("");
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionKey = `${connection?.id ?? ""}::${database ?? ""}`;
  const sessionKeyRef = useRef("");

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [sessionKey]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!connection) {
        setReady(false);
        setSessionError(null);
        setLines([
          {
            kind: "meta",
            text: "未选择连接。请在左侧打开连接，或右键连接/数据库 →「命令行界面」。",
          },
        ]);
        return;
      }
      setBusy(true);
      setSessionError(null);
      try {
        await openConnection(connection.id);
        if (
          database &&
          String(connection.engine).toLowerCase() === "mysql"
        ) {
          await executeSql(
            connection.id,
            `USE \`${escapeIdent(database)}\``,
          );
        }
        if (cancelled) return;
        const switched = sessionKeyRef.current !== sessionKey;
        sessionKeyRef.current = sessionKey;
        const welcome = [
          `连接到 ${connection.name} (${connection.engine})`,
          database ? `当前数据库: ${database}` : "未指定数据库（可执行 USE db_name）",
          "输入 SQL 后回车执行；↑/↓ 翻阅历史；clear 清空输出。",
        ].join("\n");
        setLines((prev) =>
          switched || prev.length === 0
            ? [{ kind: "meta", text: welcome }]
            : prev,
        );
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setSessionError(msg);
        setReady(false);
        setLines([{ kind: "err", text: `无法打开会话: ${msg}` }]);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [connection, database, sessionKey]);

  async function runSql(sql: string) {
    if (!connection || !ready) return;
    setBusy(true);
    setLines((prev) => [...prev, { kind: "in", text: sql }]);
    setHistory((prev) => {
      if (prev[prev.length - 1] === sql) return prev;
      return [...prev.slice(-99), sql];
    });
    historyIndex.current = -1;
    draftRef.current = "";
    try {
      if (
        database &&
        String(connection.engine).toLowerCase() === "mysql" &&
        !/^\s*use\s+/i.test(sql)
      ) {
        await executeSql(
          connection.id,
          `USE \`${escapeIdent(database)}\``,
        );
      }
      const out = await executeSql(connection.id, sql);
      const summary = `Query OK · ${out.rowsAffected} row(s) affected · ${out.elapsedMs} ms · ${out.rows.length} row(s) in set`;
      const next: Line[] = [{ kind: "out", text: summary }];
      if (out.columns.length > 0) {
        next.push({
          kind: "out",
          text: formatResultTable(out.columns, out.rows),
        });
      }
      setLines((prev) => [...prev, ...next]);
    } catch (err) {
      setLines((prev) => [
        ...prev,
        {
          kind: "err",
          text: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const sql = input.trim();
    if (!sql || busy) return;
    if (/^(clear|cls)$/i.test(sql)) {
      setLines([
        {
          kind: "meta",
          text: connection
            ? `输出已清空 · ${connection.name}${database ? ` / ${database}` : ""}`
            : "输出已清空",
        },
      ]);
      setInput("");
      return;
    }
    setInput("");
    await runSql(sql);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      if (historyIndex.current < 0) {
        draftRef.current = input;
        historyIndex.current = history.length - 1;
      } else if (historyIndex.current > 0) {
        historyIndex.current -= 1;
      }
      setInput(history[historyIndex.current] ?? "");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex.current < 0) return;
      if (historyIndex.current >= history.length - 1) {
        historyIndex.current = -1;
        setInput(draftRef.current);
        return;
      }
      historyIndex.current += 1;
      setInput(history[historyIndex.current] ?? "");
    }
  }

  const prompt = promptFor(connection?.engine, database);

  return (
    <div className="console-panel">
      <div className="console-toolbar">
        <div className="console-toolbar-meta">
          <span className="console-title">命令行界面</span>
          {connection ? (
            <span className="console-context">
              {connection.name}
              {database ? ` · ${database}` : ""}
              <span className="console-engine"> · {connection.engine}</span>
            </span>
          ) : (
            <span className="console-context is-muted">未连接</span>
          )}
          {sessionError ? (
            <span className="console-session-err">{sessionError}</span>
          ) : null}
        </div>
        <div className="console-toolbar-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={!connection || busy}
            onClick={() => {
              setLines([
                {
                  kind: "meta",
                  text: connection
                    ? `输出已清空 · ${connection.name}${database ? ` / ${database}` : ""}`
                    : "输出已清空",
                },
              ]);
              inputRef.current?.focus();
            }}
          >
            清空
          </button>
        </div>
      </div>

      <div className="console-output" ref={outputRef}>
        {lines.map((l, i) => (
          <pre key={i} className={`console-line is-${l.kind}`}>
            {l.kind === "in" ? `${prompt}${l.text}` : l.text}
          </pre>
        ))}
        {busy ? <pre className="console-line is-meta">执行中…</pre> : null}
      </div>

      <form className="console-input-row" onSubmit={(e) => void onSubmit(e)}>
        <span className="console-prompt" aria-hidden>
          {prompt}
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            connection
              ? ready
                ? "输入 SQL，回车执行…"
                : "正在连接…"
              : "请先打开连接"
          }
          disabled={!connection || !ready || busy}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" disabled={!connection || !ready || busy || !input.trim()}>
          执行
        </button>
      </form>
    </div>
  );
}
