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

let registered = false;
let disposable: IDisposable | null = null;
let ctx: SqlCompletionContext = {
  connectionId: null,
  database: null,
  engine: null,
  tables: [],
  columnsByTable: {},
};

export function setSqlCompletionContext(
  next: Partial<SqlCompletionContext>,
) {
  ctx = { ...ctx, ...next };
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
  return `${prev} ${before}`.toUpperCase();
}

export function registerSqlCompletions(monaco: Monaco) {
  if (registered) return;
  registered = true;

  disposable = monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " ", "`", '"'],
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const { word, range } = wordRange(model, position);
      const prefix = word.toLowerCase();
      const prev = precedingText(model, position);
      const suggestions: languages.CompletionItem[] = [];

      const afterDot = /\.\s*[`"]?[\w]*$/i.test(
        model
          .getLineContent(position.lineNumber)
          .slice(0, position.column - 1),
      );

      // table.column
      if (afterDot) {
        const line = model
          .getLineContent(position.lineNumber)
          .slice(0, position.column - 1);
        const m = line.match(/([A-Za-z0-9_]+)\.\s*[`"]?([A-Za-z0-9_]*)$/);
        const table = m?.[1];
        const cols = table ? ctx.columnsByTable[table] ?? [] : [];
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
      }

      // Keywords
      for (const kw of KEYWORDS) {
        if (prefix && !kw.toLowerCase().startsWith(prefix)) continue;
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
          detail: "SQL 关键字",
          sortText: `1_${kw}`,
        });
      }

      // Snippets — show when prefix matches first word
      for (const sn of SNIPPETS) {
        const head = sn.label.split(/\s+/)[0]!.toLowerCase();
        if (prefix && !head.startsWith(prefix) && !sn.label.toLowerCase().includes(prefix)) {
          continue;
        }
        suggestions.push({
          label: sn.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: sn.insert,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: sn.detail,
          sortText: `2_${sn.label}`,
        });
      }

      // Tables — prefer after FROM / JOIN / INTO / UPDATE / TABLE
      const wantTables =
        /\b(FROM|JOIN|INTO|UPDATE|TABLE|DESCRIBE|DESC|SHOW\s+COLUMNS\s+FROM)\s+[`"]?[\w]*$/i.test(
          prev.trim(),
        ) || (!afterDot && prefix.length >= 1);

      if (wantTables) {
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
            detail: t.kind === "view" ? "视图" : "表",
            sortText: `0_${t.name}`,
          });
        }
      }

      // Databases after USE
      if (/\bUSE\s+[`"]?[\w]*$/i.test(prev.trim()) && ctx.database) {
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
