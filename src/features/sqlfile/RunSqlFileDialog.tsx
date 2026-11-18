import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type { ConnectionDto } from "../connections/types";
import { cancelSqlBatch } from "../connections/sessionApi";
import {
  countSqlStatements,
  runSqlFile,
  type SqlFileLogEntry,
  type SqlFileLogLevel,
} from "./runSqlFile";

type TabId = "general" | "log";

type Props = {
  conn: ConnectionDto;
  database: string;
  onClose: () => void;
  onMessage: (msg: string) => void;
};

const ENCODINGS: { value: string; label: string }[] = [
  { value: "utf-8", label: "utf-8" },
  { value: "gbk", label: "gbk" },
  { value: "gb18030", label: "gb18030" },
  { value: "big5", label: "big5" },
  { value: "utf-16le", label: "utf-16le" },
  { value: "utf-16be", label: "utf-16be" },
  { value: "iso-8859-1", label: "latin1" },
];

const MAX_LOG_LINES = 20000;
/** 日志行高（与 .sqlfile-log-line 的 height 保持一致），用于虚拟滚动 */
const LOG_ROW_HEIGHT = 18;
const LOG_OVERSCAN = 20;

type LogLine = {
  id: number;
  level: SqlFileLogLevel;
  time: string;
  text: string;
};

