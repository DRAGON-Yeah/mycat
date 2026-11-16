/** Split SQL script into executable statements (respects quotes / comments). */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1] ?? "";

    if (inLineComment) {
      buf += ch;
      if (ch === "\n") inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (ch === "*" && next === "/") {
        buf += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i += 1;
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "-" && next === "-") {
        inLineComment = true;
        buf += ch;
        i += 1;
        continue;
      }
      if (ch === "#") {
        inLineComment = true;
        buf += ch;
        i += 1;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        buf += ch;
        i += 1;
        continue;
      }
      if (ch === ";") {
        const stmt = buf.trim();
        if (stmt) out.push(stmt);
        buf = "";
        i += 1;
        continue;
      }
    }

    if (ch === "'" && !inDouble && !inBacktick) {
      if (inSingle && next === "'") {
        buf += "''";
        i += 2;
        continue;
      }
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
    } else if (ch === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
    }

    buf += ch;
    i += 1;
  }

  const last = buf.trim();
  if (last) out.push(last);
  return out;
}

export type StatementRange = {
  sql: string;
  startOffset: number;
  endOffset: number;
};

/** Map statements back to offsets in the original script (approx). */
export function splitSqlWithRanges(sql: string): StatementRange[] {
  const statements = splitSqlStatements(sql);
  const ranges: StatementRange[] = [];
  let searchFrom = 0;
  for (const stmt of statements) {
    const idx = sql.indexOf(stmt, searchFrom);
    const start = idx >= 0 ? idx : searchFrom;
    const end = start + stmt.length;
    ranges.push({ sql: stmt, startOffset: start, endOffset: end });
    searchFrom = end;
  }
  return ranges;
}

/** Find statement containing caret offset (0-based). */
export function statementAtOffset(
  sql: string,
  offset: number,
): string | null {
  const ranges = splitSqlWithRanges(sql);
  if (ranges.length === 0) return null;
  for (const r of ranges) {
    if (offset >= r.startOffset && offset <= r.endOffset + 1) return r.sql;
  }
  // between statements — prefer previous
  for (let i = ranges.length - 1; i >= 0; i--) {
    if (offset >= ranges[i]!.startOffset) return ranges[i]!.sql;
  }
  return ranges[0]?.sql ?? null;
}

export function isExplainSql(sql: string): boolean {
  return /^\s*EXPLAIN\b/i.test(sql);
}
