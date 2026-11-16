import type { ConnectionDto } from "../connections/types";
import {
  dumpTableSql,
  executeSql,
  fetchTablePage,
  openConnection,
} from "../connections/sessionApi";
import { downloadTextFile, rowsToCsv, parseCsv } from "../import-export/csv";
import { applyRowChanges } from "../connections/sessionApi";
import {
  loadDesignerColumns,
  loadDesignerForeignKeys,
  loadDesignerIndexes,
  loadTableOptions,
} from "../table-designer/loadColumns";
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
  const engine = String(conn.engine);
  const [cols, meta, indexes] = await Promise.all([
    loadDesignerColumns({
      connectionId: conn.id,
      engine,
      database,
      table,
    }),
    loadTableOptions({
      connectionId: conn.id,
      engine,
      database,
      table,
    }),
    loadDesignerIndexes({
      connectionId: conn.id,
      engine,
      database,
      table,
    }),
  ]);
  const lines = [
    `# 数据字典 · ${database}.${table}`,
    "",
    `- 引擎: ${meta.options.engine || "—"}`,
    `- 校对: ${meta.options.collation || "—"}`,
    `- 约行数: ${meta.stats.tableRows}`,
    `- 注释: ${meta.options.comment || "—"}`,
    "",
    `| 列名 | 类型 | 可空 | 主键 | 默认 | Extra | 注释 |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    ...cols.map((c) => {
      const typ = [c.typeName, c.length ? `(${c.length}${c.decimals ? `,${c.decimals}` : ""})` : ""]
        .join("");
      return `| ${c.name} | ${typ} | ${c.notNull ? "NO" : "YES"} | ${c.isPk ? "YES" : ""} | ${c.defaultValue ?? ""} | ${c.extra || ""} | ${c.comment || ""} |`;
    }),
    "",
    `## 索引`,
    "",
    ...indexes.map(
      (ix) =>
        `- **${ix.name}** (${ix.unique ? "UNIQUE " : ""}${ix.indexType || "BTREE"}): ${ix.columns}`,
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
  const engine = String(conn.engine);
  const [cols, fks] = await Promise.all([
    loadDesignerColumns({
      connectionId: conn.id,
      engine,
      database,
      table,
    }),
    loadDesignerForeignKeys({
      connectionId: conn.id,
      engine,
      database,
      table,
    }),
  ]);
  const safe = (n: string) => n.replace(/[^A-Za-z0-9_]/g, "_") || "t";
  const t = safe(table);
  const lines = [
    `# 逆向模型 · ${database}.${table}`,
    "",
    "```mermaid",
    "erDiagram",
    `  ${t} {`,
    ...cols.slice(0, 32).map((col) => {
      const typ = (col.typeName || "string").replace(/[^A-Za-z0-9_]/g, "");
      const pk = col.isPk ? " PK" : "";
      return `    ${typ || "string"} ${safe(col.name)}${pk}`;
    }),
    "  }",
    ...fks
      .filter((fk) => fk.refTable.trim())
      .map((fk) => {
        const other = safe(fk.refTable);
        return `  ${other} ||--o{ ${t} : "${safe(fk.name)}"`;
      }),
    "```",
    "",
  ];
  const md = lines.join("\n");
  downloadTextFile(`${table}-model.md`, md, "text/markdown");
  return md;
}

/** Return SHOW CREATE TABLE/VIEW DDL text. */
export async function fetchCreateDdl(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
  isView?: boolean;
}): Promise<string> {
  const { conn, database, table, isView } = args;
  await openConnection(conn.id);
  const e = engineKey(conn.engine);
  if (e === "mysql") {
    const qt = quoteTable(String(conn.engine), database, table);
    const kind = isView ? "VIEW" : "TABLE";
    const out = await executeSql(
      conn.id,
      `SHOW CREATE ${kind} ${qt}`,
      database,
    );
    const row = out.rows[0];
    if (!row) throw new Error("无法获取 DDL");
    const sql = String(row[1] ?? row[0] ?? "");
    if (!sql) throw new Error("无法获取 DDL");
    return sql.endsWith(";") ? sql : `${sql};`;
  }
  if (e === "sqlite") {
    const out = await executeSql(
      conn.id,
      `SELECT sql FROM sqlite_master WHERE name = '${table.replace(/'/g, "''")}' AND type IN ('table','view')`,
      database,
    );
    const sql = String(out.rows[0]?.[0] ?? "");
    if (!sql) throw new Error("无法获取 DDL");
    return sql.endsWith(";") ? sql : `${sql};`;
  }
  // Postgres fallback
  const qt = quoteTable(String(conn.engine), null, table);
  return `-- Postgres: use pg_dump for full DDL\n-- Table: ${qt}\n`;
}

