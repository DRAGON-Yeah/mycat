import { executeSql, openConnection } from "../connections/sessionApi";
import { splitSqlStatements } from "../query/sqlSplit";

export type SqlFileLogLevel = "info" | "ok" | "warn" | "error";

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
  onLog: (level: SqlFileLogLevel, text: string) => void;
  onProgress: (done: number, total: number, failed: number) => void;
};

export type SqlFileRunResult = {
  total: number;
  done: number;
  failed: number;
  cancelled: boolean;
};

function isMysql(engine: string) {
  return /mysql|mariadb/i.test(engine);
}

/** 去掉注释后判断语句是否可执行 */
function isRunnable(stmt: string) {
  const text = stmt
    .replace(/^--.*$/gm, "")
    .replace(/^#.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  return text.length > 0;
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

  args.onProgress(0, total, 0);

  if (total === 0) {
    args.onLog("warn", "文件中没有可执行的语句");
    return { total: 0, done: 0, failed: 0, cancelled: false };
  }

  await openConnection(args.connectionId);

  const autoCommit = args.autoCommitOff && mysql;
  if (args.autoCommitOff && !mysql) {
    args.onLog(
      "warn",
      "SET AUTOCOMMIT=0 仅支持 MySQL / MariaDB，当前连接已忽略该选项",
    );
  }
  if (autoCommit) {
    try {
      await executeSql(args.connectionId, "SET AUTOCOMMIT=0", args.database);
      args.onLog("info", "SET AUTOCOMMIT=0");
    } catch (err) {
      args.onLog(
        "warn",
        `SET AUTOCOMMIT=0 失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  args.onLog("info", `开始执行 ${total} 条语句`);

  for (let i = 0; i < statements.length; i += 1) {
    if (args.cancel.cancelled) {
      cancelled = true;
      args.onLog("warn", "已停止执行（剩余语句未运行）");
      break;
    }
    const stmt = statements[i]!;
    args.onLog("info", `[${i + 1}/${total}] ${previewStatement(stmt)}`);
    try {
      const result = await executeSql(
        args.connectionId,
        stmt,
        args.database,
      );
      done += 1;
      const affected =
        result.rowsAffected > 0 ? ` · 影响 ${result.rowsAffected} 行` : "";
      args.onLog(
        "ok",
        `[${i + 1}/${total}] 成功${affected} · ${result.elapsedMs}ms`,
      );
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      args.onLog("error", `[${i + 1}/${total}] 失败：${message}`);
      if (!args.continueOnError) {
        fatal = true;
        args.onLog("error", "遇到错误，已终止执行（未勾选“遇到错误时继续”）");
        break;
      }
    }
    args.onProgress(done + failed, total, failed);
  }

  if (autoCommit) {
    const shouldCommit = !fatal && !cancelled;
    const sql = shouldCommit ? "COMMIT" : "ROLLBACK";
    try {
      await executeSql(args.connectionId, sql, args.database);
      args.onLog("info", shouldCommit ? "COMMIT" : "ROLLBACK");
    } catch (err) {
      args.onLog(
        "warn",
        `${sql} 失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await executeSql(args.connectionId, "SET AUTOCOMMIT=1", args.database);
    } catch {
      /* ignore */
    }
  }

  args.onProgress(done + failed, total, failed);
  return { total, done, failed, cancelled };
}
