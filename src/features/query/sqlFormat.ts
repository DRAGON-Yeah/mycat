/** Lightweight SQL pretty-printer (no external deps). */
export function formatSql(input: string): string {
  const raw = input.replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const tokens = [
    "UNION ALL",
    "UNION",
    "GROUP BY",
    "ORDER BY",
    "LEFT JOIN",
    "RIGHT JOIN",
    "INNER JOIN",
    "OUTER JOIN",
    "FULL JOIN",
    "CROSS JOIN",
    "INSERT INTO",
    "DELETE FROM",
    "SELECT",
    "FROM",
    "WHERE",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "VALUES",
    "UPDATE",
    "SET",
    "AND",
    "OR",
    "JOIN",
  ];

  let s = raw.replace(/\s+/g, " ").trim();
  for (const t of tokens) {
    const re = new RegExp(`\\b${t.replace(/ /g, "\\s+")}\\b`, "gi");
    s = s.replace(re, (m) => `\n${m.toUpperCase().replace(/\s+/g, " ")}`);
  }

  return s
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^(AND|OR|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|OUTER JOIN|FULL JOIN|CROSS JOIN)\b/i.test(line)) {
        return `  ${line}`;
      }
      return line;
    })
    .join("\n");
}

export function toggleLineComment(
  sql: string,
  fromLine: number,
  toLine: number,
): string {
  const lines = sql.replace(/\r\n/g, "\n").split("\n");
  const start = Math.max(0, fromLine);
  const end = Math.min(lines.length - 1, toLine);
  const slice = lines.slice(start, end + 1);
  const allCommented = slice.every(
    (l) => /^\s*--/.test(l) || l.trim() === "",
  );
  for (let i = start; i <= end; i++) {
    const line = lines[i] ?? "";
    if (allCommented) {
      lines[i] = line.replace(/^(\s*)--\s?/, "$1");
    } else if (line.trim()) {
      lines[i] = line.replace(/^(\s*)/, "$1-- ");
    }
  }
  return lines.join("\n");
}
