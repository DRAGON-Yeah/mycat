import {
  engineKey,
  identOk,
  isPostgres,
  quoteIdent,
  quoteTable,
  splitQualified,
} from "../nav-tree/sqlIdent";
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
    /^(NULL|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|TRUE|FALSE|NOW\(\))$/i.test(
      t,
    ) ||
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
  // Function calls (now(), nextval('s'::regclass), CURRENT_TIMESTAMP(3)) and
  // Postgres cast expressions ('x'::text) are already valid SQL.
  if (/^[A-Za-z_][\w.]*\s*\([\s\S]*\)$/.test(t) || t.includes("::")) {
    return t;
  }
  return sqlString(t);
}

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Table names may be schema-qualified for Postgres (`sales.orders`). */
function tableNameOk(name: string): boolean {
  const [, base] = splitQualified(name);
  return identOk(base);
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
  if (isPostgres(engine) && /identity/i.test(c.extra)) {
    const always = /always/i.test(c.extra);
    return `${quoteIdent(engine, c.name)} ${typ}${nullSql} GENERATED ${
      always ? "ALWAYS" : "BY DEFAULT"
    } AS IDENTITY`;
  }
  return `${quoteIdent(engine, c.name)} ${typ}${nullSql}${def}`;
}

function indexColumns(engine: string, columns: string): string {
  return columns
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((c) => quoteIdent(engine, c))
    .join(", ");
}

function fkClause(
  engine: string,
  database: string,
  fk: DesignerForeignKey,
): string | null {
  const cols = indexColumns(engine, fk.columns);
  const refs = indexColumns(engine, fk.refColumns);
  if (!cols || !fk.refTable.trim() || !refs) return null;
  const refTable = quoteTable(engine, database, fk.refTable);
  return `CONSTRAINT ${quoteIdent(engine, fk.name)} FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refs}) ON DELETE ${fk.onDelete || "RESTRICT"} ON UPDATE ${fk.onUpdate || "RESTRICT"}`;
}

