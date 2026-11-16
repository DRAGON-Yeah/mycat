import type { Monaco } from "@monaco-editor/react";
import type { languages, IDisposable, Position, editor } from "monaco-editor";

export type SqlCompletionContext = {
  connectionId: string | null;
  database: string | null;
  engine: string | null;
  tables: { name: string; kind: string }[];
  columnsByTable: Record<string, string[]>;
};

const KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "IS",
  "NULL",
  "AS",
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "CROSS JOIN",
  "ON",
  "USING",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "UNION",
  "UNION ALL",
  "DISTINCT",
  "ALL",
  "INSERT",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "DELETE FROM",
  "CREATE",
  "CREATE TABLE",
  "CREATE INDEX",
  "CREATE VIEW",
  "CREATE DATABASE",
  "ALTER",
  "ALTER TABLE",
  "ALTER DATABASE",
  "DROP",
  "DROP TABLE",
  "DROP VIEW",
  "DROP DATABASE",
  "TRUNCATE",
  "REPLACE",
  "SHOW",
  "SHOW TABLES",
  "SHOW DATABASES",
  "SHOW COLUMNS",
  "DESCRIBE",
  "DESC",
  "EXPLAIN",
  "USE",
  "WITH",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "IF",
  "IFNULL",
  "COALESCE",
  "CAST",
  "CONVERT",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "TRUE",
  "FALSE",
  "PRIMARY KEY",
  "FOREIGN KEY",
  "REFERENCES",
  "INDEX",
  "UNIQUE",
  "DEFAULT",
  "AUTO_INCREMENT",
  "ASC",
  "DESC",
  "INTO",
  "OUTFILE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "TRANSACTION",
  "GRANT",
  "REVOKE",
];

const SNIPPETS: { label: string; insert: string; detail: string }[] = [
  {
    label: "SELECT …",
    insert: "SELECT ${1:*} FROM ${2:table} WHERE ${3:1=1};",
    detail: "查询模板",
  },
  {
    label: "SELECT DISTINCT …",
    insert: "SELECT DISTINCT ${1:column} FROM ${2:table};",
    detail: "去重查询",
  },
  {
    label: "INSERT INTO …",
    insert:
      "INSERT INTO ${1:table} (${2:columns}) VALUES (${3:values});",
    detail: "插入模板",
  },
  {
    label: "UPDATE …",
    insert: "UPDATE ${1:table} SET ${2:column}=${3:value} WHERE ${4:id}=${5:1};",
    detail: "更新模板",
  },
  {
    label: "DELETE FROM …",
    insert: "DELETE FROM ${1:table} WHERE ${2:id}=${3:1};",
    detail: "删除模板",
  },
  {
    label: "CREATE TABLE …",
    insert:
      "CREATE TABLE ${1:table} (\n  ${2:id} INT PRIMARY KEY,\n  ${3:name} VARCHAR(255)\n);",
    detail: "建表模板",
  },
];

