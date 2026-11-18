import {
  executeSql,
  executeSqlBatch,
  openConnection,
  type BatchOutcome,
} from "../connections/sessionApi";
import { splitSqlStatements, stripSqlComments } from "../query/sqlSplit";

export type SqlFileLogLevel = "info" | "ok" | "warn" | "error";

export type SqlFileLogEntry = {
  level: SqlFileLogLevel;
  text: string;
};

export type SqlFileRunOptions = {
  connectionId: string;
  engine: string;
  database?: string | null;
  sql: string;
  /** 遇到错误时继续 */
  continueOnError: boolean;
  /** 在每个运行中运行多个查询 */
  multipleQueries: boolean;
  /** SET AUTOCOMMIT=0（仅 MySQL / MariaDB） */
  autoCommitOff: boolean;
  cancel: { cancelled: boolean };
  /** 批量追加日志：一次 setState，避免逐条重渲染 */
  onLogs: (entries: SqlFileLogEntry[]) => void;
  onProgress: (done: number, total: number, failed: number) => void;
};

export type SqlFileRunResult = {
  total: number;
  done: number;
  failed: number;
  cancelled: boolean;
};

/** 每批发送的语句数：一次 IPC + 一次多语句包，避免逐条往返 */
export const SQL_FILE_BATCH_SIZE = 1000;

function isMysql(engine: string) {
  return /mysql|mariadb/i.test(engine);
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/** 去掉注释后判断语句是否可执行；MySQL 的版本注释（斜杠星号感叹号）会被保留 */
function isRunnable(stmt: string) {
  return stripSqlComments(stmt).trim().length > 0;
}

export function previewStatement(stmt: string, max = 120) {
  const oneLine = stmt.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export function countSqlStatements(sql: string) {
  return splitSqlStatements(sql).filter(isRunnable).length;
}

export async function runSqlFile(
  args: SqlFileRunOptions,
): Promise<SqlFileRunResult> {
  const mysql = isMysql(args.engine);
  const statements = args.multipleQueries
    ? splitSqlStatements(args.sql).filter(isRunnable)
    : [args.sql.trim()].filter((s) => s.length > 0);

  const total = statements.length;
  let done = 0;
  let failed = 0;
  let cancelled = false;
  let fatal = false;

  const pending: SqlFileLogEntry[] = [];
  const log = (level: SqlFileLogLevel, text: string) => {
    pending.push({ level, text });
  };
  const flush = () => {
    if (pending.length === 0) return;
    args.onLogs(pending.splice(0, pending.length));
  };

  args.onProgress(0, total, 0);

  if (total === 0) {
    args.onLogs([{ level: "warn", text: "文件中没有可执行的语句" }]);
    return { total: 0, done: 0, failed: 0, cancelled: false };
  }

  await openConnection(args.connectionId);

  const autoCommit = args.autoCommitOff && mysql;
  if (args.autoCommitOff && !mysql) {
    log(
      "warn",
      "SET AUTOCOMMIT=0 仅支持 MySQL / MariaDB，当前连接已忽略该选项",
    );
    flush();
  }
  if (autoCommit) {
    try {
      await executeSql(args.connectionId, "SET AUTOCOMMIT=0", args.database);
      log("info", "SET AUTOCOMMIT=0");
    } catch (err) {
      log("warn", `SET AUTOCOMMIT=0 失败：${errorText(err)}`);
    }
    flush();
  }

  log("info", `开始执行 ${total} 条语句（每批 ${SQL_FILE_BATCH_SIZE} 条）`);
  flush();

  for (let start = 0; start < statements.length; start += SQL_FILE_BATCH_SIZE) {
    if (args.cancel.cancelled) {
      cancelled = true;
      log("warn", "已停止执行（剩余语句未运行）");
      flush();
      break;
    }

    const chunk = statements.slice(start, start + SQL_FILE_BATCH_SIZE);
    let outcome: BatchOutcome;
    try {
      outcome = await executeSqlBatch(
        args.connectionId,
        chunk,
        args.database,
        args.continueOnError,
      );
    } catch (err) {
      // 整批失败（USE 失败 / 连接断开等）
      failed += chunk.length;
      log(
        "error",
        `[${start + 1}-${start + chunk.length}/${total}] 批次执行失败：${errorText(err)}`,
      );
      flush();
      args.onProgress(done + failed, total, failed);
      if (!args.continueOnError) {
        fatal = true;
        log("error", "遇到错误，已终止执行（未勾选“遇到错误时继续”）");
        flush();
        break;
      }
      continue;
    }

    for (let k = 0; k < outcome.results.length; k += 1) {
      const result = outcome.results[k]!;
      const index = start + k + 1;
      const preview = previewStatement(chunk[k]!, 100);
      if (result.ok) {
        done += 1;
        const affected =
          result.rowsAffected > 0 ? ` · 影响 ${result.rowsAffected} 行` : "";
        const cost =
          result.elapsedMs === null ? "" : ` · ${result.elapsedMs}ms`;
        log("ok", `[${index}/${total}] 成功${affected}${cost} · ${preview}`);
      } else {
        failed += 1;
        log(
          "error",
          `[${index}/${total}] 失败：${result.error ?? "未知错误"} · ${preview}`,
        );
      }
    }

    flush();
    args.onProgress(done + failed, total, failed);

    if (outcome.cancelled) {
      cancelled = true;
      log("warn", "已停止执行（剩余语句未运行）");
      flush();
      break;
    }
    if (outcome.stopped) {
      fatal = true;
      log("error", "遇到错误，已终止执行（未勾选“遇到错误时继续”）");
      flush();
      break;
    }
  }

  if (autoCommit) {
    const shouldCommit = !fatal && !cancelled;
    const sql = shouldCommit ? "COMMIT" : "ROLLBACK";
    try {
      await executeSql(args.connectionId, sql, args.database);
      log("info", shouldCommit ? "COMMIT" : "ROLLBACK");
    } catch (err) {
      log("warn", `${sql} 失败：${errorText(err)}`);
    }
    try {
      await executeSql(args.connectionId, "SET AUTOCOMMIT=1", args.database);
    } catch {
      /* ignore */
    }
    flush();
  }

  flush();
  args.onProgress(done + failed, total, failed);
  return { total, done, failed, cancelled };
}