export async function exportTableCsv(args: {
  connectionId: string;
  table: string;
  database?: string;
  columns?: string[];
  bom?: boolean;
}) {
  const { connectionId, table, database, bom = true } = args;
  await openConnection(connectionId);
  const pageSize = 500;
  let page = 1;
  let allColumns: string[] = [];
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
      allColumns = chunk.columns.map((c) => c.name);
      total = chunk.total;
    }
    allRows.push(...chunk.rows);
    if (allRows.length >= total || chunk.rows.length === 0) break;
    page += 1;
  }
  const selected =
    args.columns && args.columns.length > 0
      ? args.columns.filter((c) => allColumns.includes(c))
      : allColumns;
  if (selected.length === 0) {
    throw new Error("请至少选择一列导出");
  }
  const idxs = selected.map((c) => allColumns.indexOf(c));
  const projected = allRows.map((row) => idxs.map((i) => row[i]));
  downloadTextFile(
    `${table}.csv`,
    rowsToCsv(selected, projected, { bom }),
    "text/csv;charset=utf-8",
  );
  return allRows.length;
}

export async function importTableCsv(args: {
  connectionId: string;
  table: string;
  database?: string;
  file: File;
  /** Map CSV header → table column; omit/empty to skip */
  columnMap?: Record<string, string>;
  truncateFirst?: boolean;
  engine?: string;
}): Promise<{ ok: number; failed: number }> {
  const {
    connectionId,
    table,
    database,
    file,
    columnMap,
    truncateFirst,
    engine,
  } = args;
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
  const csvCols = parsed.columns.map((c) => c.trim());

  const usable: { csvIdx: number; tableCol: string }[] = [];
  if (columnMap) {
    for (let i = 0; i < csvCols.length; i++) {
      const csvName = csvCols[i]!;
      const target = columnMap[csvName];
      if (!target) continue;
      if (!tableColumns.includes(target)) {
        throw new Error(`目标列不存在: ${target}`);
      }
      usable.push({ csvIdx: i, tableCol: target });
    }
  } else {
    for (let i = 0; i < csvCols.length; i++) {
      const name = csvCols[i]!;
      if (name && tableColumns.includes(name)) {
        usable.push({ csvIdx: i, tableCol: name });
      }
    }
  }
  if (usable.length === 0) {
    throw new Error("没有可映射的列");
  }

  if (truncateFirst) {
    const e = engineKey(engine || "mysql");
    const qt = quoteTable(e, database || null, table);
    if (e === "sqlite") {
      await executeSql(connectionId, `DELETE FROM ${qt}`, database);
    } else {
      await executeSql(connectionId, `TRUNCATE TABLE ${qt}`, database);
    }
  }

  let ok = 0;
  let failed = 0;
  const batch: { columns: string[]; values: unknown[] }[] = [];
  for (const row of parsed.rows) {
    if (row.every((c) => c.trim() === "")) continue;
    batch.push({
      columns: usable.map((c) => c.tableCol),
      values: usable.map((c) => {
        const raw = row[c.csvIdx] ?? "";
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
  const engine = String(conn.engine);
  const e = engineKey(engine);
  const qt = quoteTable(engine, database, table);

  // MySQL: plain DELETE without WHERE is blocked by sql_safe_updates;
  // FK children also block parent deletes — temporarily relax both.
  if (e === "mysql") {
    try {
      await executeSql(conn.id, "SET FOREIGN_KEY_CHECKS=0", database);
      await executeSql(conn.id, "SET sql_safe_updates=0", database);
      await executeSql(conn.id, `DELETE FROM ${qt} WHERE 1=1`, database);
    } finally {
      try {
        await executeSql(conn.id, "SET sql_safe_updates=1", database);
      } catch {
        /* ignore */
      }
      try {
        await executeSql(conn.id, "SET FOREIGN_KEY_CHECKS=1", database);
      } catch {
        /* ignore */
      }
    }
    return;
  }

  if (e === "sqlite") {
    await executeSql(conn.id, "PRAGMA foreign_keys=OFF", database);
    try {
      await executeSql(conn.id, `DELETE FROM ${qt}`, database);
    } finally {
      try {
        await executeSql(conn.id, "PRAGMA foreign_keys=ON", database);
      } catch {
        /* ignore */
      }
    }
    return;
  }

  // Postgres: DELETE keeps identity sequence (unlike TRUNCATE)
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
  } else if (e === "mysql") {
    try {
      await executeSql(conn.id, "SET FOREIGN_KEY_CHECKS=0", database);
      await executeSql(conn.id, `TRUNCATE TABLE ${qt}`, database);
    } finally {
      try {
        await executeSql(conn.id, "SET FOREIGN_KEY_CHECKS=1", database);
      } catch {
        /* ignore */
      }
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
