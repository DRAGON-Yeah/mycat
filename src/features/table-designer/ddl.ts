import { engineKey, identOk, quoteIdent, quoteTable } from "../nav-tree/sqlIdent";
import {
  composedType,
  type DesignerCheck,
  type DesignerColumn,
  type DesignerForeignKey,
  type DesignerIndex,
  type DesignerTrigger,
  type TableOptions,
} from "./types";

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

function colDefMysql(c: DesignerColumn): string {
  const typ = composedType(c);
  const nullSql = c.notNull ? "NOT NULL" : "NULL";
  const def =
    c.defaultValue == null || c.defaultValue === ""
      ? ""
      : ` DEFAULT ${formatDefault(c.defaultValue)}`;
  const comment =
    c.comment && c.comment.trim()
      ? ` COMMENT ${sqlString(c.comment.trim())}`
      : "";
  // Virtual/generated columns need an expression; flag alone is preserved in UI only.
  const extra =
    !c.virtual && /auto_increment/i.test(c.extra) ? " AUTO_INCREMENT" : "";
  return `${quoteIdent("mysql", c.name)} ${typ} ${nullSql}${def}${extra}${comment}`;
}

function colDefGeneric(engine: string, c: DesignerColumn): string {
  const typ = composedType(c);
  const nullSql = c.notNull ? " NOT NULL" : "";
  const def =
    c.defaultValue == null || c.defaultValue === ""
      ? ""
      : ` DEFAULT ${formatDefault(c.defaultValue)}`;
  return `${quoteIdent(engine, c.name)} ${typ}${nullSql}${def}`;
}

export function buildCreateTableSql(args: {
  engine: string;
  database: string;
  table: string;
  columns: DesignerColumn[];
  indexes?: DesignerIndex[];
  foreignKeys?: DesignerForeignKey[];
  checks?: DesignerCheck[];
  options?: TableOptions;
}): string {
  const { engine, database, table, columns, indexes, foreignKeys, checks, options } =
    args;
  if (!identOk(table)) {
    throw new Error("表名仅允许字母、数字、下划线");
  }
  if (columns.length === 0) {
    throw new Error("至少需要一列");
  }
  for (const c of columns) {
    if (!identOk(c.name)) throw new Error(`非法列名: ${c.name}`);
    if (!c.typeName.trim()) throw new Error(`列 ${c.name} 缺少类型`);
  }
  const e = engineKey(engine);
  const qt = quoteTable(engine, database, table);
  const defs =
    e === "mysql"
      ? columns.map(colDefMysql)
      : columns.map((c) => colDefGeneric(engine, c));

  const pks = columns.filter((c) => c.isPk).map((c) => quoteIdent(engine, c.name));
  if (pks.length > 0) {
    defs.push(`PRIMARY KEY (${pks.join(", ")})`);
  }

  if (e === "mysql" && indexes) {
    for (const ix of indexes) {
      if (!ix.name || ix.name.toUpperCase() === "PRIMARY") continue;
      if (!identOk(ix.name)) continue;
      const cols = ix.columns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((c) => quoteIdent("mysql", c))
        .join(", ");
      if (!cols) continue;
      const uniq = ix.unique ? "UNIQUE " : "";
      const using = (ix.indexType || "BTREE").toUpperCase();
      defs.push(
        `${uniq}INDEX ${quoteIdent("mysql", ix.name)}(${cols}) USING ${using}`,
      );
    }
  }

  if (e === "mysql" && foreignKeys) {
    for (const fk of foreignKeys) {
      if (!fk.name || !identOk(fk.name)) continue;
      const cols = fk.columns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((c) => quoteIdent("mysql", c))
        .join(", ");
      const refs = fk.refColumns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((c) => quoteIdent("mysql", c))
        .join(", ");
      if (!cols || !fk.refTable || !refs) continue;
      const refTable = quoteTable("mysql", database, fk.refTable);
      defs.push(
        `CONSTRAINT ${quoteIdent("mysql", fk.name)} FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refs}) ON DELETE ${fk.onDelete || "RESTRICT"} ON UPDATE ${fk.onUpdate || "RESTRICT"}`,
      );
    }
  }

  if (e === "mysql" && checks) {
    for (const ck of checks) {
      if (!ck.name || !identOk(ck.name) || !ck.expression.trim()) continue;
      defs.push(
        `CONSTRAINT ${quoteIdent("mysql", ck.name)} CHECK (${ck.expression})`,
      );
    }
  }

  let sql = `CREATE TABLE ${qt} (\n  ${defs.join(",\n  ")}\n)`;
  if (e === "mysql" && options) {
    // Navicat-style table options (spaced KEY = value).
    const parts: string[] = [];
    if (options.engine) parts.push(`ENGINE = ${options.engine}`);
    if (options.autoIncrement) {
      parts.push(`AUTO_INCREMENT = ${options.autoIncrement}`);
    }
    if (options.charset) parts.push(`CHARACTER SET = ${options.charset}`);
    if (options.collation) parts.push(`COLLATE = ${options.collation}`);
    if (options.rowFormat) parts.push(`ROW_FORMAT = ${options.rowFormat}`);
    if (options.comment) {
      parts.push(`COMMENT = ${sqlString(options.comment)}`);
    }
    if (parts.length) sql += `\n${parts.join("\n")}`;
  }
  return sql;
}

