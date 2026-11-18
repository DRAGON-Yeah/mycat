import type { ConnectionDto } from "../connections/types";
import {
  dumpTableSql,
  executeSql,
  fetchTablePage,
  getTableDdl,
  listTables,
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
import {
  engineKey,
  identOk,
  isPostgres,
  quoteIdent,
  quoteTable,
  splitQualified,
} from "./sqlIdent";

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
  await downloadTextFile(
    `${table}${includeData ? "" : "-structure"}.sql`,
    sql,
    "application/sql",
  );
}

/** Shared body of the per-table data dictionary (columns + indexes). */
async function tableDictionarySection(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
  heading?: string;
}): Promise<string[]> {
  const { conn, database, table, heading } = args;
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
  return [
    ...(heading ? [heading, ""] : []),
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
}

export async function exportTableDictionary(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
}) {
  const { conn, database, table } = args;
  const lines = [
    `# 数据字典 · ${database}.${table}`,
    "",
    ...(await tableDictionarySection({ conn, database, table })),
  ];
  try {
    const viewDdl = await fetchCreateDdl({
      conn,
      database,
      table,
      isView: true,
    });
    if (/create\s+(or\s+replace\s+)?view\b/i.test(viewDdl)) {
      lines.push(
        "## 视图定义",
        "",
        "```sql",
        viewDdl.replace(/;\s*$/, ""),
        "```",
        "",
      );
    }
  } catch {
    /* base table */
  }
  await downloadTextFile(
    `${table}-data-dictionary.md`,
    lines.join("\n"),
    "text/markdown",
  );
}

/** Data dictionary for every base table of a database. */
export async function exportAllTablesDictionary(args: {
  conn: ConnectionDto;
  database: string;
}) {
  const { conn, database } = args;
  await openConnection(conn.id);
  const all = await listTables(conn.id, database);
  const tables = all.filter((t) => t.kind !== "view");
  const lines = [
    `# 表数据字典 · ${database}`,
    "",
    `连接：${conn.name}（${conn.engine}）`,
    `生成时间：${new Date().toLocaleString()}`,
    "",
  ];
  for (const t of tables) {
    try {
      lines.push(
        ...(await tableDictionarySection({
          conn,
          database,
          table: t.name,
          heading: `## ${t.name}`,
        })),
      );
    } catch (err) {
      lines.push(
        `## ${t.name}`,
        "",
        `（无法读取：${err instanceof Error ? err.message : String(err)}）`,
        "",
      );
    }
  }
  await downloadTextFile(
    `${database}-tables-dictionary.md`,
    lines.join("\n"),
    "text/markdown",
  );
  return tables.length;
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
  let viewDdl = "";
  try {
    viewDdl = await fetchCreateDdl({
      conn,
      database,
      table,
      isView: true,
    });
  } catch {
    /* ignore */
  }
  const isViewDdl =
    !!viewDdl && /create\s+(or\s+replace\s+)?view\b/i.test(viewDdl);
  const lines = [
    `# 逆向模型 · ${database}.${table}${isViewDdl ? "（视图）" : ""}`,
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
  if (isViewDdl) {
    lines.push("## VIEW DDL", "", "```sql", viewDdl.replace(/;\s*$/, ""), "```", "");
  }
  const md = lines.join("\n");
  await downloadTextFile(`${table}-model.md`, md, "text/markdown");
  return md;
}

export async function exportAllViewsDictionary(args: {
  conn: ConnectionDto;
  database: string;
}) {
  const { conn, database } = args;
  const { listTables } = await import("../connections/sessionApi");
  await openConnection(conn.id);
  const all = await listTables(conn.id, database);
  const views = all.filter((t) => t.kind === "view");
  const lines = [
    `# 视图数据字典 · ${database}`,
    "",
    `连接：${conn.name}（${conn.engine}）`,
    `生成时间：${new Date().toLocaleString()}`,
    "",
  ];
  for (const v of views) {
    lines.push(`## ${v.name}`, "");
    try {
      const ddl = await fetchCreateDdl({
        conn,
        database,
        table: v.name,
        isView: true,
      });
      lines.push("```sql", ddl.replace(/;\s*$/, ""), "```", "");
    } catch (err) {
      lines.push(
        `（无法读取定义：${err instanceof Error ? err.message : String(err)}）`,
        "",
      );
    }
  }
  await downloadTextFile(
    `${database}-views-dictionary.md`,
    lines.join("\n"),
    "text/markdown",
  );
  return views.length;
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
  // Postgres: real DDL assembled by the backend from the catalogs.
  const ddl = await getTableDdl({
    connectionId: conn.id,
    table,
    database,
  });
  return ddl.endsWith(";") ? ddl : `${ddl};`;
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
  await downloadTextFile(
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
  const engine = String(conn.engine);
  const qt = quoteTable(engine, database, table);
  if (isView && isPostgres(engine)) {
    // Views and materialized views need different DROP statements.
    try {
      await executeSql(conn.id, `DROP VIEW ${qt}`, database);
    } catch {
      await executeSql(conn.id, `DROP MATERIALIZED VIEW ${qt}`, database);
    }
    return;
  }
  await executeSql(
    conn.id,
    isView ? `DROP VIEW ${qt}` : `DROP TABLE ${qt}`,
    database,
  );
}

export type BatchTarget = { name: string; isView: boolean };

export type BatchResult = {
  ok: string[];
  failed: { name: string; error: string }[];
};

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/** 批量删除表/视图，逐个执行，失败不中断。 */
export async function dropTablesOrViews(args: {
  conn: ConnectionDto;
  database: string;
  targets: BatchTarget[];
}): Promise<BatchResult> {
  const ok: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const target of args.targets) {
    try {
      await dropTableOrView({
        conn: args.conn,
        database: args.database,
        table: target.name,
        isView: target.isView,
      });
      ok.push(target.name);
    } catch (err) {
      failed.push({ name: target.name, error: errorText(err) });
    }
  }
  return { ok, failed };
}

/** 批量清空表数据，逐个执行，失败不中断。 */
export async function emptyTables(args: {
  conn: ConnectionDto;
  database: string;
  tables: string[];
}): Promise<BatchResult> {
  const ok: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const table of args.tables) {
    try {
      await emptyTable({ conn: args.conn, database: args.database, table });
      ok.push(table);
    } catch (err) {
      failed.push({ name: table, error: errorText(err) });
    }
  }
  return { ok, failed };
}

