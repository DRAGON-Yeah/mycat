import { engineKey, identOk, quoteIdent, quoteTable } from "../nav-tree/sqlIdent";

/** Extract SELECT body after the last top-level AS in CREATE VIEW DDL. */
export function parseViewSelectBody(createDdl: string): string {
  const sql = createDdl.replace(/;\s*$/, "").trim();
  // Prefer matching " AS " after VIEW name block (case-insensitive).
  const re = /\bAS\b/gi;
  let match: RegExpExecArray | null;
  let lastIdx = -1;
  while ((match = re.exec(sql)) !== null) {
    lastIdx = match.index;
  }
  if (lastIdx < 0) return sql;
  return sql.slice(lastIdx + 2).trim();
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
  const body = selectSql.trim().replace(/;\s*$/, "");
  if (!body) throw new Error("请填写 SELECT 定义");
  if (!/^\s*select\b/i.test(body) && !/^\s*with\b/i.test(body)) {
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
    /create\s+(or\s+replace\s+)?view\s+(if\s+not\s+exists\s+)?(?:`?[\w]+`?\.)?`?[\w]+`?/i,
    (_m, orReplace?: string, ifNot?: string) =>
      `CREATE ${orReplace || ""}${ifNot || ""}VIEW ${qt}`,
  );
}
