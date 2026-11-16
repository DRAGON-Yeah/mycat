import { executeSql, openConnection } from "../connections/sessionApi";
import { engineKey } from "../nav-tree/sqlIdent";

export type RoutineType = "FUNCTION" | "PROCEDURE";

export type RoutineMeta = {
  name: string;
  routineType: RoutineType;
  returns: string;
  definer: string;
  securityType: string;
  created: string;
  lastAltered: string;
  comment: string;
  isDeterministic: string;
};

function esc(s: string) {
  return s.replace(/'/g, "''");
}

export async function listRoutineMeta(args: {
  connectionId: string;
  engine: string;
  database: string;
}): Promise<Record<string, RoutineMeta>> {
  const { connectionId, engine, database } = args;
  const e = engineKey(engine);
  const map: Record<string, RoutineMeta> = {};
  await openConnection(connectionId);

  if (e === "mysql") {
    const out = await executeSql(
      connectionId,
      `SELECT ROUTINE_NAME, ROUTINE_TYPE, IFNULL(DTD_IDENTIFIER,''), IFNULL(DEFINER,''),
              IFNULL(SECURITY_TYPE,''), IFNULL(CREATED,''), IFNULL(LAST_ALTERED,''),
              IFNULL(ROUTINE_COMMENT,''), IFNULL(IS_DETERMINISTIC,'')
       FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA = '${esc(database)}'
       ORDER BY ROUTINE_NAME`,
      database,
    );
    for (const row of out.rows) {
      const name = String(row[0] ?? "");
      if (!name) continue;
      const rt = String(row[1] ?? "PROCEDURE").toUpperCase();
      map[name] = {
        name,
        routineType: rt === "FUNCTION" ? "FUNCTION" : "PROCEDURE",
        returns: String(row[2] ?? ""),
        definer: String(row[3] ?? ""),
        securityType: String(row[4] ?? ""),
        created: String(row[5] ?? ""),
        lastAltered: String(row[6] ?? ""),
        comment: String(row[7] ?? ""),
        isDeterministic: String(row[8] ?? ""),
      };
    }
    return map;
  }

  if (e === "postgres" || e === "postgresql") {
    const out = await executeSql(
      connectionId,
      `SELECT p.proname,
              CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
              COALESCE(pg_catalog.pg_get_function_result(p.oid), ''),
              pg_catalog.pg_get_userbyid(p.proowner),
              '',
              '',
              '',
              COALESCE(obj_description(p.oid, 'pg_proc'), ''),
              CASE WHEN p.provolatile = 'i' THEN 'YES' ELSE 'NO' END
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = current_schema()
         AND p.prokind IN ('f', 'p')
       ORDER BY p.proname`,
      database,
    );
    for (const row of out.rows) {
      const name = String(row[0] ?? "");
      if (!name) continue;
      const rt = String(row[1] ?? "FUNCTION").toUpperCase();
      map[name] = {
        name,
        routineType: rt === "PROCEDURE" ? "PROCEDURE" : "FUNCTION",
        returns: String(row[2] ?? ""),
        definer: String(row[3] ?? ""),
        securityType: String(row[4] ?? "") || "—",
        created: String(row[5] ?? "") || "—",
        lastAltered: String(row[6] ?? "") || "—",
        comment: String(row[7] ?? ""),
        isDeterministic: String(row[8] ?? ""),
      };
    }
    return map;
  }

  // SQLite: no stored routines
  return map;
}

export async function listRoutines(args: {
  connectionId: string;
  engine: string;
  database: string;
}): Promise<RoutineMeta[]> {
  const map = await listRoutineMeta(args);
  return Object.values(map).sort((a, b) =>
    a.name.localeCompare(b.name, "zh"),
  );
}

export function formatRoutineType(t?: string) {
  if (!t) return "—";
  return t === "FUNCTION" ? "函数" : t === "PROCEDURE" ? "过程" : t;
}
