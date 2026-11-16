function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function tsvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildInsertSql(
  table: string,
  columns: string[],
  values: unknown[],
): string {
  const cols = columns.map((c) => `\`${c}\``).join(", ");
  const vals = values.map(sqlLiteral).join(", ");
  return `INSERT INTO \`${table}\` (${cols}) VALUES (${vals});`;
}

export function buildUpdateSql(
  table: string,
  columns: string[],
  values: unknown[],
  pkColumn: string,
  pkValue: unknown,
): string {
  const sets = columns
    .filter((c) => c !== pkColumn)
    .map((c) => {
      const idx = columns.indexOf(c);
      return `\`${c}\`=${sqlLiteral(values[idx])}`;
    })
    .join(", ");
  return `UPDATE \`${table}\` SET ${sets} WHERE \`${pkColumn}\`=${sqlLiteral(pkValue)};`;
}

export function buildTsvData(values: unknown[]): string {
  return values.map(tsvEscape).join("\t");
}

export function buildTsvHeaders(columns: string[]): string {
  return columns.join("\t");
}

export function buildTsvHeadersAndData(
  columns: string[],
  values: unknown[],
): string {
  return `${buildTsvHeaders(columns)}\n${buildTsvData(values)}`;
}

export function buildCsvData(values: unknown[]): string {
  return values.map(csvEscape).join(",");
}

export function buildCsvHeaders(columns: string[]): string {
  return columns.map((c) => csvEscape(c)).join(",");
}

export function buildCsvHeadersAndData(
  columns: string[],
  values: unknown[],
): string {
  return `${buildCsvHeaders(columns)}\n${buildCsvData(values)}`;
}

export function buildJsonRow(
  columns: string[],
  values: unknown[],
): string {
  const obj: Record<string, unknown> = {};
  columns.forEach((c, i) => {
    obj[c] = values[i] ?? null;
  });
  return JSON.stringify(obj, null, 2);
}
