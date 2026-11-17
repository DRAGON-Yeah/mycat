/** Identifier quoting helpers for MySQL / Postgres / SQLite. */

export function engineKey(engine: string | undefined | null): string {
  return String(engine || "mysql").toLowerCase();
}

export function isPostgres(engine: string | undefined | null): boolean {
  const e = engineKey(engine);
  return e === "postgres" || e === "postgresql";
}

export function identOk(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function quoteIdent(engine: string, name: string): string {
  const e = engineKey(engine);
  if (e === "postgres" || e === "postgresql") {
    return `"${name.replace(/"/g, '""')}"`;
  }
  return `\`${name.replace(/`/g, "``")}\``;
}

/**
 * Split `schema.table` as produced by the Postgres object browser.
 * Returns `[schema, name]`; schema is null for plain names.
 */
export function splitQualified(name: string): [string | null, string] {
  const trimmed = name.trim();
  const idx = trimmed.indexOf(".");
  if (idx <= 0 || idx === trimmed.length - 1) return [null, trimmed];
  return [trimmed.slice(0, idx), trimmed.slice(idx + 1)];
}

/** Schema part of a possibly qualified object name (Postgres). */
export function schemaOf(name: string | null | undefined): string | null {
  if (!name) return null;
  return splitQualified(name)[0];
}

/** Unqualified object name. */
export function baseName(name: string | null | undefined): string {
  if (!name) return "";
  return splitQualified(name)[1];
}

/**
 * Quote a table reference.
 *
 * MySQL qualifies with the database (`db`.`table`). Postgres cannot cross
 * databases, so the database argument is ignored there and a `schema.table`
 * name is quoted part by part instead. SQLite's "database" is the file itself,
 * so it is never used as a qualifier either.
 */
export function quoteTable(
  engine: string,
  database: string | null | undefined,
  table: string,
): string {
  const e = engineKey(engine);
  const t = table.trim();
  if (e === "postgres" || e === "postgresql") {
    const [schema, name] = splitQualified(t);
    return schema
      ? `${quoteIdent(engine, schema)}.${quoteIdent(engine, name)}`
      : quoteIdent(engine, name);
  }
  const q = quoteIdent(engine, t);
  if (e === "sqlite" || !database?.trim()) return q;
  return `${quoteIdent(engine, database.trim())}.${q}`;
}