/** 批量截断表，逐个执行，失败不中断。 */
export async function truncateTables(args: {
  conn: ConnectionDto;
  database: string;
  tables: string[];
}): Promise<BatchResult> {
  const ok: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const table of args.tables) {
    try {
      await truncateTable({ conn: args.conn, database: args.database, table });
      ok.push(table);
    } catch (err) {
      failed.push({ name: table, error: errorText(err) });
    }
  }
  return { ok, failed };
}

/** 批量操作结果的一句话摘要。 */
export function batchSummary(
  action: string,
  unit: string,
  result: BatchResult,
): string {
  if (result.failed.length === 0) {
    return `已${action} ${result.ok.length} 个${unit}`;
  }
  const detail = result.failed
    .slice(0, 3)
    .map((f) => `${f.name}: ${f.error}`)
    .join("；");
  return `已${action} ${result.ok.length} 个${unit}，失败 ${result.failed.length} 个（${detail}${
    result.failed.length > 3 ? " …" : ""
  }）`;
}

export async function renameTable(args: {
  conn: ConnectionDto;
  database: string;
  table: string;
  next: string;
  isView?: boolean;
}) {
  const { conn, database, table, next, isView } = args;
  if (!identOk(next)) {
    throw new Error("新名称仅允许字母、数字、下划线，且不能以数字开头");
  }
  await openConnection(conn.id);
  const e = engineKey(conn.engine);
  const qt = quoteTable(String(conn.engine), database, table);
  const qn = quoteIdent(String(conn.engine), next);
  if (isView) {
    if (e === "mysql") {
      // MySQL has no RENAME VIEW; recreate from DDL
      const ddl = await fetchCreateDdl({
        conn,
        database,
        table,
        isView: true,
      });
      const { rewriteCreateViewName } = await import(
        "../view-designer/viewDdl"
      );
      const nextDdl = rewriteCreateViewName(
        ddl,
        next,
        String(conn.engine),
        database,
      );
      await executeSql(conn.id, `DROP VIEW ${qt}`, database);
      await executeSql(conn.id, nextDdl, database);
      return;
    }
    if (e === "postgres" || e === "postgresql") {
      await executeSql(conn.id, `ALTER VIEW ${qt} RENAME TO ${qn}`, database);
      return;
    }
    // SQLite 3.25+
    await executeSql(conn.id, `ALTER VIEW ${qt} RENAME TO ${qn}`, database);
    return;
  }
  if (e === "postgres" || e === "postgresql") {
    await executeSql(conn.id, `ALTER TABLE ${qt} RENAME TO ${qn}`, database);
  } else if (e === "sqlite") {
    await executeSql(conn.id, `ALTER TABLE ${qt} RENAME TO ${qn}`, database);
  } else {
    const qnDb = quoteTable(String(conn.engine), database, next);
    await executeSql(conn.id, `RENAME TABLE ${qt} TO ${qnDb}`, database);
  }
}

export async function copyView(args: {
  conn: ConnectionDto;
  database: string;
  view: string;
  newName: string;
}) {
  const { conn, database, view, newName } = args;
  if (!identOk(newName)) {
    throw new Error("目标视图名仅允许字母、数字、下划线，且不能以数字开头");
  }
  if (newName === view) {
    throw new Error("目标视图名不能与源视图相同");
  }
  const ddl = await fetchCreateDdl({
    conn,
    database,
    table: view,
    isView: true,
  });
  const { rewriteCreateViewName } = await import("../view-designer/viewDdl");
  let nextDdl = rewriteCreateViewName(
    ddl,
    newName,
    String(conn.engine),
    database,
  );
  // Ensure OR REPLACE not required for fresh name; strip OR REPLACE for create
  nextDdl = nextDdl.replace(/\bOR\s+REPLACE\s+/i, "");
  await openConnection(conn.id);
  await executeSql(conn.id, nextDdl, database);
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
  // Postgres: keep the copy in the same schema as the source.
  const [schema] = splitQualified(table);
  const dstName = schema ? `${schema}.${newName}` : newName;
  const dst = quoteTable(String(conn.engine), database, dstName);

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
  if (e === "sqlite") return ["analyze"];
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
  } else if (e === "sqlite") {
    // SQLite has no per-table maintenance verbs; ANALYZE takes the table name.
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
