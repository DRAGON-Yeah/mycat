import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type { ConnectionDto } from "../connections/types";
import { defaultDumpFileName, buildDumpSql } from "./dumpSqlFile";
import { writeTextFileEncoded } from "./fileApi";
import type { SqlFileLogLevel } from "./runSqlFile";

type TabId = "general" | "log";

type Props = {
  conn: ConnectionDto;
  database: string;
  /** 从「结构和数据」或「仅结构」进入时的初始值 */
  includeData: boolean;
  onClose: () => void;
  onMessage: (msg: string) => void;
};

const ENCODINGS: { value: string; label: string }[] = [
  { value: "utf-8", label: "utf-8" },
  { value: "utf-8-bom", label: "utf-8 (带 BOM)" },
  { value: "gbk", label: "gbk" },
  { value: "gb18030", label: "gb18030" },
  { value: "big5", label: "big5" },
  { value: "utf-16le", label: "utf-16le" },
  { value: "utf-16be", label: "utf-16be" },
  { value: "iso-8859-1", label: "latin1" },
];

const MAX_LOG_LINES = 5000;

type LogLine = {
  id: number;
  level: SqlFileLogLevel;
  time: string;
  text: string;
};

export function DumpSqlFileDialog({
  conn,
  database,
  includeData: initialIncludeData,
  onClose,
  onMessage,
}: Props) {
  const [tab, setTab] = useState<TabId>("general");
  const [filePath, setFilePath] = useState("");
  const [encoding, setEncoding] = useState("utf-8");
  const [includeData, setIncludeData] = useState(initialIncludeData);
  const [picking, setPicking] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState({
    total: 0,
    done: 0,
    failed: 0,
    elapsedMs: 0,
  });
  const [summary, setSummary] = useState<{
    tables: number;
    failed: number;
    cancelled: boolean;
    bytes: number;
  } | null>(null);
  const [error, setError] = useState("");

  const logIdRef = useRef(0);
  const cancelRef = useRef({ cancelled: false });
  const startedAtRef = useRef(0);
  const logListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setProgress((p) => ({
        ...p,
        elapsedMs: Date.now() - startedAtRef.current,
      }));
    }, 200);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const el = logListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  function appendLog(level: SqlFileLogLevel, text: string) {
    logIdRef.current += 1;
    const line: LogLine = {
      id: logIdRef.current,
      level,
      time: new Date().toLocaleTimeString(),
      text,
    };
    setLogs((prev) => {
      const next = [...prev, line];
      return next.length > MAX_LOG_LINES
        ? next.slice(next.length - MAX_LOG_LINES)
        : next;
    });
  }

  async function pickFile() {
    setPicking(true);
    setError("");
    try {
      const picked = await save({
        title: "转储 SQL 文件",
        defaultPath: defaultDumpFileName(database, includeData),
        filters: [{ name: "SQL", extensions: ["sql"] }],
      });
      if (!picked) return;
      setFilePath(picked);
      setSummary(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  }

  async function start() {
    if (!filePath) {
      setError("请先选择保存文件");
      return;
    }
    setError("");
    setSummary(null);
    setLogs([]);
    setTab("log");
    setRunning(true);
    setProgress({ total: 0, done: 0, failed: 0, elapsedMs: 0 });
    startedAtRef.current = Date.now();
    cancelRef.current = { cancelled: false };

    try {
      const result = await buildDumpSql({
        conn,
        database,
        includeData,
        cancel: cancelRef.current,
        onLog: appendLog,
        onProgress: (done, total, failed) =>
          setProgress((p) => ({
            ...p,
            total,
            done,
            failed,
            elapsedMs: Date.now() - startedAtRef.current,
          })),
      });

      if (result.tables === 0 && result.failed === 0) {
        setSummary({
          tables: 0,
          failed: 0,
          cancelled: result.cancelled,
          bytes: 0,
        });
        return;
      }

      appendLog("info", `写入文件 ${filePath}（${encoding}）`);
      const bytes = await writeTextFileEncoded(filePath, result.sql, encoding);
      appendLog(
        "ok",
        `已写入 ${(bytes / 1024).toFixed(1)} KB${
          result.cancelled ? "（已停止，文件为部分内容）" : ""
        }`,
      );

      setSummary({
        tables: result.tables,
        failed: result.failed,
        cancelled: result.cancelled,
        bytes,
      });
      setProgress((p) => ({
        ...p,
        done: result.tables + result.failed,
        failed: result.failed,
        elapsedMs: Date.now() - startedAtRef.current,
      }));
      onMessage(
        `已转储 ${result.tables} 张表${result.failed > 0 ? `，失败 ${result.failed} 张` : ""}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog("error", `转储失败：${message}`);
      setSummary({ tables: 0, failed: 1, cancelled: false, bytes: 0 });
      onMessage(message);
    } finally {
      setRunning(false);
    }
  }

  const percent =
    progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;
  const elapsedLabel = `${(progress.elapsedMs / 1000).toFixed(2)}s`;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <div
        className="sqlfile-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="转储 SQL 文件"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sqlfile-header">
          <h2>转储 SQL 文件</h2>
          <nav className="sqlfile-tabs" aria-label="转储 SQL 文件步骤">
            <button
              type="button"
              className={tab === "general" ? "is-active" : undefined}
              disabled={running}
              onClick={() => setTab("general")}
            >
              常规
            </button>
            <button
              type="button"
              className={tab === "log" ? "is-active" : undefined}
              onClick={() => setTab("log")}
            >
              消息日志
            </button>
          </nav>
        </header>

        <div className="sqlfile-body">
          {tab === "general" ? (
            <div className="sqlfile-form">
              <div className="sqlfile-row">
                <span className="sqlfile-label">服务器:</span>
                <strong className="sqlfile-value">{conn.name}</strong>
              </div>
              <div className="sqlfile-row">
                <span className="sqlfile-label">数据库:</span>
                <strong className="sqlfile-value">
                  {database || "（默认）"}
                </strong>
              </div>

              <div className="sqlfile-row">
                <label className="sqlfile-label" htmlFor="dumpsql-path">
                  文件:
                </label>
                <input
                  id="dumpsql-path"
                  className="sqlfile-file-input"
                  value={filePath}
                  readOnly
                  placeholder="请选择保存位置"
                  title={filePath}
                />
                <button
                  type="button"
                  className="sqlfile-browse"
                  disabled={running || picking}
                  onClick={() => void pickFile()}
                  aria-label="选择保存位置"
                >
                  …
                </button>
              </div>

              <div className="sqlfile-row">
                <label className="sqlfile-label" htmlFor="dumpsql-encoding">
                  编码:
                </label>
                <select
                  id="dumpsql-encoding"
                  className="sqlfile-select"
                  value={encoding}
                  disabled={running}
                  onChange={(e) => setEncoding(e.target.value)}
                >
                  {ENCODINGS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sqlfile-checks">
                <label className="modal-check">
                  <input
                    type="checkbox"
                    checked={includeData}
                    disabled={running}
                    onChange={(e) => setIncludeData(e.target.checked)}
                  />
                  <span>包含数据（结构和数据）</span>
                </label>
              </div>

              <p className="sqlfile-hint">
                {includeData
                  ? "导出建表语句与 INSERT 数据"
                  : "仅导出建表语句，不含数据"}
              </p>
              {error && <p className="form-error">{error}</p>}
            </div>
          ) : (
            <div className="sqlfile-log-pane">
              <div className="sqlfile-log-stats">
                <div>
                  表总数: <strong>{progress.total}</strong>
                </div>
                <div>
                  已处理: <strong>{progress.done}</strong>
                </div>
                <div className={progress.failed > 0 ? "is-error" : undefined}>
                  失败: <strong>{progress.failed}</strong>
                </div>
                <div>
                  时间: <strong>{elapsedLabel}</strong>
                </div>
              </div>

              {summary && (
                <p
                  className={`sqlfile-summary ${
                    summary.failed > 0 ? "is-error" : "is-ok"
                  }`}
                >
                  {summary.failed > 0
                    ? `转储完成：成功 ${summary.tables} 张表，失败 ${summary.failed} 张，请查看下方错误日志`
                    : summary.tables === 0
                      ? "没有可转储的表"
                      : summary.cancelled
                        ? `已停止：已导出 ${summary.tables} 张表`
                        : `转储完成：${summary.tables} 张表 · ${(summary.bytes / 1024).toFixed(1)} KB`}
                </p>
              )}

              <div className="sqlfile-log-list" ref={logListRef}>
                {logs.length === 0 ? (
                  <p className="pane-placeholder">尚未开始转储</p>
                ) : (
                  logs.map((line) => (
                    <div
                      key={line.id}
                      className={`sqlfile-log-line is-${line.level}`}
                    >
                      <span className="sqlfile-log-time">{line.time}</span>
                      <span className="sqlfile-log-text">{line.text}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="sqlfile-progress">
                <div
                  className={`sqlfile-progress-bar ${
                    progress.failed > 0 ? "is-error" : ""
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="sqlfile-progress-label">
                {percent}% · {progress.done}/{progress.total}
              </p>
            </div>
          )}
        </div>

        <footer className="sqlfile-footer">
          <span className="sqlfile-status">
            {running
              ? "正在转储…"
              : summary
                ? summary.failed > 0
                  ? `完成，${summary.failed} 张表失败`
                  : "转储完成"
                : ""}
          </span>
          <div className="sqlfile-actions">
            <button type="button" disabled={running} onClick={onClose}>
              关闭
            </button>
            {running ? (
              <button
                type="button"
                className="is-danger"
                onClick={() => {
                  cancelRef.current.cancelled = true;
                  appendLog("warn", "正在停止…（当前表导出完成后停止）");
                }}
              >
                停止
              </button>
            ) : (
              <button
                type="button"
                className="is-primary"
                disabled={picking}
                onClick={() => void start()}
              >
                开始
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
