import type { ConnectionDto } from "../connections/types";
import {
  dumpTableSql,
  executeSql,
  fetchTablePage,
  openConnection,
} from "../connections/sessionApi";
import { downloadTextFile, rowsToCsv, parseCsv } from "../import-export/csv";
import { applyRowChanges } from "../connections/sessionApi";
import { engineKey, identOk, quoteIdent, quoteTable } from "./sqlIdent";

export async function dumpSingleTable(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
  includeData: boolean;
}) {
  const { conn, database, table, includeData } = args;
  await openConnection(conn.id);
  const sql = await dumpTableSql({
    connectionId: conn.id,
    table,
    includeData,
    engine: String(conn.engine),
    database,
  });
  downloadTextFile(
    `${table}${includeData ? "" : "-structure"}.sql`,
    sql,
    "application/sql",
  );
}

export async function exportTableDictionary(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
}) {
  const { conn, database, table } = args;
  await openConnection(conn.id);
  const page = await fetchTablePage({
    connectionId: conn.id,
    table,
    page: 1,
    pageSize: 1,
    database,
  });
  const lines = [
    `# 数据字典 · ${database}.${table}`,
    "",
    `| 列名 | 类型 | 可空 |`,
    `| --- | --- | --- |`,
    ...page.columns.map(
      (c) => `| ${c.name} | ${c.dataType} | ${c.nullable ? "YES" : "NO"} |`,
    ),
    "",
  ];
  downloadTextFile(
    `${table}-data-dictionary.md`,
    lines.join("\n"),
    "text/markdown",
  );
}

export async function reverseSingleTableModel(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
}): Promise<string> {
  const { conn, database, table } = args;
  await openConnection(conn.id);
  const page = await fetchTablePage({
    connectionId: conn.id,
    table,
    page: 1,
    pageSize: 1,
    database,
  });
  const safe = table.replace(/[^A-Za-z0-9_]/g, "_");
  const lines = [
    `# 逆向模型 · ${database}.${table}`,
    "",
    "```mermaid",
    "erDiagram",
    `  ${safe} {`,
    ...page.columns.slice(0, 24).map((col) => {
      const typ = col.dataType.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");
      return `    ${typ || "string"} ${col.name}`;
    }),
    "  }",
    "```",
    "",
  ];
  const md = lines.join("\n");
  downloadTextFile(`${table}-model.md`, md, "text/markdown");
  return md;
}

export async function exportTableCsv(args: {
  connectionId: string;
  table: string;
  database?: string;
}) {
  const { connectionId, table, database } = args;
  await openConnection(connectionId);
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
    allRows.push(...chunk.rows);
    if (allRows.length >= total || chunk.rows.length === 0) break;
    page += 1;
  }
  downloadTextFile(
    `${table}.csv`,
    rowsToCsv(columns, allRows),
    "text/csv;charset=utf-8",
  );
  return allRows.length;
}

export async function importTableCsv(args: {
  connectionId: string;
  table: string;
  database?: string;
  file: File;
}): Promise<{ ok: number; failed: number }> {
  const { connectionId, table, database, file } = args;
  await openConnection(connectionId);
  const meta = await fetchTablePage({
    connectionId,
    table,
    page: 1,
    pageSize: 1,
    database,
  });
  const tableColumns = meta.columns.map((c) => c.name);
  const text = await file.text();
  const parsed = parseCsv(text);
  const mappedCols = parsed.columns.map((c) => c.trim());
  const unknown = mappedCols.filter((c) => c && !tableColumns.includes(c));
  if (unknown.length > 0) {
    throw new Error(`CSV 列不在表中: ${unknown.join(", ")}`);
  }
  const usable = mappedCols
    .map((name, idx) => ({ name, idx }))
    .filter((c) => c.name && tableColumns.includes(c.name));
  if (usable.length === 0) {
    throw new Error("没有可映射的列");
  }
  let ok = 0;
  let failed = 0;
  const batch: { columns: string[]; values: unknown[] }[] = [];
  for (const row of parsed.rows) {
    if (row.every((c) => c.trim() === "")) continue;
    batch.push({
      columns: usable.map((c) => c.name),
      values: usable.map((c) => {
        const raw = row[c.idx] ?? "";
        if (raw === "" || raw === "NULL") return null;
        return raw;
      }),
    });
  }
  const chunkSize = 100;
  for (let i = 0; i < batch.length; i += chunkSize) {
    const slice = batch.slice(i, i + chunkSize);
    try {
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
    } catch {
      for (const item of slice) {
        try {
          await applyRowChanges({
            connectionId,
            table,
            database,
            changes: [
              {
                op: "insert",
                pkColumns: [],
                pkValues: [],
                columns: item.columns,
                values: item.values,
              },
            ],
          });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
    }
  }
  return { ok, failed };
}

export async function emptyTable(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
}) {
  const { conn, database, table } = args;
  await openConnection(conn.id);
  const qt = quoteTable(String(conn.engine), database, table);
  await executeSql(conn.id, `DELETE FROM ${qt}`, database);
}

export async function truncateTable(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
}) {
  const { conn, database, table } = args;
  await openConnection(conn.id);
  const e = engineKey(conn.engine);
  const qt = quoteTable(String(conn.engine), database, table);
  if (e === "sqlite") {
    await executeSql(conn.id, `DELETE FROM ${qt}`, database);
    try {
      await executeSql(
        conn.id,
        `DELETE FROM sqlite_sequence WHERE name = '${table.replace(/'/g, "''")}'`,
        database,
      );
    } catch {
      // no autoincrement sequence
    }
  } else {
    await executeSql(conn.id, `TRUNCATE TABLE ${qt}`, database);
  }
}