function decodeBytes(bytes: Uint8Array, encoding: string) {
  try {
    const text = new TextDecoder(encoding).decode(bytes);
    return {
      text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text,
      warning: null as string | null,
    };
  } catch {
    return {
      text: new TextDecoder("utf-8").decode(bytes),
      warning: `当前环境不支持编码 ${encoding}，已回退 UTF-8`,
    };
  }
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function RunSqlFileDialog({ conn, database, onClose, onMessage }: Props) {
  const [tab, setTab] = useState<TabId>("general");
  const [filePath, setFilePath] = useState("");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [encoding, setEncoding] = useState("utf-8");
  const [continueOnError, setContinueOnError] = useState(true);
  const [multipleQueries, setMultipleQueries] = useState(true);
  const [autoCommitOff, setAutoCommitOff] = useState(true);
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
    done: number;
    failed: number;
    cancelled: boolean;
  } | null>(null);
  const [error, setError] = useState("");

  const logIdRef = useRef(0);
  const cancelRef = useRef({ cancelled: false });
  const startedAtRef = useRef(0);
  const logListRef = useRef<HTMLDivElement>(null);
  /** 日志区滚动位置（虚拟滚动只渲染可见行） */
  const [logView, setLogView] = useState({ top: 0, height: 320 });
  /** 用户是否停在底部：是则自动跟随新日志 */
  const followTailRef = useRef(true);
  const progressFrameRef = useRef(0);
  const pendingProgressRef = useRef<{
    done: number;
    total: number;
    failed: number;
  } | null>(null);

  const decoded = useMemo(
    () => (bytes ? decodeBytes(bytes, encoding) : null),
    [bytes, encoding],
  );

  const statementCount = useMemo(
    () => (decoded ? countSqlStatements(decoded.text) : 0),
    [decoded],
  );

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
    if (!el) return;
    const sync = () => {
      setLogView({ top: el.scrollTop, height: el.clientHeight });
      followTailRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < LOG_ROW_HEIGHT * 2;
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = logListRef.current;
    if (!el || !followTailRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  useEffect(
    () => () => {
      if (progressFrameRef.current) {
        cancelAnimationFrame(progressFrameRef.current);
        progressFrameRef.current = 0;
      }
    },
    [],
  );

  /** 进度更新合并到下一帧，避免每条语句都触发一次渲染 */
  function pushProgress(done: number, total: number, failed: number) {
    pendingProgressRef.current = { done, total, failed };
    if (progressFrameRef.current) return;
    progressFrameRef.current = requestAnimationFrame(() => {
      progressFrameRef.current = 0;
      const next = pendingProgressRef.current;
      if (!next) return;
      pendingProgressRef.current = null;
      setProgress((p) => ({
        ...p,
        ...next,
        elapsedMs: Date.now() - startedAtRef.current,
      }));
    });
  }

  function appendLogs(entries: SqlFileLogEntry[]) {
    if (entries.length === 0) return;
    const time = new Date().toLocaleTimeString();
    const lines: LogLine[] = entries.map((entry) => {
      logIdRef.current += 1;
      return { id: logIdRef.current, level: entry.level, time, text: entry.text };
    });
    setLogs((prev) => {
      const next = prev.concat(lines);
      if (next.length <= MAX_LOG_LINES) return next;
      const overflow = next.length - MAX_LOG_LINES;
      // 裁剪时保留被裁掉的错误行，避免失败信息被冲掉
      const errors = next
        .slice(0, overflow)
        .filter((line) => line.level === "error");
      const kept = next.slice(overflow);
      return errors.length > 0 ? errors.concat(kept) : kept;
    });
  }

  async function pickFile() {
    setPicking(true);
    setError("");
    try {
      const picked = await open({
        title: "选择 SQL 文件",
        multiple: false,
        filters: [
          { name: "SQL", extensions: ["sql"] },
          { name: "所有文件", extensions: ["*"] },
        ],
      });
      if (!picked || Array.isArray(picked)) return;
      const data = await readFile(picked);
      setFilePath(picked);
      setBytes(data);
      setSummary(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  }

  async function start() {
    if (!decoded) {
      setError("请先选择 SQL 文件");
      return;
    }
    if (statementCount === 0) {
      setError("文件中没有可执行的语句");
      return;
    }
    setError("");
    setSummary(null);
    setLogs([]);
    setTab("log");
    setRunning(true);
    setProgress({
      total: multipleQueries ? statementCount : 1,
      done: 0,
      failed: 0,
      elapsedMs: 0,
    });
    startedAtRef.current = Date.now();
    cancelRef.current = { cancelled: false };
    followTailRef.current = true;

    if (decoded.warning) {
      appendLogs([{ level: "warn", text: decoded.warning }]);
    }

    try {
      const result = await runSqlFile({
        connectionId: conn.id,
        engine: String(conn.engine),
        database: database || null,
        sql: decoded.text,
        continueOnError,
        multipleQueries,
        autoCommitOff,
        cancel: cancelRef.current,
        onLogs: appendLogs,
        onProgress: pushProgress,
      });
      setSummary(result);
      setProgress((p) => ({
        ...p,
        done: result.done + result.failed,
        total: result.total || p.total,
        failed: result.failed,
        elapsedMs: Date.now() - startedAtRef.current,
      }));
      if (result.failed === 0 && !result.cancelled) {
        appendLogs([
          { level: "ok", text: `全部完成：共 ${result.total} 条语句` },
        ]);
      } else {
        appendLogs([
          {
            level: "warn",
            text: `执行结束：成功 ${result.done} 条，失败 ${result.failed} 条${
              result.cancelled ? "（已停止）" : ""
            }`,
          },
        ]);
      }
      onMessage(
        `运行 SQL 文件：成功 ${result.done} 条${
          result.failed > 0 ? `，失败 ${result.failed} 条` : ""
        }`,
      );
      if (result.done > 0) {
        window.dispatchEvent(new Event("mycat:object-list-refresh"));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLogs([{ level: "error", text: `执行失败：${message}` }]);
      setSummary({ done: 0, failed: 1, cancelled: false });
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

  const logStart = Math.max(
    0,
    Math.floor(logView.top / LOG_ROW_HEIGHT) - LOG_OVERSCAN,
  );
  const logEnd = Math.min(
    logs.length,
    logStart +
      Math.ceil((logView.height || 320) / LOG_ROW_HEIGHT) +
      LOG_OVERSCAN * 2,
  );
  const visibleLogs = logs.slice(logStart, logEnd);

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
        aria-label="运行 SQL 文件"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sqlfile-header">
          <h2>运行 SQL 文件</h2>
          <nav className="sqlfile-tabs" aria-label="运行 SQL 文件步骤">
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
                <label className="sqlfile-label" htmlFor="sqlfile-path">
                  文件:
                </label>
                <input
                  id="sqlfile-path"
                  className="sqlfile-file-input"
                  value={filePath}
                  readOnly
                  placeholder="请选择 SQL 文件"
                  title={filePath}
                />
                <button
                  type="button"
                  className="sqlfile-browse"
                  disabled={running || picking}
                  onClick={() => void pickFile()}
                  aria-label="选择 SQL 文件"
                >
                  …
                </button>
              </div>

              <div className="sqlfile-row">
                <label className="sqlfile-label" htmlFor="sqlfile-encoding">
                  编码:
                </label>
                <select
                  id="sqlfile-encoding"
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
                    checked={continueOnError}
                    disabled={running}
                    onChange={(e) => setContinueOnError(e.target.checked)}
                  />
                  <span>遇到错误时继续</span>
                </label>
                <label className="modal-check">
                  <input
                    type="checkbox"
                    checked={multipleQueries}
                    disabled={running}
                    onChange={(e) => setMultipleQueries(e.target.checked)}
                  />
                  <span>在每个运行中运行多个查询</span>
                </label>
                <label className="modal-check">
                  <input
                    type="checkbox"
                    checked={autoCommitOff}
                    disabled={running}
                    onChange={(e) => setAutoCommitOff(e.target.checked)}
                  />
                  <span>SET AUTOCOMMIT=0</span>
                </label>
              </div>

              {bytes && (
                <p className="sqlfile-hint">
                  {formatBytes(bytes.length)} · 约 {statementCount} 条语句
                </p>
              )}
              {error && <p className="form-error">{error}</p>}
            </div>
          ) : (
            <div className="sqlfile-log-pane">
              <div className="sqlfile-log-stats">
                <div>
                  语句总数: <strong>{progress.total}</strong>
                </div>
                <div>
                  已执行: <strong>{progress.done}</strong>
                </div>
                <div>
                  成功: <strong>{Math.max(0, progress.done - progress.failed)}</strong>
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
                    ? `执行完成：成功 ${summary.done} 条，失败 ${summary.failed} 条，请查看下方错误日志`
                    : summary.cancelled
                      ? `已停止：成功 ${summary.done} 条`
                      : `执行完成：成功 ${summary.done} 条`}
                </p>
              )}

              <div className="sqlfile-log-list" ref={logListRef}>
                {logs.length === 0 ? (
                  <p className="pane-placeholder">尚未开始执行</p>
                ) : (
                  <div
                    className="sqlfile-log-virtual"
                    style={{ height: logs.length * LOG_ROW_HEIGHT }}
                  >
                    {visibleLogs.map((line, offset) => (
                      <div
                        key={line.id}
                        className={`sqlfile-log-line is-${line.level}`}
                        style={{ top: (logStart + offset) * LOG_ROW_HEIGHT }}
                        title={line.text}
                      >
                        <span className="sqlfile-log-time">{line.time}</span>
                        <span className="sqlfile-log-text">{line.text}</span>
                      </div>
                    ))}
                  </div>
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
              ? "正在执行…"
              : summary
                ? summary.failed > 0
                  ? `完成，${summary.failed} 条失败`
                  : "执行完成"
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
                  void cancelSqlBatch(conn.id).catch(() => {});
                  appendLogs([
                    {
                      level: "warn",
                      text: "正在停止…（当前语句执行完后停止）",
                    },
                  ]);
                }}
              >
                停止
              </button>
            ) : (
              <button
                type="button"
                className="is-primary"
                disabled={!bytes || picking}
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
