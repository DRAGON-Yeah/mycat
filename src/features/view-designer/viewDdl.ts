import { engineKey, identOk, quoteIdent, quoteTable } from "../nav-tree/sqlIdent";

/**
 * Extract SELECT/WITH body from CREATE VIEW DDL.
 * Must find the AS that follows the VIEW name — not column aliases like `1 AS col`.
 */
export function parseViewSelectBody(createDdl: string): string {
  const sql = createDdl.replace(/;\s*$/, "").trim();
  // VIEW [IF NOT EXISTS] [[db.]name] [(cols)] AS <body>
  const re =
    /\bview\s+(?:if\s+not\s+exists\s+)?(?:(?:`[^`]+`|"[^"]+"|\w+)\s*\.\s*)?(?:`[^`]+`|"[^"]+"|\w+)\s*(?:\([^;]*?\))?\s+as\s+/i;
  const m = sql.match(re);
  if (m && m.index != null) {
    return sql.slice(m.index + m[0].length).trim();
  }
  // Fallback: first AS after the VIEW keyword only
  const viewIdx = sql.search(/\bview\b/i);
  if (viewIdx >= 0) {
    const afterView = sql.slice(viewIdx);
    const asMatch = /\bas\b/i.exec(afterView);
    if (asMatch && asMatch.index != null) {
      return afterView.slice(asMatch.index + asMatch[0].length).trim();
    }
  }
  // Already a bare SELECT / WITH
  if (/^\s*(select|with)\b/i.test(sql)) return sql;
  return sql;
}

function normalizeViewBody(selectSql: string): string {
  let body = selectSql.trim().replace(/;\s*$/, "");
  // Unwrap a single pair of outer parentheses: (SELECT ...)
  if (body.startsWith("(") && body.endsWith(")")) {
    const inner = body.slice(1, -1).trim();
    if (/^(select|with)\b/i.test(inner)) body = inner;
  }
  return body;
}

export function buildCreateViewSql(args: {
  engine: string;
  database: string;
  viewName: string;
  selectSql: string;
  replace?: boolean;
}): string {
  const { engine, database, viewName, selectSql } = args;
  if (!identOk(viewName)) {
    throw new Error("视图名仅允许字母、数字、下划线，且不能以数字开头");
  }
  const body = normalizeViewBody(selectSql);
  if (!body) throw new Error("请填写 SELECT 定义");
  if (!/^(select|with)\b/i.test(body)) {
    throw new Error("视图定义应以 SELECT 或 WITH 开头");
  }
  const e = engineKey(engine);
  const qt = quoteTable(engine, database, viewName);
  if (e === "mysql") {
    const orReplace = args.replace ? "OR REPLACE " : "";
    return `CREATE ${orReplace}VIEW ${qt} AS\n${body}`;
  }
  if (e === "postgres" || e === "postgresql") {
    if (args.replace) {
      return `CREATE OR REPLACE VIEW ${qt} AS\n${body}`;
    }
    return `CREATE VIEW ${qt} AS\n${body}`;
  }
  // SQLite: no CREATE OR REPLACE VIEW — drop then create when replacing
  if (args.replace) {
    const qn = quoteIdent(engine, viewName);
    return `DROP VIEW IF EXISTS ${qn};\nCREATE VIEW ${qn} AS\n${body}`;
  }
  return `CREATE VIEW ${quoteIdent(engine, viewName)} AS\n${body}`;
}

export function rewriteCreateViewName(
  ddl: string,
  newName: string,
  engine: string,
  database?: string,
): string {
  if (!identOk(newName)) {
    throw new Error("视图名仅允许字母、数字、下划线，且不能以数字开头");
  }
  const qt = database
    ? quoteTable(engine, database, newName)
    : quoteIdent(engine, newName);
  return ddl.replace(
    /create\s+(or\s+replace\s+)?(?:algorithm\s*=\s*\w+\s+)?(?:definer\s*=\s*[^\s]+\s+)?(?:sql\s+security\s+\w+\s+)?view\s+(if\s+not\s+exists\s+)?(?:`?[\w]+`?\.)?`?[\w]+`?/i,
    (_m, orReplace?: string, ifNot?: string) =>
      `CREATE ${orReplace || ""}${ifNot || ""}VIEW ${qt}`,
  );
}
