import type { ConnectionDto } from "../connections/types";
import { executeSql, openConnection } from "../connections/sessionApi";
import { downloadTextFile } from "../import-export/csv";
import { listEventMeta } from "../object-list/eventMeta";
import { engineKey, identOk, quoteTable } from "./sqlIdent";
import {
  buildAlterEventStatusSql,
  buildDropEventSql,
  buildRenameEventViaAlterSql,
  rewriteCreateEventName,
} from "../event-designer/eventDdl";

export async function fetchEventDdl(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
}): Promise<string> {
  const { conn, database, name } = args;
  await openConnection(conn.id);
  const e = engineKey(conn.engine);
  if (e !== "mysql" && e !== "mariadb") {
    throw new Error("当前引擎不支持 MySQL 事件");
  }
  const qt = quoteTable(String(conn.engine), database, name);
  const out = await executeSql(conn.id, `SHOW CREATE EVENT ${qt}`, database);
  const row = out.rows[0];
  if (!row) throw new Error("无法获取事件 DDL");
  // Event, sql_mode, Create Event — usually index 2 or 3
  const sql = String(row[3] ?? row[2] ?? row[1] ?? row[0] ?? "");
  if (!sql) throw new Error("无法获取事件 DDL");
  return sql.endsWith(";") ? sql : `${sql};`;
}

export async function dropEvent(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
}) {
  const { conn, database, name } = args;
  await openConnection(conn.id);
  await executeSql(
    conn.id,
    buildDropEventSql({
      engine: String(conn.engine),
      database,
      name,
    }),
    database,
  );
}

export async function setEventEnabled(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
  enable: boolean;
}) {
  const { conn, database, name, enable } = args;
  await openConnection(conn.id);
  await executeSql(
    conn.id,
    buildAlterEventStatusSql({
      engine: String(conn.engine),
      database,
      name,
      enable,
    }),
    database,
  );
}

export async function copyEvent(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
  newName: string;
}) {
  const { conn, database, name, newName } = args;
  if (!identOk(newName)) {
    throw new Error("目标名称仅允许字母、数字、下划线，且不能以数字开头");
  }
  if (newName === name) throw new Error("目标名称不能与源相同");
  const ddl = await fetchEventDdl({ conn, database, name });
  const next = rewriteCreateEventName(
    ddl,
    newName,
    String(conn.engine),
    database,
  );
  await openConnection(conn.id);
  await executeSql(conn.id, next, database);
}

export async function renameEvent(args: {
  conn: ConnectionDto;
  database: string;
  name: string;
  next: string;
}) {
  const { conn, database, name, next } = args;
  if (!identOk(next)) {
    throw new Error("新名称仅允许字母、数字、下划线，且不能以数字开头");
  }
  await openConnection(conn.id);
  try {
    await executeSql(
      conn.id,
      buildRenameEventViaAlterSql({
        engine: String(conn.engine),
        database,
        name,
        next,
      }),
      database,
    );
  } catch {
    // fallback DROP+CREATE
    const ddl = await fetchEventDdl({ conn, database, name });
    const nextDdl = rewriteCreateEventName(
      ddl,
      next,
      String(conn.engine),
      database,
    );
    await dropEvent({ conn, database, name });
    try {
      await executeSql(conn.id, nextDdl, database);
    } catch (err) {
      try {
        await executeSql(conn.id, ddl, database);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
}

export async function exportAllEventsDictionary(args: {
  conn: ConnectionDto;
  database: string;
}) {
  const { conn, database } = args;
  const map = await listEventMeta({
    connectionId: conn.id,
    engine: String(conn.engine),
    database,
  });
  const list = Object.values(map);
  const lines = [
    `# 事件数据字典 · ${database}`,
    "",
    `连接：${conn.name}（${conn.engine}）`,
    `生成时间：${new Date().toLocaleString()}`,
    "",
  ];
  for (const ev of list) {
    lines.push(
      `## ${ev.name}`,
      "",
      `- 状态: ${ev.status || "—"}`,
      `- 类型: ${ev.eventType || "—"}`,
      `- 定义者: ${ev.definer || "—"}`,
      `- 注释: ${ev.comment || "—"}`,
      "",
    );
    try {
      const ddl = await fetchEventDdl({
        conn,
        database,
        name: ev.name,
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
    `${database}-events-dictionary.md`,
    lines.join("\n"),
    "text/markdown",
  );
  return list.length;
}
