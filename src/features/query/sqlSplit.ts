/**
 * MySQL 规则：`--` 后必须跟空白才算注释；行首的 `--xxx` 也按注释处理
 * （兼容不写空格的导出工具）。这样 `SELECT 1--1` 不会被当成注释吞掉。
 */
function isDashComment(sql: string, i: number): boolean {
  const after = sql[i + 2];
  if (after === undefined) return true;
  if (/\s/.test(after)) return true;
  let j = i - 1;
  while (j >= 0 && (sql[j] === " " || sql[j] === "\t" || sql[j] === "\r")) j -= 1;
  return j < 0 || sql[j] === "\n";
}

const DELIMITER_RE = /^[ \t]*delimiter[ \t]+(\S+)/i;

/** Split SQL script into executable statements (respects quotes / comments / DELIMITER). */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  /** 当前语句结束符，可被 `DELIMITER xxx` 改写（存储过程 / 触发器） */
  let delimiter = ";";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  const commit = () => {
    const stmt = buf.trim();
    if (stmt) out.push(stmt);
    buf = "";
  };

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
      // DELIMITER 指令：只在语句边界识别（允许前面有注释），自身不发送给服务器
      if (
        (ch === "d" || ch === "D") &&
        (i === 0 || sql[i - 1] === "\n") &&
        (buf.trim().length === 0 ||
          (buf.length <= 4096 && stripSqlComments(buf).trim().length === 0))
      ) {
        const match = DELIMITER_RE.exec(sql.slice(i));
        if (match) {
          delimiter = match[1]!.replace(/\r$/, "");
          i += match[0].length;
          while (i < sql.length && sql[i] !== "\n") i += 1;
          buf = "";
          continue;
        }
      }

      if (delimiter === ";") {
        if (ch === ";") {
          commit();
          i += 1;
          continue;
        }
      } else if (sql.startsWith(delimiter, i)) {
        commit();
        i += delimiter.length;
        continue;
      }

      if (ch === "-" && next === "-" && isDashComment(sql, i)) {
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
    }

    // 反斜杠转义（MySQL 默认行为）：\' \" \\ 不改变引号状态，
    // 否则 JSON / 文本里的反斜杠会把语句从中间切断。
    if ((inSingle || inDouble) && ch === "\\" && next) {
      buf += ch + next;
      i += 2;
      continue;
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

  commit();
  return out;
}

/**
 * 去掉注释，保留字符串内容。`/*! ... *\/` 是 MySQL 可执行注释，原样保留。
 */
export function stripSqlComments(sql: string): string {
  let out = "";
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
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "-" && next === "-" && isDashComment(sql, i)) {
        inLineComment = true;
        i += 2;
        continue;
      }
      if (ch === "#") {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === "/" && next === "*") {
        if (sql[i + 2] === "!") {
          out += ch;
          i += 1;
          continue;
        }
        inBlockComment = true;
        i += 2;
        continue;
      }
    }

    if ((inSingle || inDouble) && ch === "\\" && next) {
      out += ch + next;
      i += 2;
      continue;
    }

    if (ch === "'" && !inDouble && !inBacktick) {
      if (inSingle && next === "'") {
        out += "''";
        i += 2;
        continue;
      }
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
    } else if (ch === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
    }

    out += ch;
    i += 1;
  }

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
