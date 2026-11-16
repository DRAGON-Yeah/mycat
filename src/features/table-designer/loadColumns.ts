import {
  executeSql,
  openConnection,
} from "../connections/sessionApi";
import { engineKey, quoteTable } from "../nav-tree/sqlIdent";
import {
  newColumn,
  parseRawType,
  type DesignerColumn,
  type DesignerCheck,
  type DesignerForeignKey,
  type DesignerIndex,
  type DesignerTrigger,
  type TableInfoStats,
  type TableOptions,
  emptyOptions,
} from "./types";

function colMap(columns: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  columns.forEach((c, i) => {
    m[c.toLowerCase()] = i;
  });
  return m;
}

function cell(row: unknown[], idx: number | undefined): string {
  if (idx == null || idx < 0) return "";
  const v = row[idx];
  if (v == null) return "";
  return String(v);
}

export async function loadDesignerColumns(args: {
  connectionId: string;
  engine: string;
  database: string;
  table: string;
}): Promise<DesignerColumn[]> {
  const { connectionId, engine, database, table } = args;
  await openConnection(connectionId);
  const e = engineKey(engine);

  if (e === "sqlite") {
    const out = await executeSql(
      connectionId,
      `PRAGMA table_info(${quoteTable(engine, null, table)})`,
    );
    return out.rows.map((row) => {
      const name = String(row[1] ?? "");
      const parsed = parseRawType(String(row[2] ?? "TEXT") || "TEXT");
      const notnull = Number(row[3] ?? 0) === 1;
      const dflt = row[4] == null ? null : String(row[4]);
      const pk = Number(row[5] ?? 0) > 0;
      return newColumn({
        name,
        typeName: parsed.typeName,
        length: parsed.length,
        decimals: parsed.decimals,
        notNull: notnull,
        isPk: pk,
        defaultValue: dflt,
        originalName: name,
      });
    });
  }

  if (e === "postgres" || e === "postgresql") {
    const sql = `SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale,
  is_nullable, column_default,
  (SELECT COUNT(*) FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
   WHERE tc.constraint_type = 'PRIMARY KEY'
     AND tc.table_name = c.table_name
     AND kcu.column_name = c.column_name) AS pk
FROM information_schema.columns c
WHERE table_name = '${table.replace(/'/g, "''")}'
  AND table_schema = current_schema()
ORDER BY ordinal_position`;
    const out = await executeSql(connectionId, sql);
    const m = colMap(out.columns);
    return out.rows.map((row) => {
      const name = cell(row, m.column_name);
      const typeName = cell(row, m.data_type) || "text";
      const length =
        cell(row, m.character_maximum_length) ||
        cell(row, m.numeric_precision) ||
        "";
      const decimals = cell(row, m.numeric_scale) || "";
      return newColumn({
        name,
        typeName,
        length,
        decimals,
        notNull: cell(row, m.is_nullable).toUpperCase() === "NO",
        isPk: Number(cell(row, m.pk) || 0) > 0,
        defaultValue: cell(row, m.column_default) || null,
        originalName: name,
      });
    });
  }

  const qt = quoteTable(engine, database, table);
  const out = await executeSql(connectionId, `SHOW FULL COLUMNS FROM ${qt}`);
  const m = colMap(out.columns);
  return out.rows.map((row) => {
    const name = cell(row, m.field);
    const parsed = parseRawType(cell(row, m.type) || "varchar(255)");
    const nullable = cell(row, m.null).toUpperCase() === "YES";
    const key = cell(row, m.key).toUpperCase();
    const dfltRaw = m.default != null ? row[m.default] : null;
    const dflt = dfltRaw == null ? null : String(dfltRaw);
    const extra = cell(row, m.extra);
    const virtual = /virtual|stored generated/i.test(extra);
    return newColumn({
      name,
      typeName: parsed.typeName,
      length: parsed.length,
      decimals: parsed.decimals,
      notNull: !nullable,
      virtual,
      isPk: key === "PRI",
      defaultValue: dflt,
      comment: cell(row, m.comment),
      originalName: name,
      extra,
    });
  });
}

export async function loadTableOptions(args: {
  connectionId: string;
  engine: string;
  database: string;
  table: string;
}): Promise<{ options: TableOptions; stats: TableInfoStats }> {
  const { connectionId, engine, database, table } = args;
  const emptyStats: TableInfoStats = {
    tableRows: "—",
    dataLength: "—",
    indexLength: "—",
    createTime: "—",
    updateTime: "—",
  };
  if (engineKey(engine) !== "mysql") {
    return { options: emptyOptions(), stats: emptyStats };
  }
  await openConnection(connectionId);
  const sql = `SELECT ENGINE, TABLE_COLLATION, ROW_FORMAT, AUTO_INCREMENT, TABLE_COMMENT,
  TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH,
  DATE_FORMAT(CREATE_TIME,'%Y-%m-%d %H:%i:%s'),
  DATE_FORMAT(UPDATE_TIME,'%Y-%m-%d %H:%i:%s'),
  AVG_ROW_LENGTH
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = '${database.replace(/'/g, "''")}'
  AND TABLE_NAME = '${table.replace(/'/g, "''")}'`;
  const out = await executeSql(connectionId, sql);
  const row = out.rows[0];
  if (!row) return { options: emptyOptions(), stats: emptyStats };
  const coll = String(row[1] ?? "utf8mb4_unicode_ci");
  const charset = coll.split("_")[0] || "utf8mb4";
  return {
    options: {
      engine: String(row[0] ?? "InnoDB"),
      charset,
      collation: coll,
      rowFormat: String(row[2] ?? "Dynamic"),
      autoIncrement: row[3] == null ? "" : String(row[3]),
      comment: String(row[4] ?? ""),
      avgRowLength: row[10] == null ? "" : String(row[10]),
    },
    stats: {
      tableRows: row[5] == null ? "—" : `${row[5]} (Est.)`,
      dataLength: formatBytes(Number(row[6] ?? 0)),
      indexLength: formatBytes(Number(row[7] ?? 0)),
      createTime: String(row[8] ?? "—"),
      updateTime: String(row[9] ?? "—"),
    },
  };
}

