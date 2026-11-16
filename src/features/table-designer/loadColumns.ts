import {
  executeSql,
  openConnection,
} from "../connections/sessionApi";
import { engineKey, quoteTable } from "../nav-tree/sqlIdent";
import { newColumn, type DesignerColumn } from "./types";

function colMap(columns: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  columns.forEach((c, i) => {
    m[c.toLowerCase()] = i;
  });
  return m;
}

function cell(row: unknown[], idx: number | undefined): string {
  if (idx == null) return "";
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
    // cid, name, type, notnull, dflt_value, pk
    return out.rows.map((row) => {
      const name = String(row[1] ?? "");
      const rawType = String(row[2] ?? "TEXT") || "TEXT";
      const notnull = Number(row[3] ?? 0) === 1;
      const dflt = row[4] == null ? null : String(row[4]);
      const pk = Number(row[5] ?? 0) > 0;
      return newColumn({
        name,
        rawType,
        nullable: !notnull,
        isPk: pk,
        defaultValue: dflt,
        originalName: name,
      });
    });
  }

  if (e === "postgres" || e === "postgresql") {
    const sql = `SELECT column_name, data_type, is_nullable, column_default,
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
      const rawType = cell(row, m.data_type) || "text";
      const nullable = cell(row, m.is_nullable).toUpperCase() !== "NO";
      const dflt = cell(row, m.column_default) || null;
      const pk = Number(cell(row, m.pk) || 0) > 0;
      return newColumn({
        name,
        rawType,
        nullable,
        isPk: pk,
        defaultValue: dflt,
        originalName: name,
      });
    });
  }

  // MySQL
  const qt = quoteTable(engine, database, table);
  const out = await executeSql(connectionId, `SHOW FULL COLUMNS FROM ${qt}`);
  const m = colMap(out.columns);
  return out.rows.map((row) => {
    const name = cell(row, m.field ?? m.Field);
    const rawType = cell(row, m.type ?? m.Type) || "varchar(255)";
    const nullable =
      cell(row, m.null ?? m.Null).toUpperCase() === "YES";
    const key = cell(row, m.key ?? m.Key).toUpperCase();
    const dfltRaw = row[m.default ?? m.Default ?? -1];
    const dflt = dfltRaw == null ? null : String(dfltRaw);
    const comment = cell(row, m.comment ?? m.Comment);
    return newColumn({
      name,
      rawType,
      nullable,
      isPk: key === "PRI",
      defaultValue: dflt,
      comment,
      originalName: name,
    });
  });
}
