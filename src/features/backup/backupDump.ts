import type { ConnectionDto } from "../connections/types";
import { dumpTableSql, executeSql, openConnection } from "../connections/sessionApi";
import { fetchRoutineDdl, resolveRoutineType } from "../nav-tree/routineMenuActions";
import { fetchEventDdl } from "../nav-tree/eventMenuActions";
import { fetchCreateDdl } from "../nav-tree/tableMenuActions";
import {
  expandBackupFileName,
  saveBackup,
  type BackupMeta,
} from "./backupMeta";
import type { BackupAdvancedOptions } from "./backupProfile";
import {
  objectKey,
  type BackupObjectKind,
  type BackupObjectNode,
} from "./backupObjects";

export type BackupProgress = {
  objectsTotal: number;
  objectsDone: number;
  recordsDone: number;
  elapsedMs: number;
  percent: number;
  lines: string[];
};

export type BackupDumpRequest = {
  conn: ConnectionDto;
  database: string;
  comment: string;
  selected: BackupObjectNode[];
  advanced: BackupAdvancedOptions;
  onProgress: (p: BackupProgress) => void;
};

function logLine(tag: string, msg: string) {
  return `[BAK] ${tag}: ${msg}`;
}

function parseSelectedKey(key: string): BackupObjectNode | null {
  const i = key.indexOf(":");
  if (i <= 0) return null;
  const kind = key.slice(0, i) as BackupObjectKind;
  const name = key.slice(i + 1);
  if (!name) return null;
  if (
    kind !== "table" &&
    kind !== "view" &&
    kind !== "function" &&
    kind !== "event"
  ) {
    return null;
  }
  return { kind, name, key: objectKey(kind, name) };
}

export function nodesFromKeys(keys: string[]): BackupObjectNode[] {
  const out: BackupObjectNode[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const n = parseSelectedKey(k);
    if (!n || seen.has(n.key)) continue;
    seen.add(n.key);
    out.push(n);
  }
  return out;
}