function formatBytes(n: number): string {
  if (!n || Number.isNaN(n)) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function loadDesignerIndexes(args: {
  connectionId: string;
  engine: string;
  database: string;
  table: string;
}): Promise<DesignerIndex[]> {
  const { connectionId, engine, database, table } = args;
  await openConnection(connectionId);
  if (engineKey(engine) !== "mysql") return [];
  const qt = quoteTable(engine, database, table);
  const out = await executeSql(connectionId, `SHOW INDEX FROM ${qt}`);
  const m = colMap(out.columns);
  const byName = new Map<string, DesignerIndex>();
  for (const row of out.rows) {
    const name = cell(row, m.key_name);
    if (!name) continue;
    const col = cell(row, m.column_name);
    const unique = Number(cell(row, m.non_unique) || 1) === 0;
    const indexType = cell(row, m.index_type) || "BTREE";
    const prev = byName.get(name);
    if (prev) {
      prev.columns = `${prev.columns}, ${col}`;
    } else {
      byName.set(name, {
        key: `ix-${name}`,
        name,
        columns: col,
        unique: name.toUpperCase() === "PRIMARY" ? true : unique,
        indexType,
        originalName: name,
      });
    }
  }
  return [...byName.values()];
}

export async function loadDesignerForeignKeys(args: {
  connectionId: string;
  engine: string;
  database: string;
  table: string;
}): Promise<DesignerForeignKey[]> {
  const { connectionId, engine, database, table } = args;
  if (engineKey(engine) !== "mysql") return [];
  await openConnection(connectionId);
  const sql = `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = '${database.replace(/'/g, "''")}'
  AND TABLE_NAME = '${table.replace(/'/g, "''")}'
  AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`;
  const out = await executeSql(connectionId, sql);
  const byName = new Map<string, DesignerForeignKey>();
  for (const row of out.rows) {
    const name = String(row[0] ?? "");
    const col = String(row[1] ?? "");
    const refTable = String(row[2] ?? "");
    const refCol = String(row[3] ?? "");
    const prev = byName.get(name);
    if (prev) {
      prev.columns = `${prev.columns}, ${col}`;
      prev.refColumns = `${prev.refColumns}, ${refCol}`;
    } else {
      byName.set(name, {
        key: `fk-${name}`,
        name,
        columns: col,
        refTable,
        refColumns: refCol,
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
        originalName: name,
      });
    }
  }
  // fill ON DELETE/UPDATE
  const rulesSql = `SELECT CONSTRAINT_NAME, UPDATE_RULE, DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = '${database.replace(/'/g, "''")}'
  AND TABLE_NAME = '${table.replace(/'/g, "''")}'`;
  try {
    const rules = await executeSql(connectionId, rulesSql);
    for (const row of rules.rows) {
      const name = String(row[0] ?? "");
      const fk = byName.get(name);
      if (fk) {
        fk.onUpdate = String(row[1] ?? "RESTRICT");
        fk.onDelete = String(row[2] ?? "RESTRICT");
      }
    }
  } catch {
    /* ignore */
  }
  return [...byName.values()];
}

export async function loadDesignerTriggers(args: {
  connectionId: string;
  engine: string;
  database: string;
  table: string;
}): Promise<DesignerTrigger[]> {
  const { connectionId, engine, database, table } = args;
  if (engineKey(engine) !== "mysql") return [];
  await openConnection(connectionId);
  const sql = `SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = '${database.replace(/'/g, "''")}'
  AND EVENT_OBJECT_TABLE = '${table.replace(/'/g, "''")}'`;
  const out = await executeSql(connectionId, sql);
  return out.rows.map((row) => ({
    key: `tr-${row[0]}`,
    name: String(row[0] ?? ""),
    timing: String(row[1] ?? "BEFORE"),
    event: String(row[2] ?? "INSERT"),
    statement: String(row[3] ?? ""),
    originalName: String(row[0] ?? ""),
  }));
}

export async function loadDesignerChecks(args: {
  connectionId: string;
  engine: string;
  database: string;
  table: string;
}): Promise<DesignerCheck[]> {
  const { connectionId, engine, database, table } = args;
  if (engineKey(engine) !== "mysql") return [];
  await openConnection(connectionId);
  const sql = `SELECT CONSTRAINT_NAME, CHECK_CLAUSE
FROM information_schema.CHECK_CONSTRAINTS cc
JOIN information_schema.TABLE_CONSTRAINTS tc
  ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
 AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
WHERE tc.TABLE_SCHEMA = '${database.replace(/'/g, "''")}'
  AND tc.TABLE_NAME = '${table.replace(/'/g, "''")}'
  AND tc.CONSTRAINT_TYPE = 'CHECK'`;
  try {
    const out = await executeSql(connectionId, sql);
    return out.rows.map((row) => ({
      key: `ck-${row[0]}`,
      name: String(row[0] ?? ""),
      expression: String(row[1] ?? ""),
      originalName: String(row[0] ?? ""),
    }));
  } catch {
    return [];
  }
}
