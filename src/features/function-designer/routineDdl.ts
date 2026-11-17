import type { RoutineType } from "../object-list/routineMeta";
import { quoteIdent, quoteTable } from "../nav-tree/sqlIdent";

export type RoutineParam = {
  name: string;
  mode: "IN" | "OUT" | "INOUT";
  dataType: string;
};

export type ParsedRoutine = {
  name: string;
  routineType: RoutineType;
  params: RoutineParam[];
  returns: string;
  body: string;
  definer: string;
  securityType: "DEFINER" | "INVOKER" | "";
  deterministic: boolean;
  comment: string;
  rawDdl: string;
};

const EMPTY: ParsedRoutine = {
  name: "",
  routineType: "PROCEDURE",
  params: [],
  returns: "INT",
  body: "BEGIN\n\nEND",
  definer: "",
  securityType: "",
  deterministic: false,
  comment: "",
  rawDdl: "",
};

/** Extract CREATE FUNCTION/PROCEDURE statement body from SHOW CREATE output. */
export function parseRoutineDdl(ddl: string): ParsedRoutine {
  const raw = ddl.trim();
  if (!raw) return { ...EMPTY };

  const typeMatch = raw.match(
    /create\s+(?:definer\s*=\s*[^\s]+\s+)?(function|procedure)\s+/i,
  );
  const routineType: RoutineType =
    typeMatch?.[1]?.toUpperCase() === "FUNCTION" ? "FUNCTION" : "PROCEDURE";

  const nameMatch = raw.match(
    /create\s+(?:definer\s*=\s*[^\s]+\s+)?(?:function|procedure)\s+(?:`?[\w]+`?\.)?`?([\w]+)`?/i,
  );
  const name = nameMatch?.[1] ?? "";

  const definerMatch = raw.match(/definer\s*=\s*`?([^`\s]+)`?@`?([^`\s]+)`?/i);
  const definer = definerMatch
    ? `${definerMatch[1]}@${definerMatch[2]}`
    : "";

  const securityMatch = raw.match(/sql\s+security\s+(definer|invoker)/i);
  const securityType = securityMatch
    ? (securityMatch[1]!.toUpperCase() as "DEFINER" | "INVOKER")
    : "";

  const deterministic = /\bdeterministic\b/i.test(raw);

  const commentMatch = raw.match(/comment\s+'((?:\\'|[^'])*)'/i);
  const comment = commentMatch?.[1]?.replace(/\\'/g, "'") ?? "";

  // Params: first (...) after name
  const afterName = raw.slice(nameMatch?.index ?? 0);
  const paramsStart = afterName.search(/\(/);
  let params: RoutineParam[] = [];
  let afterParams = afterName;
  if (paramsStart >= 0) {
    const sliced = afterName.slice(paramsStart);
    const { inner, end } = matchParen(sliced);
    params = parseParams(inner);
    afterParams = sliced.slice(end);
  }

  let returns = "";
  if (routineType === "FUNCTION") {
    const rm = afterParams.match(
      /^\s*returns\s+([^\s]+(?:\s*\([^)]*\))?)/i,
    );
    returns = rm?.[1]?.trim() ?? "";
  }

  // Body: from BEGIN or RETURN to end (strip trailing ;)
  let body = "";
  const beginIdx = raw.search(/\bbegin\b/i);
  const returnIdx = raw.search(/\breturn\b/i);
  if (beginIdx >= 0) {
    body = raw.slice(beginIdx).replace(/;\s*$/, "").trim();
  } else if (returnIdx >= 0 && routineType === "FUNCTION") {
    body = raw.slice(returnIdx).replace(/;\s*$/, "").trim();
  } else {
    body = "BEGIN\n\nEND";
  }

  return {
    name,
    routineType,
    params,
    returns: returns || "INT",
    body,
    definer,
    securityType,
    deterministic,
    comment,
    rawDdl: raw,
  };
}

function matchParen(s: string): { inner: string; end: number } {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        return { inner: s.slice(1, i), end: i + 1 };
      }
    }
  }
  return { inner: "", end: 0 };
}