const TABLE_CONTEXT_RE =
  /\b(FROM|JOIN|INTO|UPDATE|TABLE|DESCRIBE|DESC|TRUNCATE)\b(?:\s+[`"]?[\w]*)?$/i;

let registered = false;
let disposable: IDisposable | null = null;
let ctx: SqlCompletionContext = {
  connectionId: null,
  database: null,
  engine: null,
  tables: [],
  columnsByTable: {},
};

export function setSqlCompletionContext(next: Partial<SqlCompletionContext>) {
  ctx = { ...ctx, ...next };
}

export function getSqlCompletionContext() {
  return ctx;
}

/** True when caret is in a position that should suggest table names. */
export function isTableNameContext(model: editor.ITextModel, position: Position) {
  const line = model.getLineContent(position.lineNumber);
  const before = line.slice(0, position.column - 1);
  const prevLine =
    position.lineNumber > 1
      ? model.getLineContent(position.lineNumber - 1)
      : "";
  const text = `${prevLine} ${before}`;
  return TABLE_CONTEXT_RE.test(text);
}

function wordRange(
  model: editor.ITextModel,
  position: Position,
): { word: string; range: languages.CompletionItem["range"] } {
  const word = model.getWordUntilPosition(position);
  return {
    word: word.word,
    range: {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    },
  };
}

function precedingText(model: editor.ITextModel, position: Position): string {
  const line = model.getLineContent(position.lineNumber);
  const before = line.slice(0, position.column - 1);
  const prev =
    position.lineNumber > 1
      ? model.getLineContent(position.lineNumber - 1)
      : "";
  return `${prev} ${before}`;
}

export function registerSqlCompletions(monaco: Monaco) {
  if (registered) return;
  registered = true;

  disposable = monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " ", "`", '"', "_"],
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const { word, range } = wordRange(model, position);
      const prefix = word.toLowerCase();
      const prev = precedingText(model, position);
      const suggestions: languages.CompletionItem[] = [];

      const lineBefore = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1);
      const afterDot = /\.\s*[`"]?[\w]*$/i.test(lineBefore);
      const tableCtx = TABLE_CONTEXT_RE.test(prev);

      // table.column
      if (afterDot) {
        const m = lineBefore.match(/([A-Za-z0-9_]+)\.\s*[`"]?([A-Za-z0-9_]*)$/);
        const table = m?.[1];
        const cols = table ? (ctx.columnsByTable[table] ?? []) : [];
        for (const col of cols) {
          if (prefix && !col.toLowerCase().startsWith(prefix)) continue;
          suggestions.push({
            label: col,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: col,
            range,
            detail: `列 · ${table}`,
            sortText: `0_${col}`,
          });
        }
        return { suggestions };
      }

      // Tables first when after FROM / JOIN / …
      if (tableCtx) {
        for (const t of ctx.tables) {
          if (prefix && !t.name.toLowerCase().startsWith(prefix)) continue;
          suggestions.push({
            label: t.name,
            kind:
              t.kind === "view"
                ? monaco.languages.CompletionItemKind.Interface
                : monaco.languages.CompletionItemKind.Class,
            insertText: t.name,
            range,
            detail:
              t.kind === "view"
                ? `视图 · ${ctx.database ?? ""}`
                : `表 · ${ctx.database ?? ""}`,
            sortText: `0_${t.name}`,
          });
        }
      }

      // Keywords (still useful elsewhere; de-prioritize in table context)
      for (const kw of KEYWORDS) {
        if (prefix && !kw.toLowerCase().startsWith(prefix)) continue;
        if (tableCtx && !prefix) continue; // after "FROM " show tables only
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
          detail: "SQL 关键字",
          sortText: tableCtx ? `2_${kw}` : `1_${kw}`,
        });
      }

      // Snippets
      if (!tableCtx || prefix) {
        for (const sn of SNIPPETS) {
          const head = sn.label.split(/\s+/)[0]!.toLowerCase();
          if (
            prefix &&
            !head.startsWith(prefix) &&
            !sn.label.toLowerCase().includes(prefix)
          ) {
            continue;
          }
          if (tableCtx) continue;
          suggestions.push({
            label: sn.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: sn.insert,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: sn.detail,
            sortText: `3_${sn.label}`,
          });
        }
      }

      // Also offer tables when typing a name even outside strict FROM context
      if (!tableCtx && prefix.length >= 1) {
        for (const t of ctx.tables) {
          if (!t.name.toLowerCase().startsWith(prefix)) continue;
          suggestions.push({
            label: t.name,
            kind:
              t.kind === "view"
                ? monaco.languages.CompletionItemKind.Interface
                : monaco.languages.CompletionItemKind.Class,
            insertText: t.name,
            range,
            detail: t.kind === "view" ? "视图" : "表",
            sortText: `0_${t.name}`,
          });
        }
      }

      if (/\bUSE\s+[`"]?[\w]*$/i.test(prev) && ctx.database) {
        suggestions.push({
          label: ctx.database,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: ctx.database,
          range,
          detail: "当前数据库",
          sortText: "0_db",
        });
      }

      return { suggestions };
    },
  });
}

export function disposeSqlCompletions() {
  disposable?.dispose();
  disposable = null;
  registered = false;
}