/** Split SQL text into executable statements (heuristic). */
export function splitSqlStatements(sql: string): string[] {
  const stmts: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (inLineComment) {
      cur += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      cur += ch;
      if (ch === "*" && next === "/") {
        cur += "/";
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "-" && next === "-") {
        inLineComment = true;
        cur += ch;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        cur += ch;
        continue;
      }
      if (ch === ";") {
        const t = cur.trim();
        if (t) stmts.push(t);
        cur = "";
        continue;
      }
    }
    if (ch === "'" && !inDouble && !inBacktick) {
      if (inSingle && next === "'") {
        cur += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
    } else if (ch === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) stmts.push(tail);
  return stmts;
}

export async function runBackupDump(
  req: BackupDumpRequest,
): Promise<BackupMeta> {
  const { conn, database, comment, selected, advanced, onProgress } = req;
  const started = Date.now();
  const lines: string[] = [];
  let progressDone = 0;
  let progressRecords = 0;

  const emit = () => {
    onProgress({
      objectsTotal: selected.length,
      objectsDone: progressDone,
      recordsDone: progressRecords,
      elapsedMs: Date.now() - started,
      percent:
        selected.length === 0
          ? 100
          : Math.min(
              99,
              Math.round((progressDone / Math.max(1, selected.length)) * 100),
            ),
      lines: [...lines],
    });
  };

  if (selected.length === 0) {
    lines.push(logLine("Error", "未选择任何对象"));
    emit();
    throw new Error("请先在「对象选择」中勾选要备份的对象");
  }

  await openConnection(conn.id);
  const parts: string[] = [
    `-- Mycat backup of \`${database}\``,
    `-- Connection: ${conn.name}`,
    `-- Generated: ${new Date().toISOString()}`,
    comment.trim() ? `-- Comment: ${comment.trim().replace(/\n/g, " ")}` : null,
    "",
  ].filter((x): x is string => x != null);

  if (advanced.lockTables) {
    lines.push(logLine("Info", "LOCK TABLES (best-effort)"));
    emit();
    try {
      const tableNames = selected
        .filter((s) => s.kind === "table")
        .map((s) => `\`${s.name.replace(/`/g, "``")}\` WRITE`);
      if (tableNames.length > 0 && /mysql|mariadb/i.test(String(conn.engine))) {
        await executeSql(
          conn.id,
          `LOCK TABLES ${tableNames.join(", ")}`,
          database,
        );
      }
    } catch (err) {
      lines.push(
        logLine(
          "Warn",
          `LOCK TABLES failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      emit();
    }
  }

  if (advanced.singleTransaction && /mysql|mariadb/i.test(String(conn.engine))) {
    lines.push(logLine("Info", "START TRANSACTION (single transaction)"));
    emit();
    try {
      await executeSql(conn.id, "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ", database);
      await executeSql(conn.id, "START TRANSACTION", database);
    } catch (err) {
      lines.push(
        logLine(
          "Warn",
          `Single transaction failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      emit();
    }
  }

  const byKind = (k: BackupObjectKind) => selected.filter((s) => s.kind === k);

  if (byKind("view").length) {
    lines.push(logLine("Info", "Getting views"));
    emit();
  }
  if (byKind("function").length) {
    lines.push(logLine("Info", "Getting functions"));
    emit();
  }
  if (byKind("event").length) {
    lines.push(logLine("Info", "Getting events"));
    emit();
  }

  for (const obj of selected) {
    lines.push(logLine("Info", `Start to back up ${obj.kind} \`${obj.name}\``));
    emit();
    try {
      if (obj.kind === "table") {
        const sql = await dumpTableSql({
          connectionId: conn.id,
          table: obj.name,
          includeData: true,
          engine: String(conn.engine),
          database,
        });
        parts.push(sql, "");
        const insertMatches = sql.match(/INSERT\s+INTO/gi);
        progressRecords += insertMatches?.length ?? 0;
        // rough row estimate from VALUES lines
        const valueRows = (sql.match(/\n\(/g) ?? []).length;
        if (valueRows > progressRecords) progressRecords += valueRows;
      } else if (obj.kind === "view") {
        const sql = await fetchCreateDdl({
          conn,
          database,
          table: obj.name,
          isView: true,
        });
        parts.push(sql, "");
      } else if (obj.kind === "function") {
        const routineType = await resolveRoutineType({
          conn,
          database,
          name: obj.name,
        });
        const sql = await fetchRoutineDdl({
          conn,
          database,
          name: obj.name,
          routineType,
        });
        parts.push(sql, "");
      } else {
        const sql = await fetchEventDdl({
          conn,
          database,
          name: obj.name,
        });
        parts.push(sql, "");
      }
      progressDone += 1;
      lines.push(logLine("Info", `Finished ${obj.kind} \`${obj.name}\``));
      emit();
    } catch (err) {
      progressDone += 1;
      lines.push(
        logLine(
          "Error",
          `${obj.kind} \`${obj.name}\`: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      emit();
      throw err;
    }
  }

  if (advanced.singleTransaction && /mysql|mariadb/i.test(String(conn.engine))) {
    try {
      await executeSql(conn.id, "COMMIT", database);
    } catch {
      /* ignore */
    }
  }
  if (advanced.lockTables && /mysql|mariadb/i.test(String(conn.engine))) {
    try {
      await executeSql(conn.id, "UNLOCK TABLES", database);
    } catch {
      /* ignore */
    }
  }

  const fileName = advanced.useCustomFileName
    ? expandBackupFileName(advanced.fileNameTemplate)
    : expandBackupFileName("备份_%Y%m%d%H%M%S");
  const sqlText = parts.join("\n");
  const meta = await saveBackup({
    connectionId: conn.id,
    database,
    fileName,
    comment,
    sql: sqlText,
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  lines.push(
    logLine(
      "Info",
      `Finished successfully (${new Date().toLocaleString()}) · ${elapsed}s · ${fileName}`,
    ),
  );
  onProgress({
    objectsTotal: selected.length,
    objectsDone: selected.length,
    recordsDone: progressRecords,
    elapsedMs: Date.now() - started,
    percent: 100,
    lines: [...lines],
  });
  return meta;
}

export async function executeSqlFile(args: {
  connectionId: string;
  database: string;
  sql: string;
  onProgress?: (done: number, total: number, line: string) => void;
}): Promise<{ done: number; total: number }> {
  await openConnection(args.connectionId);
  const stmts = splitSqlStatements(args.sql).filter(
    (s) => !/^--/.test(s.trim()) || s.includes("\n"),
  );
  const runnable = stmts.filter((s) => {
    const t = s
      .replace(/^--.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    return t.length > 0;
  });
  let done = 0;
  for (const stmt of runnable) {
    args.onProgress?.(done, runnable.length, stmt.slice(0, 80));
    await executeSql(args.connectionId, stmt, args.database);
    done += 1;
    args.onProgress?.(done, runnable.length, "ok");
  }
  return { done, total: runnable.length };
}
