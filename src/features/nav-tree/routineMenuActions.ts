import type { ConnectionDto } from "../connections/types";
import { executeSql, openConnection } from "../connections/sessionApi";
import { downloadTextFile } from "../import-export/csv";
import {
  listRoutineMeta,
  type RoutineType,
} from "../object-list/routineMeta";
import { engineKey, identOk, quoteTable } from "./sqlIdent";
import {
  buildDropRoutineSql,
  buildRunSql,
  parseRoutineDdl,
  rewriteCreateRoutineName,
  sqlLiteral,
} from "../function-designer/routineDdl";

export async function fetchRoutineDdl(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
  routineType: RoutineType;
}): Promise<string> {
  const { conn, database, name, routineType } = args;
  await openConnection(conn.id);
  const e = engineKey(conn.engine);
  if (e === "mysql") {
    const qt = quoteTable(String(conn.engine), database, name);
    const out = await executeSql(
      conn.id,
      `SHOW CREATE ${routineType} ${qt}`,
      database,
    );
    const row = out.rows[0];
    if (!row) throw new Error("无法获取例程 DDL");
    // SHOW CREATE FUNCTION: Function, Create Function
    const sql = String(row[2] ?? row[1] ?? row[0] ?? "");
    if (!sql) throw new Error("无法获取例程 DDL");
    return sql.endsWith(";") ? sql : `${sql};`;
  }
  if (e === "postgres" || e === "postgresql") {
    const out = await executeSql(
      conn.id,
      `SELECT pg_get_functiondef(p.oid)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = current_schema() AND p.proname = '${name.replace(/'/g, "''")}'
       LIMIT 1`,
      database,
    );
    const sql = String(out.rows[0]?.[0] ?? "");
    if (!sql) throw new Error("无法获取函数定义");
    return sql.endsWith(";") ? sql : `${sql};`;
  }
  throw new Error("当前引擎不支持存储函数/过程");
}

export async function resolveRoutineType(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
  hint?: RoutineType;
}): Promise<RoutineType> {
  if (args.hint) return args.hint;
  const map = await listRoutineMeta({
    connectionId: args.conn.id,
    engine: String(args.conn.engine),
    database: args.database,
  });
  const meta = map[args.name];
  if (!meta) throw new Error(`未找到例程 ${args.name}`);
  return meta.routineType;
}

export async function dropRoutine(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
  routineType: RoutineType;
}) {
  const { conn, database, name, routineType } = args;
  await openConnection(conn.id);
  const sql = buildDropRoutineSql({
    engine: String(conn.engine),
    database,
    name,
    routineType,
  });
  await executeSql(conn.id, sql, database);
}

export async function copyRoutine(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
  newName: string;
  routineType: RoutineType;
}) {
  const { conn, database, name, newName, routineType } = args;
  if (!identOk(newName)) {
    throw new Error("目标名称仅允许字母、数字、下划线，且不能以数字开头");
  }
  if (newName === name) throw new Error("目标名称不能与源相同");
  const ddl = await fetchRoutineDdl({ conn, database, name, routineType });
  const next = rewriteCreateRoutineName(
    ddl,
    newName,
    String(conn.engine),
    database,
  );
  await openConnection(conn.id);
  await executeSql(conn.id, next, database);
}

export async function renameRoutine(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
  next: string;
  routineType: RoutineType;
}) {
  const { conn, database, name, next, routineType } = args;
  if (!identOk(next)) {
    throw new Error("新名称仅允许字母、数字、下划线，且不能以数字开头");
  }
  const ddl = await fetchRoutineDdl({ conn, database, name, routineType });
  const nextDdl = rewriteCreateRoutineName(
    ddl,
    next,
    String(conn.engine),
    database,
  );
  await openConnection(conn.id);
  await dropRoutine({ conn, database, name, routineType });
  try {
    await executeSql(conn.id, nextDdl, database);
  } catch (err) {
    // best-effort restore
    try {
      await executeSql(conn.id, ddl, database);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function exportAllRoutinesDictionary(args: {
  conn: ConnectionDto;
  database: string;
}) {
  const { conn, database } = args;
  const map = await listRoutineMeta({
    connectionId: conn.id,
    engine: String(conn.engine),
    database,
  });
  const list = Object.values(map);
  const lines = [
    `# 函数/过程数据字典 · ${database}`,
    "",
    `连接：${conn.name}（${conn.engine}）`,
    `生成时间：${new Date().toLocaleString()}`,
    "",
  ];
  for (const r of list) {
    lines.push(
      `## ${r.name}`,
      "",
      `- 类型: ${r.routineType}`,
      `- 返回: ${r.returns || "—"}`,
      `- 定义者: ${r.definer || "—"}`,
      `- SQL 安全性: ${r.securityType || "—"}`,
      `- 注释: ${r.comment || "—"}`,
      "",
    );
    try {
      const ddl = await fetchRoutineDdl({
        conn,
        database,
        name: r.name,
        routineType: r.routineType,
      });
      lines.push("```sql", ddl.replace(/;\s*$/, ""), "```", "");
    } catch (err) {
      lines.push(
        `（无法读取定义：${err instanceof Error ? err.message : String(err)}）`,
        "",
      );
    }
  }
  await downloadTextFile(
    `${database}-routines-dictionary.md`,
    lines.join("\n"),
    "text/markdown",
  );
  return list.length;
}

export async function runRoutine(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
  routineType: RoutineType;
  /** raw user input values in param order */
  values: string[];
  nullFlags?: boolean[];
}): Promise<{ columns: string[]; rows: unknown[][] }> {
  const { conn, database, name, routineType, values, nullFlags } = args;
  // 留空按 NULL 传参，避免 INT 等类型收到 '' 报 Incorrect integer value
  const literals = values.map((v, i) =>
    nullFlags?.[i] || !String(v ?? "").trim() ? "NULL" : sqlLiteral(v),
  );
  const sql = buildRunSql({
    engine: String(conn.engine),
    database,
    name,
    routineType,
    argLiterals: literals,
  });
  await openConnection(conn.id);
  const out = await executeSql(conn.id, sql, database);
  return {
    columns: out.columns,
    rows: out.rows,
  };
}

export async function loadRoutineParams(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
  routineType: RoutineType;
}) {
  const ddl = await fetchRoutineDdl(args);
  return parseRoutineDdl(ddl).params;
}