export async function dropTableOrView(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
  isView: boolean;
}) {
  const { conn, database, table, isView } = args;
  await openConnection(conn.id);
  const qt = quoteTable(String(conn.engine), database, table);
  await executeSql(
    conn.id,
    isView ? `DROP VIEW ${qt}` : `DROP TABLE ${qt}`,
    database,
  );
}

export async function renameTable(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
  next: string;
}) {
  const { conn, database, table, next } = args;
  if (!identOk(next)) {
    throw new Error("新表名仅允许字母、数字、下划线，且不能以数字开头");
  }
  await openConnection(conn.id);
  const e = engineKey(conn.engine);
  const qt = quoteTable(String(conn.engine), database, table);
  const qn = quoteIdent(String(conn.engine), next);
  if (e === "postgres" || e === "postgresql") {
    await executeSql(conn.id, `ALTER TABLE ${qt} RENAME TO ${qn}`, database);
  } else if (e === "sqlite") {
    await executeSql(conn.id, `ALTER TABLE ${qt} RENAME TO ${qn}`, database);
  } else {
    const qnDb = quoteTable(String(conn.engine), database, next);
    await executeSql(conn.id, `RENAME TABLE ${qt} TO ${qnDb}`, database);
  }
}

export async function copyTable(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
  newName: string;
  includeData: boolean;
}) {
  const { conn, database, table, newName, includeData } = args;
  if (!identOk(newName)) {
    throw new Error("目标表名仅允许字母、数字、下划线，且不能以数字开头");
  }
  if (newName === table) {
    throw new Error("目标表名不能与源表相同");
  }
  await openConnection(conn.id);
  const e = engineKey(conn.engine);
  const src = quoteTable(String(conn.engine), database, table);
  const dst = quoteTable(String(conn.engine), database, newName);

  if (e === "mysql") {
    await executeSql(conn.id, `CREATE TABLE ${dst} LIKE ${src}`, database);
    if (includeData) {
      await executeSql(conn.id, `INSERT INTO ${dst} SELECT * FROM ${src}`, database);
    }
    return;
  }

  // Postgres / SQLite: CREATE … AS SELECT (structure+data) or WITH NO DATA
  if (e === "postgres" || e === "postgresql") {
    if (includeData) {
      await executeSql(conn.id, `CREATE TABLE ${dst} AS TABLE ${src}`, database);
    } else {
      await executeSql(conn.id, `CREATE TABLE ${dst} AS TABLE ${src} WITH NO DATA`, database);
    }
    return;
  }

  // SQLite
  if (includeData) {
    await executeSql(conn.id, `CREATE TABLE ${dst} AS SELECT * FROM ${src}`, database);
  } else {
    await executeSql(
      conn.id,
      `CREATE TABLE ${dst} AS SELECT * FROM ${src} WHERE 0`,
      database,
    );
  }
}

export type MaintainOp = "analyze" | "optimize" | "check" | "repair";

export function maintainOpsForEngine(engine: string): MaintainOp[] {
  const e = engineKey(engine);
  if (e === "mysql") return ["analyze", "optimize", "check", "repair"];
  if (e === "postgres" || e === "postgresql") return ["analyze"];
  return [];
}

export async function maintainTable(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
  op: MaintainOp;
}) {
  const { conn, database, table, op } = args;
  const allowed = maintainOpsForEngine(String(conn.engine));
  if (!allowed.includes(op)) {
    throw new Error(`当前引擎不支持 ${op}`);
  }
  await openConnection(conn.id);
  const qt = quoteTable(String(conn.engine), database, table);
  const e = engineKey(conn.engine);
  let sql = "";
  if (e === "postgres" || e === "postgresql") {
    sql = `ANALYZE ${qt}`;
  } else {
    const map: Record<MaintainOp, string> = {
      analyze: `ANALYZE TABLE ${qt}`,
      optimize: `OPTIMIZE TABLE ${qt}`,
      check: `CHECK TABLE ${qt}`,
      repair: `REPAIR TABLE ${qt}`,
    };
    sql = map[op];
  }
  const out = await executeSql(conn.id, sql, database);
  return out;
}
