import { executeSql, openConnection } from "../connections/sessionApi";
import { engineKey } from "../nav-tree/sqlIdent";

export type ViewMeta = {
  name: string;
  /** DEFINER / INVOKER */
  securityType: string;
  /** NONE / LOCAL / CASCADED */
  checkOption: string;
  /** YES / NO */
  isUpdatable: string;
  definer: string;
};

export async function listViewMeta(args: {
  connectionId: string;
  engine: string;
  database: string;
}): Promise<Record<string, ViewMeta>> {
  const { connectionId, engine, database } = args;
  const e = engineKey(engine);
  const map: Record<string, ViewMeta> = {};
  await openConnection(connectionId);

  if (e === "mysql") {
    const out = await executeSql(
      connectionId,
      `SELECT TABLE_NAME, SECURITY_TYPE, CHECK_OPTION, IS_UPDATABLE, DEFINER
       FROM information_schema.VIEWS
       WHERE TABLE_SCHEMA = '${database.replace(/'/g, "''")}'
       ORDER BY TABLE_NAME`,
      database,
    );
    for (const row of out.rows) {
      const name = String(row[0] ?? "");
      if (!name) continue;
      map[name] = {
        name,
        securityType: String(row[1] ?? ""),
        checkOption: String(row[2] ?? ""),
        isUpdatable: String(row[3] ?? ""),
        definer: String(row[4] ?? ""),
      };
    }
    return map;
  }

  if (e === "postgres" || e === "postgresql") {
    const out = await executeSql(
      connectionId,
      `SELECT n.nspname, c.relname,
              CASE WHEN c.relkind = 'v' THEN 'DEFINER' ELSE '' END,
              '',
              'NO',
              pg_catalog.pg_get_userbyid(c.relowner)
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('v', 'm')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND n.nspname NOT LIKE 'pg\\_%'
       ORDER BY n.nspname, c.relname`,
      database,
    );
    for (const row of out.rows) {
      const schema = String(row[0] ?? "");
      const relname = String(row[1] ?? "");
      if (!relname) continue;
      const name = schema && schema !== "public" ? `${schema}.${relname}` : relname;
      map[name] = {
        name,
        securityType: String(row[2] ?? "—"),
        checkOption: String(row[3] ?? ""),
        isUpdatable: "否",
        definer: String(row[5] ?? ""),
      };
    }
    return map;
  }

  // SQLite: no rich view meta
  return map;
}

export function formatUpdatable(v?: string): string {
  if (!v) return "—";
  const u = v.toUpperCase();
  if (u === "YES" || u === "TRUE" || u === "1") return "是";
  if (u === "NO" || u === "FALSE" || u === "0") return "否";
  return v;
}

export function formatCheckOption(v?: string): string {
  if (!v || v.toUpperCase() === "NONE" || v === "") return "";
  return v;
}
