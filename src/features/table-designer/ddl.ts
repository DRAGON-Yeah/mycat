import { engineKey, identOk, quoteIdent, quoteTable } from "../nav-tree/sqlIdent";
import type { DesignerColumn } from "./types";

function colDefMysql(c: DesignerColumn): string {
  const nullSql = c.nullable ? "NULL" : "NOT NULL";
  const def =
    c.defaultValue == null || c.defaultValue === ""
      ? ""
      : ` DEFAULT ${formatDefault(c.defaultValue)}`;
  const comment =
    c.comment && c.comment.trim()
      ? ` COMMENT ${sqlString(c.comment.trim())}`
      : "";
  return `${quoteIdent("mysql", c.name)} ${c.rawType} ${nullSql}${def}${comment}`;
}

function colDefPg(c: DesignerColumn): string {
  const nullSql = c.nullable ? "" : " NOT NULL";
  const def =
    c.defaultValue == null || c.defaultValue === ""
      ? ""
      : ` DEFAULT ${formatDefault(c.defaultValue)}`;
  return `${quoteIdent("postgres", c.name)} ${c.rawType}${nullSql}${def}`;
}

function colDefSqlite(c: DesignerColumn): string {
  const nullSql = c.nullable ? "" : " NOT NULL";
  const def =
    c.defaultValue == null || c.defaultValue === ""
      ? ""
      : ` DEFAULT ${formatDefault(c.defaultValue)}`;
  return `${quoteIdent("sqlite", c.name)} ${c.rawType}${nullSql}${def}`;
}

function formatDefault(v: string): string {
  const t = v.trim();
  if (
    /^(NULL|CURRENT_TIMESTAMP|CURRENT_DATE|TRUE|FALSE)$/i.test(t) ||
    /^-?\d+(\.\d+)?$/.test(t)
  ) {
    return t;
  }
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"'))
  ) {
    return t;
  }
  return sqlString(t);
}

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function buildCreateTableSql(args: {
  engine: string;
  database: string;
  table: string;
  columns: DesignerColumn[];
}): string {
  const { engine, database, table, columns } = args;
  if (!identOk(table)) {
    throw new Error("表名仅允许字母、数字、下划线");
  }
  if (columns.length === 0) {
    throw new Error("至少需要一列");
  }
  for (const c of columns) {
    if (!identOk(c.name)) {
      throw new Error(`非法列名: ${c.name}`);
    }
    if (!c.rawType.trim()) {
      throw new Error(`列 ${c.name} 缺少类型`);
    }
  }
  const e = engineKey(engine);
  const qt = quoteTable(engine, database, table);
  const defs =
    e === "postgres" || e === "postgresql"
      ? columns.map(colDefPg)
      : e === "sqlite"
        ? columns.map(colDefSqlite)
        : columns.map(colDefMysql);
  const pks = columns.filter((c) => c.isPk).map((c) => quoteIdent(engine, c.name));
  if (pks.length > 0) {
    defs.push(`PRIMARY KEY (${pks.join(", ")})`);
  }
  return `CREATE TABLE ${qt} (\n  ${defs.join(",\n  ")}\n)`;
}

export function buildAlterTableSql(args: {
  engine: string;
  database: string;
  table: string;
  baseline: DesignerColumn[];
  columns: DesignerColumn[];
}): string[] {
  const { engine, database, table, baseline, columns } = args;
  const e = engineKey(engine);
  const qt = quoteTable(engine, database, table);
  const stmts: string[] = [];
  const baseByKey = new Map(baseline.map((c) => [c.key, c]));
  const baseByOrig = new Map(
    baseline.filter((c) => c.originalName).map((c) => [c.originalName!, c]),
  );
  const keptOrig = new Set(
    columns.filter((c) => c.originalName).map((c) => c.originalName!),
  );

  // drops
  for (const b of baseline) {
    if (b.originalName && !keptOrig.has(b.originalName)) {
      if (e === "sqlite") {
        throw new Error("SQLite 不支持直接 DROP COLUMN（请用手写迁移）");
      }
      stmts.push(
        `ALTER TABLE ${qt} DROP COLUMN ${quoteIdent(engine, b.originalName)}`,
      );
    }
  }

  for (const c of columns) {
    if (!identOk(c.name)) {
      throw new Error(`非法列名: ${c.name}`);
    }
    if (!c.rawType.trim()) {
      throw new Error(`列 ${c.name} 缺少类型`);
    }

    const prev = c.originalName
      ? baseByOrig.get(c.originalName)
      : baseByKey.get(c.key);

    if (!c.originalName || !prev) {
      // ADD
      if (e === "mysql") {
        stmts.push(`ALTER TABLE ${qt} ADD COLUMN ${colDefMysql(c)}`);
      } else if (e === "postgres" || e === "postgresql") {
        stmts.push(`ALTER TABLE ${qt} ADD COLUMN ${colDefPg(c)}`);
      } else {
        stmts.push(`ALTER TABLE ${qt} ADD COLUMN ${colDefSqlite(c)}`);
      }
      continue;
    }

    const renamed = prev.originalName && prev.originalName !== c.name;
    const changed =
      prev.rawType !== c.rawType ||
      prev.nullable !== c.nullable ||
      String(prev.defaultValue ?? "") !== String(c.defaultValue ?? "") ||
      (prev.comment || "") !== (c.comment || "");

    if (e === "mysql") {
      if (renamed || changed) {
        stmts.push(
          `ALTER TABLE ${qt} CHANGE COLUMN ${quoteIdent("mysql", prev.originalName!)} ${colDefMysql(c)}`,
        );
      }
    } else if (e === "postgres" || e === "postgresql") {
      if (renamed) {
        stmts.push(
          `ALTER TABLE ${qt} RENAME COLUMN ${quoteIdent("postgres", prev.originalName!)} TO ${quoteIdent("postgres", c.name)}`,
        );
      }
      if (changed) {
        stmts.push(
          `ALTER TABLE ${qt} ALTER COLUMN ${quoteIdent("postgres", c.name)} TYPE ${c.rawType}`,
        );
        stmts.push(
          c.nullable
            ? `ALTER TABLE ${qt} ALTER COLUMN ${quoteIdent("postgres", c.name)} DROP NOT NULL`
            : `ALTER TABLE ${qt} ALTER COLUMN ${quoteIdent("postgres", c.name)} SET NOT NULL`,
        );
        if (c.defaultValue == null || c.defaultValue === "") {
          stmts.push(
            `ALTER TABLE ${qt} ALTER COLUMN ${quoteIdent("postgres", c.name)} DROP DEFAULT`,
          );
        } else {
          stmts.push(
            `ALTER TABLE ${qt} ALTER COLUMN ${quoteIdent("postgres", c.name)} SET DEFAULT ${formatDefault(c.defaultValue)}`,
          );
        }
      }
    } else {
      // sqlite: limited
      if (renamed) {
        stmts.push(
          `ALTER TABLE ${qt} RENAME COLUMN ${quoteIdent("sqlite", prev.originalName!)} TO ${quoteIdent("sqlite", c.name)}`,
        );
      }
      if (changed && !renamed) {
        throw new Error(
          `SQLite 无法直接修改列「${c.name}」的类型/可空/默认值，请用手写 SQL`,
        );
      }
    }
  }

  return stmts;
}
