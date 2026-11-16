import {
  applyRowChanges,
  executeSql,
  fetchTablePage,
  openConnection,
} from "../connections/sessionApi";
import { downloadTextFile, rowsToCsv } from "../import-export/csv";
import { loadDesignerColumns } from "../table-designer/loadColumns";
import { composedType } from "../table-designer/types";
import { engineKey, quoteTable } from "./sqlIdent";

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sampleValue(colName: string, dataType: string, i: number): unknown {
  const t = dataType.toLowerCase();
  const n = colName.toLowerCase();
  if (t.includes("bool") || t === "bit(1)" || t === "tinyint(1)") {
    return i % 2 === 0;
  }
  if (
    t.includes("int") ||
    t.includes("decimal") ||
    t.includes("numeric") ||
    t.includes("float") ||
    t.includes("double")
  ) {
    return randInt(1, 9999);
  }
  if (t.includes("date") && !t.includes("time")) {
    const d = new Date();
    d.setDate(d.getDate() - randInt(0, 365));
    return d.toISOString().slice(0, 10);
  }
  if (t.includes("time") || t.includes("timestamp")) {
    const d = new Date();
    d.setMinutes(d.getMinutes() - randInt(0, 10000));
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  if (n.includes("email")) return `user${i}@example.com`;
  if (n.includes("name") || n.includes("title")) return `${colName}_${i}`;
  if (n.includes("phone")) return `138${String(randInt(10000000, 99999999))}`;
  if (t.includes("json")) return JSON.stringify({ i, name: `row_${i}` });
  return `${colName}_val_${i}`;
}

export async function generateTableRows(args: {
  connectionId: string;
  database: string;
  table: string;
  count: number;
  engine?: string;
}): Promise<number> {
  const { connectionId, database, table, count } = args;
  if (count < 1 || count > 5000) {
    throw new Error("生成行数需在 1~5000");
  }
  const engine = args.engine || "mysql";
  const cols = await loadDesignerColumns({
    connectionId,
    engine,
    database,
    table,
  });
  const useCols = cols.filter(
    (c) =>
      !c.virtual &&
      !/auto_increment/i.test(c.extra) &&
      !(c.isPk && /int/i.test(c.typeName)),
  );
  if (useCols.length === 0) {
    throw new Error("没有可写入的列（可能全是自增/虚拟列）");
  }

  let ok = 0;
  const chunkSize = 50;
  for (let start = 1; start <= count; start += chunkSize) {
    const end = Math.min(count, start + chunkSize - 1);
    const changes = [];
    for (let i = start; i <= end; i++) {
      changes.push({
        op: "insert" as const,
        pkColumns: [] as string[],
        pkValues: [] as unknown[],
        columns: useCols.map((c) => c.name),
        values: useCols.map((c) =>
          sampleValue(c.name, composedType(c) || c.typeName, i),
        ),
      });
    }
    try {
      await applyRowChanges({ connectionId, table, database, changes });
      ok += changes.length;
    } catch (err) {
      // Row-level retry on unique conflicts
      for (const ch of changes) {
        try {
          await applyRowChanges({
            connectionId,
            table,
            database,
            changes: [ch],
          });
          ok += 1;
        } catch {
          /* skip conflicting row */
        }
      }
      if (ok === 0) throw err;
    }
  }
  return ok;
}

function maskCell(value: unknown, mode: "stars" | "hash"): string {
  if (value == null) return "";
  const s = String(value);
  if (!s) return "";
  if (mode === "stars") {
    if (s.length <= 2) return "**";
    return `${s[0]}${"*".repeat(Math.min(8, s.length - 2))}${s[s.length - 1]}`;
  }
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hash_${h.toString(16)}`;
}

export async function exportMaskedCsv(args: {
  connectionId: string;
  database: string;
  table: string;
  maskColumns: string[];
  mode?: "stars" | "hash";
  fileName?: string;
  bom?: boolean;
  previewLimit?: number;
}): Promise<{ count: number; preview: { columns: string[]; rows: unknown[][] } }> {
  const {
    connectionId,
    database,
    table,
    maskColumns,
    mode = "stars",
    fileName,
    bom = true,
    previewLimit = 5,
  } = args;
  await openConnection(connectionId);
  const mask = new Set(maskColumns);
  const pageSize = 500;
  let page = 1;
  let columns: string[] = [];
  const allRows: unknown[][] = [];
  let total = 0;
  while (true) {
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
    for (const row of chunk.rows) {
      allRows.push(
        row.map((cell, idx) => {
          const col = columns[idx];
          if (col && mask.has(col)) return maskCell(cell, mode);
          return cell;
        }),
      );
    }
    if (allRows.length >= total || chunk.rows.length === 0) break;
    page += 1;
  }
  const name = (fileName || `${table}-masked`).replace(/\.csv$/i, "");
  downloadTextFile(
    `${name}.csv`,
    rowsToCsv(columns, allRows, { bom }),
    "text/csv;charset=utf-8",
  );
  return {
    count: allRows.length,
    preview: {
      columns,
      rows: allRows.slice(0, previewLimit),
    },
  };
}

export async function previewMaskedRows(args: {
  connectionId: string;
  database: string;
  table: string;
  maskColumns: string[];
  mode?: "stars" | "hash";
  limit?: number;
}): Promise<{ columns: string[]; rows: unknown[][] }> {
  const {
    connectionId,
    database,
    table,
    maskColumns,
    mode = "stars",
    limit = 5,
  } = args;
  await openConnection(connectionId);
  const chunk = await fetchTablePage({
    connectionId,
    table,
    page: 1,
    pageSize: limit,
    database,
  });
  const columns = chunk.columns.map((c) => c.name);
  const mask = new Set(maskColumns);
  const rows = chunk.rows.map((row) =>
    row.map((cell, idx) => {
      const col = columns[idx];
      if (col && mask.has(col)) return maskCell(cell, mode);
      return cell;
    }),
  );
  return { columns, rows };
}

function formatUserHost(userHost: string): string {
  const user = userHost.trim();
  if (!/^'[^']+'@'[^']+'$/.test(user) && !/^[\w.-]+@[\w.%-]+$/.test(user)) {
    throw new Error("用户格式应为 user@host 或 'user'@'host'");
  }
  return user.includes("@") && !user.startsWith("'")
    ? `'${user.split("@")[0]}'@'${user.split("@").slice(1).join("@")}'`
    : user;
}

function normalizePriv(privilege: string): string {
  const priv = privilege.trim().toUpperCase() || "SELECT";
  if (!/^[A-Z]+(,\s*[A-Z]+)*$/.test(priv) && priv !== "ALL PRIVILEGES") {
    throw new Error("权限仅允许如 SELECT,INSERT 或 ALL PRIVILEGES");
  }
  return priv;
}

export async function listTableGrants(args: {
  connectionId: string;
  engine: string;
  database: string;
  table: string;
}): Promise<string[]> {
  const { connectionId, engine, database, table } = args;
  await openConnection(connectionId);
  const e = engineKey(engine);
  if (e !== "mysql") {
    throw new Error("表权限查看目前仅支持 MySQL");
  }
  const lines: string[] = [];
  try {
    const priv = await executeSql(
      connectionId,
      `SELECT GRANTEE, PRIVILEGE_TYPE, IS_GRANTABLE
       FROM information_schema.TABLE_PRIVILEGES
       WHERE TABLE_SCHEMA = '${database.replace(/'/g, "''")}'
         AND TABLE_NAME = '${table.replace(/'/g, "''")}'
       ORDER BY GRANTEE, PRIVILEGE_TYPE`,
      database,
    );
    for (const row of priv.rows) {
      lines.push(
        `${String(row[0] ?? "")} → ${String(row[1] ?? "")}${
          String(row[2] ?? "").toUpperCase() === "YES" ? " (WITH GRANT)" : ""
        }`,
      );
    }
  } catch {
    /* fall through to SHOW GRANTS */
  }
  const out = await executeSql(connectionId, "SHOW GRANTS");
  const grants = out.rows.map((r) => String(r[0] ?? ""));
  const needle = `${database}.${table}`;
  const related = grants.filter(
    (l) =>
      l.includes(needle) ||
      l.includes(`\`${database}\`.\`${table}\``) ||
      /ON \*\.\*/i.test(l) ||
      l.includes(`\`${database}\`.*`),
  );
  for (const g of related.length ? related : grants) {
    if (!lines.includes(g)) lines.push(g);
  }
  return lines;
}

export async function grantTablePrivilege(args: {
  connectionId: string;
  engine: string;
  database: string;
  table: string;
  userHost: string;
  privilege: string;
}) {
  const { connectionId, engine, database, table, userHost, privilege } = args;
  if (engineKey(engine) !== "mysql") {
    throw new Error("GRANT 目前仅支持 MySQL");
  }
  const priv = normalizePriv(privilege);
  const userSql = formatUserHost(userHost);
  await openConnection(connectionId);
  const qt = quoteTable(engine, database, table);
  await executeSql(connectionId, `GRANT ${priv} ON ${qt} TO ${userSql}`);
}

export async function revokeTablePrivilege(args: {
  connectionId: string;
  engine: string;
  database: string;
  table: string;
  userHost: string;
  privilege: string;
}) {
  const { connectionId, engine, database, table, userHost, privilege } = args;
  if (engineKey(engine) !== "mysql") {
    throw new Error("REVOKE 目前仅支持 MySQL");
  }
  const priv = normalizePriv(privilege);
  const userSql = formatUserHost(userHost);
  await openConnection(connectionId);
  const qt = quoteTable(engine, database, table);
  await executeSql(connectionId, `REVOKE ${priv} ON ${qt} FROM ${userSql}`);
}

