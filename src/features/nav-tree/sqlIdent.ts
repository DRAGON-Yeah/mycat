/** Identifier quoting helpers for MySQL / Postgres / SQLite. */

export function engineKey(engine: string | undefined | null): string {
  return String(engine || "mysql").toLowerCase();
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

export function quoteTable(
  engine: string,
  database: string | null | undefined,
  table: string,
): string {
  const t = quoteIdent(engine, table);
  if (!database?.trim()) return t;
  return `${quoteIdent(engine, database.trim())}.${t}`;
}