function parseParams(inner: string): RoutineParam[] {
  if (!inner.trim()) return [];
  const parts = splitArgs(inner);
  return parts
    .map((p) => {
      const m = p
        .trim()
        .match(
          /^(?:(in|out|inout)\s+)?`?([\w]+)`?\s+(.+)$/i,
        );
      if (!m) return null;
      const mode = (m[1]?.toUpperCase() || "IN") as RoutineParam["mode"];
      return {
        name: m[2]!,
        mode: mode === "OUT" || mode === "INOUT" ? mode : "IN",
        dataType: m[3]!.trim(),
      };
    })
    .filter((x): x is RoutineParam => !!x);
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export type WizardParam = {
  name: string;
  mode: "IN" | "OUT" | "INOUT";
  typeName: string;
  length: string;
};

export function formatParamType(typeName: string, length: string): string {
  const t = typeName.trim() || "INT";
  const len = length.trim();
  if (!len || len === "0") return t;
  if (/^(varchar|char|varbinary|binary|decimal|numeric|float|double)$/i.test(t)) {
    return `${t}(${len})`;
  }
  return t;
}

export function buildCreateRoutineSql(args: {
  engine: string;
  database: string;
  name: string;
  routineType: RoutineType;
  params: RoutineParam[];
  returns: string;
  body: string;
  definer?: string;
  /** CURRENT_USER or user@host; default CURRENT_USER for new templates */
  definerCurrentUser?: boolean;
  securityType?: string;
  deterministic?: boolean;
  dataAccess?: string;
  comment?: string;
}): string {
  const {
    engine,
    database,
    name,
    routineType,
    params,
    returns,
    body,
    definer,
    definerCurrentUser,
    securityType,
    deterministic,
    dataAccess,
    comment,
  } = args;
  const qt = quoteTable(engine, database, name);
  const paramSql = params
    .filter((p) => p.name.trim() && p.dataType.trim())
    .map((p) => {
      const mode =
        routineType === "FUNCTION" ? "" : `${p.mode} `;
      return `${mode}${quoteIdent(engine, p.name.trim())} ${p.dataType.trim()}`;
    })
    .join(", ");

  let definerClause = "";
  if (definerCurrentUser) {
    definerClause = "DEFINER = CURRENT_USER ";
  } else if (definer?.trim()) {
    const d = definer.trim();
    if (/^current_user$/i.test(d)) definerClause = "DEFINER = CURRENT_USER ";
    else if (d.includes("`")) definerClause = `DEFINER = ${d} `;
    else {
      const m = d.match(/^([^@]+)@(.+)$/);
      definerClause = m
        ? `DEFINER = \`${m[1]}\`@\`${m[2]}\` `
        : `DEFINER = \`${d}\`@\`%\` `;
    }
  }

  const parts: string[] = [
    `CREATE ${definerClause}${routineType} ${qt}(${paramSql})`,
  ];
  if (routineType === "FUNCTION") {
    parts.push(`RETURNS ${returns.trim() || "INT"}`);
  }
  if (deterministic) parts.push("DETERMINISTIC");
  else parts.push("NOT DETERMINISTIC");
  if (dataAccess?.trim()) {
    parts.push(dataAccess.trim().toUpperCase());
  } else if (routineType === "FUNCTION" && !deterministic) {
    // MySQL 开启 binlog 且 log_bin_trust_function_creators=0 时，
    // 函数必须声明 DETERMINISTIC / NO SQL / READS SQL DATA，否则创建失败
    parts.push("NO SQL");
  }
  if (securityType === "INVOKER" || securityType === "DEFINER") {
    parts.push(`SQL SECURITY ${securityType}`);
  }
  if (comment?.trim()) {
    parts.push(`COMMENT '${comment.trim().replace(/'/g, "\\'")}'`);
  }

  let bodySql = body.trim() || "BEGIN\n  #Routine body goes here...\nEND";
  if (routineType === "FUNCTION" && !/\breturn\b/i.test(bodySql)) {
    bodySql =
      "BEGIN\n  #Routine body goes here...\n  RETURN 0;\nEND";
  }
  if (!/;\s*$/.test(bodySql)) {
    bodySql = `${bodySql};`;
  }
  parts.push(bodySql);
  const sql = parts.join("\n");
  return sql.endsWith(";") ? sql : `${sql};`;
}

/** Navicat-style template after wizard / skip. */
export function buildRoutineTemplateSql(args: {
  engine: string;
  database: string;
  name: string;
  routineType: RoutineType;
  wizardParams?: WizardParam[];
  returnsType?: string;
  returnsLength?: string;
  deterministic?: boolean;
  dataAccess?: string;
  securityType?: string;
}): string {
  const params: RoutineParam[] = (args.wizardParams ?? []).map((p) => ({
    name: p.name || "param1",
    mode: args.routineType === "FUNCTION" ? "IN" : p.mode,
    dataType: formatParamType(p.typeName, p.length),
  }));
  if (params.length === 0 && args.routineType === "FUNCTION") {
    params.push({ name: "param1", mode: "IN", dataType: "INT" });
  }
  const returns = formatParamType(
    args.returnsType || "INT",
    args.returnsLength || "0",
  );
  return buildCreateRoutineSql({
    engine: args.engine,
    database: args.database,
    name: args.name || "NewFunc",
    routineType: args.routineType,
    params,
    returns,
    body: "",
    definerCurrentUser: true,
    deterministic: args.deterministic,
    dataAccess: args.dataAccess,
    securityType: args.securityType,
  });
}

export function rewriteCreateRoutineName(
  ddl: string,
  newName: string,
  engine: string,
  database: string,
): string {
  const parsed = parseRoutineDdl(ddl);
  return buildCreateRoutineSql({
    engine,
    database,
    name: newName,
    routineType: parsed.routineType,
    params: parsed.params,
    returns: parsed.returns,
    body: parsed.body,
    definer: parsed.definer,
    securityType: parsed.securityType,
    deterministic: parsed.deterministic,
    comment: parsed.comment,
  });
}

export function buildDropRoutineSql(args: {
  engine: string;
  database: string;
  name: string;
  routineType: RoutineType;
}): string {
  const qt = quoteTable(args.engine, args.database, args.name);
  return `DROP ${args.routineType} IF EXISTS ${qt}`;
}

export function buildRunSql(args: {
  engine: string;
  database: string;
  name: string;
  routineType: RoutineType;
  /** Ordered literal SQL fragments already escaped/quoted */
  argLiterals: string[];
}): string {
  const qt = quoteTable(args.engine, args.database, args.name);
  const argsSql = args.argLiterals.join(", ");
  if (args.routineType === "PROCEDURE") {
    return `CALL ${qt}(${argsSql})`;
  }
  return `SELECT ${qt}(${argsSql}) AS result`;
}

export function sqlLiteral(value: string): string {
  if (value.toUpperCase() === "NULL") return "NULL";
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}
