export type EditorKind =
  | "text"
  | "number"
  | "bool"
  | "date"
  | "time"
  | "datetime"
  | "enum";

export type ColumnExtra = {
  /** Raw MySQL/PG type string from SHOW COLUMNS / information_schema, e.g. enum('a','b') */
  rawType?: string;
  enumValues?: string[];
  nullable?: boolean;
};

export function classifyEditor(
  dataType: string,
  extra?: ColumnExtra | null,
): EditorKind {
  const t = `${dataType} ${extra?.rawType ?? ""}`.toLowerCase();
  if (t.includes("enum(") || t.includes("mysql_type_enum") || /\benum\b/.test(t)) {
    return "enum";
  }
  if (/\btinyint\s*\(\s*1\s*\)/.test(t) || t.includes("bool") || t.includes("boolean")) {
    return "bool";
  }
  if (
    t.includes("datetime") ||
    t.includes("timestamp") ||
    t.includes("mysql_type_datetime") ||
    t.includes("mysql_type_timestamp")
  ) {
    return "datetime";
  }
  if (
    (t.includes("mysql_type_date") || /\bdate\b/.test(t)) &&
    !t.includes("time") &&
    !t.includes("stamp")
  ) {
    return "date";
  }
  if (
    t.includes("mysql_type_time") ||
    (/\btime\b/.test(t) && !t.includes("date") && !t.includes("stamp"))
  ) {
    return "time";
  }
  if (
    t.includes("int") ||
    t.includes("decimal") ||
    t.includes("numeric") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("year")
  ) {
    return "number";
  }
  return "text";
}

/** Parse `enum('a','b','c')` or `set('x','y')` → values */
export function parseEnumValues(rawType: string): string[] {
  const m = rawType.match(/^(?:enum|set)\s*\((.*)\)\s*$/i);
  if (!m) return [];
  const inner = m[1] ?? "";
  const values: string[] = [];
  const re = /'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)"/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(inner))) {
    const raw = hit[1] ?? hit[2] ?? "";
    values.push(raw.replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
  return values;
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Format Date → `YYYY-MM-DD HH:mm:ss` */
export function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatDateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatTimeOnly(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function parseDateTimeValue(
  raw: string | null | undefined,
): Date | null {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim().replace(/\//g, "-");
  // YYYY-MM-DD HH:mm:ss or YYYY-MM-DDTHH:mm:ss
  const m = s.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
  );
  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    );
  }
  const t = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (t) {
    const d = new Date();
    d.setHours(Number(t[1]), Number(t[2]), Number(t[3] ?? 0), 0);
    return d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse SHOW FULL COLUMNS / information_schema rows into extras by field name */
export function extrasFromShowColumns(
  columns: string[],
  rows: unknown[][],
): Record<string, ColumnExtra> {
  const idx = (name: string) =>
    columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());
  const iField = idx("Field") >= 0 ? idx("Field") : idx("column_name");
  const iType = idx("Type") >= 0 ? idx("Type") : idx("column_type");
  const iNull = idx("Null") >= 0 ? idx("Null") : idx("is_nullable");
  if (iField < 0 || iType < 0) return {};
  const map: Record<string, ColumnExtra> = {};
  for (const row of rows) {
    const name = String(row[iField] ?? "");
    const rawType = String(row[iType] ?? "");
    if (!name) continue;
    const nullRaw = iNull >= 0 ? String(row[iNull] ?? "") : "YES";
    map[name] = {
      rawType,
      enumValues: parseEnumValues(rawType),
      nullable: /^(yes|y|1)$/i.test(nullRaw),
    };
  }
  return map;
}
