export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function rowsToCsv(columns: string[], rows: unknown[][]): string {
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

export function parseCsv(text: string): { columns: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    // skip trailing empty line
    if (row.length === 1 && row[0] === "" && rows.length > 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushCell();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushCell();
      pushRow();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell.length > 0 || row.length > 0) {
    pushCell();
    pushRow();
  }

  if (rows.length === 0) {
    throw new Error("CSV 为空或无法解析");
  }
  const columns = rows[0]!;
  if (columns.length === 0 || columns.every((c) => c.trim() === "")) {
    throw new Error("CSV 缺少表头");
  }
  return { columns, rows: rows.slice(1) };
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
