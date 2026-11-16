import {
  applyRowChanges,
  executeSql,
  fetchTablePage,
  openConnection,
} from "../connections/sessionApi";
import { downloadTextFile, rowsToCsv } from "../import-export/csv";
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
}): Promise<number> {
  const { connectionId, database, table, count } = args;
  if (count < 1 || count > 5000) {
    throw new Error("生成行数需在 1~5000");
  }
  await openConnection(connectionId);
  const page = await fetchTablePage({
    connectionId,
    table,
    page: 1,
    pageSize: 1,
    database,
  });
  const cols = page.columns.filter(
    (c) => !/auto_increment/i.test(c.dataType) && c.name.toLowerCase() !== "id",
  );
  // Prefer non-auto columns; if empty use all except first if looks like id
  let useCols = cols.length
    ? cols
    : page.columns.filter((c) => c.name.toLowerCase() !== "id");
  if (useCols.length === 0) useCols = page.columns;

  const batch: { columns: string[]; values: unknown[] }[] = [];
  for (let i = 1; i <= count; i++) {
    batch.push({
      columns: useCols.map((c) => c.name),
      values: useCols.map((c) => sampleValue(c.name, c.dataType, i)),
    });
  }
  let ok = 0;
  const chunkSize = 100;
  for (let i = 0; i < batch.length; i += chunkSize) {
    const slice = batch.slice(i, i + chunkSize);
    await applyRowChanges({
      connectionId,
      table,
      database,
      changes: slice.map((item) => ({
        op: "insert",
        pkColumns: [],
        pkValues: [],
        columns: item.columns,
        values: item.values,
      })),
    });
    ok += slice.length;
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
}): Promise<number> {
  const {
    connectionId,
    database,
    table,
    maskColumns,
    mode = "stars",
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
  downloadTextFile(
    `${table}-masked.csv`,
    rowsToCsv(columns, allRows),
    "text/csv;charset=utf-8",
  );
  return allRows.length;
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
    throw new Error("表权限查看目前仅支持 MySQL（SHOW GRANTS）");
  }
  const out = await executeSql(connectionId, "SHOW GRANTS");
  const lines = out.rows.map((r) => String(r[0] ?? ""));
  const needle = `${database}.${table}`;
  const related = lines.filter(
    (l) =>
      l.includes(needle) ||
      l.includes(`\`${database}\`.\`${table}\``) ||
      /ON \*\.\*/i.test(l) ||
      l.includes(`\`${database}\`.*`),
  );
  return related.length ? related : lines;
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
  const user = userHost.trim();
  if (!/^'[^']+'@'[^']+'$/.test(user) && !/^[\w.-]+@[\w.%-]+$/.test(user)) {
    throw new Error("用户格式应为 user@host 或 'user'@'host'");
  }
  const priv = privilege.trim().toUpperCase() || "SELECT";
  if (!/^[A-Z]+(,\s*[A-Z]+)*$/.test(priv) && priv !== "ALL PRIVILEGES") {
    throw new Error("权限仅允许如 SELECT,INSERT 或 ALL PRIVILEGES");
  }
  await openConnection(connectionId);
  const qt = quoteTable(engine, database, table);
  const userSql = user.includes("@") && !user.startsWith("'")
    ? `'${user.split("@")[0]}'@'${user.split("@").slice(1).join("@")}'`
    : user;
  await executeSql(
    connectionId,
    `GRANT ${priv} ON ${qt} TO ${userSql}`,
  );
}