/** Bare `CREATE TABLE ...;` statement (no indexes / comments appended). */
function createTableStatement(args: {
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
  if (!tableNameOk(table)) {
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
  const pg = isPostgres(engine);
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
      const cols = indexColumns("mysql", ix.columns);
      if (!cols) continue;
      const uniq = ix.unique ? "UNIQUE " : "";
      const using = (ix.indexType || "BTREE").toUpperCase();
      defs.push(
        `${uniq}INDEX ${quoteIdent("mysql", ix.name)}(${cols}) USING ${using}`,
      );
    }
  }

  // Foreign keys / checks are table constraints on MySQL, Postgres and SQLite.
  if ((e === "mysql" || pg || e === "sqlite") && foreignKeys) {
    for (const fk of foreignKeys) {
      if (!fk.name || !identOk(fk.name)) continue;
      const clause = fkClause(engine, database, fk);
      if (clause) defs.push(clause);
    }
  }

  if ((e === "mysql" || pg || e === "sqlite") && checks) {
    for (const ck of checks) {
      if (!ck.name || !identOk(ck.name) || !ck.expression.trim()) continue;
      defs.push(
        `CONSTRAINT ${quoteIdent(engine, ck.name)} CHECK (${ck.expression})`,
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
  sql += ";";

  return sql;
}

/** `CREATE [UNIQUE] INDEX ...` statements for SQLite (indexes are separate objects). */
function sqliteIndexStatements(
  table: string,
  indexes: DesignerIndex[] | undefined,
): string[] {
  const out: string[] = [];
  for (const ix of indexes ?? []) {
    if (!ix.name || ix.name.toUpperCase() === "PRIMARY") continue;
    if (!identOk(ix.name)) continue;
    const cols = indexColumns("sqlite", ix.columns);
    if (!cols) continue;
    const uniq = ix.unique ? "UNIQUE " : "";
    out.push(
      `CREATE ${uniq}INDEX ${quoteIdent("sqlite", ix.name)} ON ${quoteTable("sqlite", null, table)} (${cols});`,
    );
  }
  return out;
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
  const { engine, database, table, columns, indexes, options } = args;
  let sql = createTableStatement(args);
  const e = engineKey(engine);
  const qt = quoteTable(engine, database, table);

  if (e === "sqlite") {
    const extra = sqliteIndexStatements(table, indexes);
    if (extra.length) sql += `\n${extra.join("\n")}`;
    return sql;
  }

  if (isPostgres(engine)) {
    const extra: string[] = [];
    if (indexes) {
      for (const ix of indexes) {
        if (!ix.name || ix.name.toUpperCase() === "PRIMARY") continue;
        if (!identOk(ix.name)) continue;
        const cols = indexColumns("postgres", ix.columns);
        if (!cols) continue;
        const uniq = ix.unique ? "UNIQUE " : "";
        extra.push(
          `CREATE ${uniq}INDEX ${quoteIdent("postgres", ix.name)} ON ${qt} (${cols});`,
        );
      }
    }
    if (options?.comment?.trim()) {
      extra.push(
        `COMMENT ON TABLE ${qt} IS ${sqlString(options.comment.trim())};`,
      );
    }
    for (const c of columns) {
      if (c.comment?.trim()) {
        extra.push(
          `COMMENT ON COLUMN ${qt}.${quoteIdent("postgres", c.name)} IS ${sqlString(c.comment.trim())};`,
        );
      }
    }
    if (extra.length) sql += `\n${extra.join("\n")}`;
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
  const pg = isPostgres(engine);
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
        throw new Error("SQLite 删除列需要重建表（保存时会自动重建）");
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
      if (pg && c.comment?.trim()) {
        stmts.push(
          `COMMENT ON COLUMN ${qt}.${quoteIdent("postgres", c.name)} IS ${sqlString(c.comment.trim())}`,
        );
      }
      continue;
    }

    const renamed = prev.originalName !== c.name;
    const typeChanged = composedType(prev) !== composedType(c);
    const nullChanged = prev.notNull !== c.notNull;
    const defaultChanged =
      String(prev.defaultValue ?? "") !== String(c.defaultValue ?? "");
    const commentChanged = (prev.comment || "") !== (c.comment || "");
    const changed =
      typeChanged ||
      nullChanged ||
      defaultChanged ||
      commentChanged ||
      prev.virtual !== c.virtual ||
      prev.isPk !== c.isPk;

    if (e === "mysql") {
      if (renamed || changed) {
        stmts.push(
          `ALTER TABLE ${qt} CHANGE COLUMN ${quoteIdent("mysql", prev.originalName!)} ${colDefMysql(c)}`,
        );
      }
    } else if (pg) {
      if (renamed) {
        stmts.push(
          `ALTER TABLE ${qt} RENAME COLUMN ${quoteIdent("postgres", prev.originalName!)} TO ${quoteIdent("postgres", c.name)}`,
        );
      }
      const col = quoteIdent("postgres", c.name);
      if (typeChanged) {
        stmts.push(
          `ALTER TABLE ${qt} ALTER COLUMN ${col} TYPE ${composedType(c)} USING ${col}::${composedType(c)}`,
        );
      }
      if (nullChanged) {
        stmts.push(
          c.notNull
            ? `ALTER TABLE ${qt} ALTER COLUMN ${col} SET NOT NULL`
            : `ALTER TABLE ${qt} ALTER COLUMN ${col} DROP NOT NULL`,
        );
      }
      if (defaultChanged) {
        stmts.push(
          c.defaultValue == null || c.defaultValue === ""
            ? `ALTER TABLE ${qt} ALTER COLUMN ${col} DROP DEFAULT`
            : `ALTER TABLE ${qt} ALTER COLUMN ${col} SET DEFAULT ${formatDefault(c.defaultValue)}`,
        );
      }
      if (commentChanged) {
        stmts.push(
          c.comment?.trim()
            ? `COMMENT ON COLUMN ${qt}.${col} IS ${sqlString(c.comment.trim())}`
            : `COMMENT ON COLUMN ${qt}.${col} IS NULL`,
        );
      }
    } else if (renamed) {
      stmts.push(
        `ALTER TABLE ${qt} RENAME COLUMN ${quoteIdent("sqlite", prev.originalName!)} TO ${quoteIdent("sqlite", c.name)}`,
      );
    } else if (changed) {
      throw new Error(`SQLite 修改列「${c.name}」需要重建表（保存时会自动重建）`);
    }
  }

  // PK changes
  const oldPk = baseline
    .filter((c) => c.isPk)
    .map((c) => c.originalName || c.name)
    .join(",");
  const newPk = columns.filter((c) => c.isPk).map((c) => c.name).join(",");
  if (e === "mysql" && oldPk !== newPk) {
    if (oldPk) stmts.push(`ALTER TABLE ${qt} DROP PRIMARY KEY`);
    if (newPk) {
      const pkCols = columns
        .filter((c) => c.isPk)
        .map((c) => quoteIdent("mysql", c.name))
        .join(", ");
      stmts.push(`ALTER TABLE ${qt} ADD PRIMARY KEY (${pkCols})`);
    }
  } else if (pg && oldPk !== newPk) {
    const base = splitQualified(table)[1];
    if (oldPk) {
      stmts.push(
        `ALTER TABLE ${qt} DROP CONSTRAINT IF EXISTS ${quoteIdent("postgres", `${base}_pkey`)}`,
      );
    }
    if (newPk) {
      const pkCols = columns
        .filter((c) => c.isPk)
        .map((c) => quoteIdent("postgres", c.name))
        .join(", ");
      stmts.push(`ALTER TABLE ${qt} ADD PRIMARY KEY (${pkCols})`);
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

  if (pg && options && baselineOptions && options.comment !== baselineOptions.comment) {
    stmts.push(
      options.comment?.trim()
        ? `COMMENT ON TABLE ${qt} IS ${sqlString(options.comment.trim())}`
        : `COMMENT ON TABLE ${qt} IS NULL`,
    );
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
  if (isPostgres(engine)) {
    // Trigger names are not schema-qualified in Postgres.
    return `CREATE TRIGGER ${quoteIdent("postgres", trigger.name)} ${trigger.timing} ${trigger.event} ON ${qt} FOR EACH ROW ${trigger.statement}`;
  }
  const tn = quoteTable(engine, database, trigger.name);
  return `CREATE TRIGGER ${tn} ${trigger.timing} ${trigger.event} ON ${qt} FOR EACH ROW\n${trigger.statement}`;
}

export type ObjectSyncArgs = {
  engine: string;
  database: string;
  table: string;
  baselineIndexes: DesignerIndex[];
  indexes: DesignerIndex[];
  baselineFks: DesignerForeignKey[];
  fks: DesignerForeignKey[];
  baselineChecks: DesignerCheck[];
  checks: DesignerCheck[];
  baselineTriggers: DesignerTrigger[];
  triggers: DesignerTrigger[];
};

/**
 * Diff indexes / foreign keys / checks / triggers into DDL statements.
 * Supports MySQL and Postgres (Postgres uses DROP CONSTRAINT + separate indexes).
 */
export function buildObjectSyncSql(args: ObjectSyncArgs): string[] {
  const {
    engine,
    database,
    table,
    baselineIndexes,
    indexes,
    baselineFks,
    fks,
    baselineChecks,
    checks,
    baselineTriggers,
    triggers,
  } = args;
  const e = engineKey(engine);
  const pg = isPostgres(engine);
  if (e === "sqlite") {
    return sqliteObjectSyncSql(args);
  }
  if (e !== "mysql" && !pg) return [];

  const qt = quoteTable(engine, database, table);
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const stmts: string[] = [];
  const dropIndex = (name: string) =>
    pg
      ? `DROP INDEX IF EXISTS ${quoteIdent("postgres", name)}`
      : `DROP INDEX ${quoteIdent("mysql", name)} ON ${qt}`;
  const dropConstraint = (name: string) =>
    pg
      ? `ALTER TABLE ${qt} DROP CONSTRAINT IF EXISTS ${quoteIdent("postgres", name)}`
      : "";

  const baseIx = new Map(
    baselineIndexes
      .filter((i) => i.name.toUpperCase() !== "PRIMARY")
      .map((i) => [i.name, i]),
  );
  const wantIx = indexes.filter((i) => i.name.toUpperCase() !== "PRIMARY");
  const wantIxNames = new Set(wantIx.map((i) => i.name));
  for (const b of baseIx.values()) {
    if (!wantIxNames.has(b.name)) stmts.push(dropIndex(b.name));
  }
  for (const ix of wantIx) {
    if (!identOk(ix.name) || !ix.columns.trim()) continue;
    const cols = indexColumns(engine, ix.columns);
    if (!cols) continue;
    const old = baseIx.get(ix.name);
    const changed =
      !old ||
      norm(old.columns) !== norm(ix.columns) ||
      Boolean(old.unique) !== Boolean(ix.unique) ||
      (old.indexType || "BTREE").toUpperCase() !==
        (ix.indexType || "BTREE").toUpperCase();
    if (!changed) continue;
    if (old) stmts.push(dropIndex(ix.name));
    const uniq = ix.unique ? "UNIQUE " : "";
    stmts.push(
      `CREATE ${uniq}INDEX ${quoteIdent(engine, ix.name)} ON ${qt} (${cols})`,
    );
  }

  const baseFkMap = new Map(baselineFks.map((f) => [f.name, f]));
  const wantFkNames = new Set(fks.map((f) => f.name));
  for (const b of baselineFks) {
    if (wantFkNames.has(b.name)) continue;
    stmts.push(
      pg
        ? dropConstraint(b.name)
        : `ALTER TABLE ${qt} DROP FOREIGN KEY ${quoteIdent("mysql", b.name)}`,
    );
  }
  for (const fk of fks) {
    if (!identOk(fk.name) || !fk.refTable.trim()) continue;
    const old = baseFkMap.get(fk.name);
    const changed =
      !old ||
      norm(old.columns) !== norm(fk.columns) ||
      old.refTable !== fk.refTable ||
      norm(old.refColumns) !== norm(fk.refColumns) ||
      (old.onDelete || "RESTRICT") !== (fk.onDelete || "RESTRICT") ||
      (old.onUpdate || "RESTRICT") !== (fk.onUpdate || "RESTRICT");
    if (!changed) continue;
    if (old) {
      stmts.push(
        pg
          ? dropConstraint(fk.name)
          : `ALTER TABLE ${qt} DROP FOREIGN KEY ${quoteIdent("mysql", fk.name)}`,
      );
    }
    const clause = fkClause(engine, database, fk);
    if (clause) stmts.push(`ALTER TABLE ${qt} ADD ${clause}`);
  }

  const baseCkMap = new Map(baselineChecks.map((c) => [c.name, c]));
  const wantCkNames = new Set(checks.map((c) => c.name));
  for (const b of baselineChecks) {
    if (wantCkNames.has(b.name)) continue;
    stmts.push(
      pg
        ? dropConstraint(b.name)
        : `ALTER TABLE ${qt} DROP CHECK ${quoteIdent("mysql", b.name)}`,
    );
  }
  for (const ck of checks) {
    if (!identOk(ck.name) || !ck.expression.trim()) continue;
    const old = baseCkMap.get(ck.name);
    if (old && old.expression.trim() === ck.expression.trim()) continue;
    if (old) {
      stmts.push(
        pg
          ? dropConstraint(ck.name)
          : `ALTER TABLE ${qt} DROP CHECK ${quoteIdent("mysql", ck.name)}`,
      );
    }
    stmts.push(
      `ALTER TABLE ${qt} ADD CONSTRAINT ${quoteIdent(engine, ck.name)} CHECK (${ck.expression})`,
    );
  }

  const baseTrMap = new Map(baselineTriggers.map((x) => [x.name, x]));
  const wantTrNames = new Set(triggers.map((x) => x.name));
  const dropTrigger = (name: string) =>
    pg
      ? `DROP TRIGGER IF EXISTS ${quoteIdent("postgres", name)} ON ${qt}`
      : `DROP TRIGGER IF EXISTS ${quoteTable("mysql", database, name)}`;
  for (const b of baselineTriggers) {
    if (!wantTrNames.has(b.name)) stmts.push(dropTrigger(b.name));
  }
  for (const tr of triggers) {
    if (!tr.name.trim() || !tr.statement.trim()) continue;
    const old = baseTrMap.get(tr.name);
    if (
      old &&
      old.timing === tr.timing &&
      old.event === tr.event &&
      old.statement === tr.statement
    ) {
      continue;
    }
    if (old) stmts.push(dropTrigger(tr.name));
    stmts.push(buildTriggerSql({ engine, database, table, trigger: tr }));
  }

  return stmts.filter(Boolean);
}

/** SQLite: indexes and triggers are standalone objects; FKs/CHECKs need a rebuild. */
function sqliteObjectSyncSql(args: ObjectSyncArgs): string[] {
  const { table, baselineIndexes, indexes, baselineTriggers, triggers } = args;
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const qt = quoteTable("sqlite", null, table);
  const stmts: string[] = [];

  const baseIx = new Map(
    baselineIndexes
      .filter((i) => i.name.toUpperCase() !== "PRIMARY")
      .map((i) => [i.name, i]),
  );
  const wantIx = indexes.filter((i) => i.name.toUpperCase() !== "PRIMARY");
  const wantIxNames = new Set(wantIx.map((i) => i.name));
  for (const b of baseIx.values()) {
    if (!wantIxNames.has(b.name)) {
      stmts.push(`DROP INDEX IF EXISTS ${quoteIdent("sqlite", b.name)}`);
    }
  }
  for (const ix of wantIx) {
    if (!identOk(ix.name) || !ix.columns.trim()) continue;
    const cols = indexColumns("sqlite", ix.columns);
    if (!cols) continue;
    const old = baseIx.get(ix.name);
    const changed =
      !old ||
      norm(old.columns) !== norm(ix.columns) ||
      Boolean(old.unique) !== Boolean(ix.unique);
    if (!changed) continue;
    if (old) stmts.push(`DROP INDEX IF EXISTS ${quoteIdent("sqlite", ix.name)}`);
    const uniq = ix.unique ? "UNIQUE " : "";
    stmts.push(
      `CREATE ${uniq}INDEX ${quoteIdent("sqlite", ix.name)} ON ${qt} (${cols})`,
    );
  }

  const baseTr = new Map(baselineTriggers.map((x) => [x.name, x]));
  const wantTrNames = new Set(triggers.map((x) => x.name));
  for (const b of baselineTriggers) {
    if (!wantTrNames.has(b.name)) {
      stmts.push(`DROP TRIGGER IF EXISTS ${quoteIdent("sqlite", b.name)}`);
    }
  }
  for (const tr of triggers) {
    if (!tr.name.trim() || !tr.statement.trim()) continue;
    const old = baseTr.get(tr.name);
    if (
      old &&
      old.timing === tr.timing &&
      old.event === tr.event &&
      old.statement === tr.statement
    ) {
      continue;
    }
    if (old) stmts.push(`DROP TRIGGER IF EXISTS ${quoteIdent("sqlite", tr.name)}`);
    stmts.push(
      buildTriggerSql({ engine: "sqlite", database: "", table, trigger: tr }),
    );
  }
  return stmts;
}

/**
 * SQLite cannot ALTER a column definition, drop a column that is indexed /
 * constrained, or add FKs / CHECKs. Those changes need the documented
 * "12-step" table rebuild.
 */
export function sqliteNeedsRebuild(args: {
  baseline: DesignerColumn[];
  columns: DesignerColumn[];
  baselineFks: DesignerForeignKey[];
  fks: DesignerForeignKey[];
  baselineChecks: DesignerCheck[];
  checks: DesignerCheck[];
}): boolean {
  const { baseline, columns, baselineFks, fks, baselineChecks, checks } = args;
  const kept = new Set(
    columns.filter((c) => c.originalName).map((c) => c.originalName!),
  );
  for (const b of baseline) {
    if (b.originalName && !kept.has(b.originalName)) return true; // dropped
  }
  for (const c of columns) {
    if (!c.originalName) continue;
    const prev = baseline.find((b) => b.originalName === c.originalName);
    if (!prev) continue;
    if (
      prev.name !== c.name ||
      composedType(prev) !== composedType(c) ||
      prev.notNull !== c.notNull ||
      String(prev.defaultValue ?? "") !== String(c.defaultValue ?? "") ||
      prev.isPk !== c.isPk
    ) {
      return true;
    }
  }
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const fkKey = (f: DesignerForeignKey) =>
    `${f.name}|${norm(f.columns)}|${f.refTable}|${norm(f.refColumns)}|${f.onDelete}|${f.onUpdate}`;
  const baseFk = new Set(baselineFks.map(fkKey));
  const wantFk = new Set(fks.map(fkKey));
  if (baseFk.size !== wantFk.size) return true;
  for (const k of wantFk) if (!baseFk.has(k)) return true;
  const ckKey = (c: DesignerCheck) => `${c.name}|${norm(c.expression)}`;
  const baseCk = new Set(baselineChecks.map(ckKey));
  const wantCk = new Set(checks.map(ckKey));
  if (baseCk.size !== wantCk.size) return true;
  for (const k of wantCk) if (!baseCk.has(k)) return true;
  return false;
}

/** Full rebuild script: create shadow table, copy data, swap, restore indexes/triggers. */
export function buildSqliteRebuildSql(args: {
  engine: string;
  database: string;
  table: string;
  columns: DesignerColumn[];
  indexes?: DesignerIndex[];
  foreignKeys?: DesignerForeignKey[];
  checks?: DesignerCheck[];
  triggers?: DesignerTrigger[];
}): string {
  const { table, columns, indexes, foreignKeys, checks, triggers } = args;
  const base = splitQualified(table)[1];
  const tmp = `${base}__mycat_new`;
  const q = (n: string) => quoteIdent("sqlite", n);
  const pairs = columns
    .filter((c) => c.originalName)
    .map((c) => ({ to: c.name, from: c.originalName! }));

  const lines: string[] = [
    "PRAGMA foreign_keys=off;",
    "BEGIN;",
    `DROP TABLE IF EXISTS ${q(tmp)};`,
    createTableStatement({
      engine: "sqlite",
      database: "",
      table: tmp,
      columns,
      foreignKeys,
      checks,
    }),
  ];
  if (pairs.length > 0) {
    lines.push(
      `INSERT INTO ${q(tmp)} (${pairs.map((p) => q(p.to)).join(", ")}) SELECT ${pairs
        .map((p) => q(p.from))
        .join(", ")} FROM ${q(base)};`,
    );
  }
  lines.push(
    `DROP TABLE ${q(base)};`,
    `ALTER TABLE ${q(tmp)} RENAME TO ${q(base)};`,
    ...sqliteIndexStatements(base, indexes),
    ...(triggers ?? [])
      .filter((t) => t.name.trim() && t.statement.trim())
      .map(
        (t) =>
          `${buildTriggerSql({ engine: "sqlite", database: "", table: base, trigger: t })};`,
      ),
    "COMMIT;",
    "PRAGMA foreign_keys=on;",
  );
  return lines.join("\n");
}