export function buildAlterTableSql(args: {
  engine: string;
  database: string;
  table: string;
  baseline: DesignerColumn[];
  columns: DesignerColumn[];
  options?: TableOptions;
  baselineOptions?: TableOptions;
}): string[] {
  const { engine, database, table, baseline, columns, options, baselineOptions } =
    args;
  const e = engineKey(engine);
  const qt = quoteTable(engine, database, table);
  const stmts: string[] = [];
  const baseByOrig = new Map(
    baseline.filter((c) => c.originalName).map((c) => [c.originalName!, c]),
  );
  const keptOrig = new Set(
    columns.filter((c) => c.originalName).map((c) => c.originalName!),
  );

  for (const b of baseline) {
    if (b.originalName && !keptOrig.has(b.originalName)) {
      if (e === "sqlite") {
        throw new Error("SQLite 不支持直接 DROP COLUMN");
      }
      stmts.push(
        `ALTER TABLE ${qt} DROP COLUMN ${quoteIdent(engine, b.originalName)}`,
      );
    }
  }

  for (const c of columns) {
    if (!identOk(c.name)) throw new Error(`非法列名: ${c.name}`);
    if (!c.typeName.trim()) throw new Error(`列 ${c.name} 缺少类型`);

    const prev = c.originalName ? baseByOrig.get(c.originalName) : undefined;
    if (!c.originalName || !prev) {
      if (e === "mysql") {
        stmts.push(`ALTER TABLE ${qt} ADD COLUMN ${colDefMysql(c)}`);
      } else {
        stmts.push(
          `ALTER TABLE ${qt} ADD COLUMN ${colDefGeneric(engine, c)}`,
        );
      }
      continue;
    }

    const renamed = prev.originalName !== c.name;
    const changed =
      composedType(prev) !== composedType(c) ||
      prev.notNull !== c.notNull ||
      String(prev.defaultValue ?? "") !== String(c.defaultValue ?? "") ||
      (prev.comment || "") !== (c.comment || "") ||
      prev.virtual !== c.virtual ||
      prev.isPk !== c.isPk;

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
          `ALTER TABLE ${qt} ALTER COLUMN ${quoteIdent("postgres", c.name)} TYPE ${composedType(c)}`,
        );
        stmts.push(
          c.notNull
            ? `ALTER TABLE ${qt} ALTER COLUMN ${quoteIdent("postgres", c.name)} SET NOT NULL`
            : `ALTER TABLE ${qt} ALTER COLUMN ${quoteIdent("postgres", c.name)} DROP NOT NULL`,
        );
      }
    } else if (renamed) {
      stmts.push(
        `ALTER TABLE ${qt} RENAME COLUMN ${quoteIdent("sqlite", prev.originalName!)} TO ${quoteIdent("sqlite", c.name)}`,
      );
    } else if (changed) {
      throw new Error(`SQLite 无法直接修改列「${c.name}」`);
    }
  }

  // PK changes (MySQL): drop/add primary key if set changed
  if (e === "mysql") {
    const oldPk = baseline
      .filter((c) => c.isPk)
      .map((c) => c.originalName || c.name)
      .join(",");
    const newPk = columns.filter((c) => c.isPk).map((c) => c.name).join(",");
    if (oldPk !== newPk) {
      if (oldPk) stmts.push(`ALTER TABLE ${qt} DROP PRIMARY KEY`);
      if (newPk) {
        const pkCols = columns
          .filter((c) => c.isPk)
          .map((c) => quoteIdent("mysql", c.name))
          .join(", ");
        stmts.push(`ALTER TABLE ${qt} ADD PRIMARY KEY (${pkCols})`);
      }
    }
  }

  if (e === "mysql" && options && baselineOptions) {
    const parts: string[] = [];
    if (options.engine !== baselineOptions.engine && options.engine) {
      parts.push(`ENGINE=${options.engine}`);
    }
    if (
      options.autoIncrement !== baselineOptions.autoIncrement &&
      options.autoIncrement
    ) {
      parts.push(`AUTO_INCREMENT=${options.autoIncrement}`);
    }
    if (options.charset !== baselineOptions.charset && options.charset) {
      parts.push(`DEFAULT CHARSET=${options.charset}`);
    }
    if (
      options.collation !== baselineOptions.collation &&
      options.collation
    ) {
      parts.push(`COLLATE=${options.collation}`);
    }
    if (options.rowFormat !== baselineOptions.rowFormat && options.rowFormat) {
      parts.push(`ROW_FORMAT=${options.rowFormat}`);
    }
    if (options.comment !== baselineOptions.comment) {
      parts.push(`COMMENT=${sqlString(options.comment || "")}`);
    }
    if (parts.length) {
      stmts.push(`ALTER TABLE ${qt} ${parts.join(" ")}`);
    }
  }

  return stmts;
}

export function buildTriggerSql(args: {
  engine: string;
  database: string;
  table: string;
  trigger: DesignerTrigger;
}): string {
  const { engine, database, table, trigger } = args;
  const qt = quoteTable(engine, database, table);
  const tn = quoteTable(engine, database, trigger.name);
  return `CREATE TRIGGER ${tn} ${trigger.timing} ${trigger.event} ON ${qt} FOR EACH ROW\n${trigger.statement}`;
}
