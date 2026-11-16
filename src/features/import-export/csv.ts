import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const UTF8_BOM = "\uFEFF";

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function rowsToCsv(
  columns: string[],
  rows: unknown[][],
  opts?: { bom?: boolean },
): string {
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  const csv = `${header}\n${body}\n`;
  return opts?.bom ? `${UTF8_BOM}${csv}` : csv;
}

export function parseCsv(text: string): { columns: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  text = stripBom(text);

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

export class SaveCancelledError extends Error {
  constructor() {
    super("已取消保存");
    this.name = "SaveCancelledError";
  }
}

export function isSaveCancelled(err: unknown): boolean {
  return (
    err instanceof SaveCancelledError ||
    (err instanceof Error && err.name === "SaveCancelledError")
  );
}

function extFromFilename(filename: string): string {
  const m = filename.match(/\.([A-Za-z0-9]+)$/);
  return m?.[1]?.toLowerCase() || "txt";
}

function filtersFor(filename: string, mime?: string) {
  const ext = extFromFilename(filename);
  if (ext === "csv" || mime?.includes("csv")) {
    return [{ name: "CSV", extensions: ["csv"] }];
  }
  if (ext === "sql" || mime?.includes("sql")) {
    return [{ name: "SQL", extensions: ["sql"] }];
  }
  if (ext === "md" || mime?.includes("markdown")) {
    return [{ name: "Markdown", extensions: ["md"] }];
  }
  if (ext === "json" || mime?.includes("json")) {
    return [{ name: "JSON", extensions: ["json"] }];
  }
  if (ext === "txt") {
    return [{ name: "Text", extensions: ["txt"] }];
  }
  return [
    { name: ext.toUpperCase(), extensions: [ext] },
    { name: "All", extensions: ["*"] },
  ];
}

/**
 * 弹出系统「另存为」对话框，让用户选择目录与文件名后写入。
 * 取消时抛出 SaveCancelledError。
 * @returns 实际保存路径
 */
export async function downloadTextFile(
  filename: string,
  content: string,
  mime?: string,
): Promise<string> {
  const path = await save({
    title: "保存文件",
    defaultPath: filename,
    filters: filtersFor(filename, mime),
    canCreateDirectories: true,
  });
  if (!path) {
    throw new SaveCancelledError();
  }
  await writeTextFile(path, content);
  return path;
}
