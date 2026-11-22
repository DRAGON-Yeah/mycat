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

/**
 * Split SQL script into statements, keeping each statement's offsets in the
 * original text (respects quotes / comments / DELIMITER).
 */
export function splitSqlWithRanges(sql: string): StatementRange[] {
  const out: StatementRange[] = [];
  let buf = "";
  /** buf 首字符在原始 sql 中的偏移；-1 表示 buf 为空 */
  let bufStart = -1;
  /** 当前语句结束符，可被 `DELIMITER xxx` 改写（存储过程 / 触发器） */
  let delimiter = ";";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  const append = (text: string) => {
    if (buf.length === 0) bufStart = i;
    buf += text;
  };

  const commit = () => {
    const raw = buf;
    const stmt = raw.trim();
    if (stmt) {
      const lead = raw.length - raw.trimStart().length;
      const start = (bufStart < 0 ? 0 : bufStart) + lead;
      out.push({
        sql: stmt,
        startOffset: start,
        endOffset: start + stmt.length,
      });
    }
    buf = "";
    bufStart = -1;
  };

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1] ?? "";

    if (inLineComment) {
      append(ch);
      if (ch === "\n") inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      append(ch);
      if (ch === "*" && next === "/") {
        append(next);
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
          bufStart = -1;
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
        append(ch);
        i += 1;
        continue;
      }
      if (ch === "#") {
        inLineComment = true;
        append(ch);
        i += 1;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        append(ch);
        i += 1;
        continue;
      }
    }

    // 反斜杠转义（MySQL 默认行为）：\' \" \\ 不改变引号状态，
    // 否则 JSON / 文本里的反斜杠会把语句从中间切断。
    if ((inSingle || inDouble) && ch === "\\" && next) {
      append(ch + next);
      i += 2;
      continue;
    }

    if (ch === "'" && !inDouble && !inBacktick) {
      if (inSingle && next === "'") {
        append("''");
        i += 2;
        continue;
      }
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
    } else if (ch === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
    }

    append(ch);
    i += 1;
  }

  commit();
  return out;
}

/** Split SQL script into executable statements (respects quotes / comments / DELIMITER). */
export function splitSqlStatements(sql: string): string[] {
  return splitSqlWithRanges(sql).map((r) => r.sql);
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
  // 语句前面可能带注释行（`-- xxx` / `# xxx` / `/* xxx */`），先剥掉再判断
  return /^EXPLAIN\b/i.test(stripSqlComments(sql).trimStart());
}
