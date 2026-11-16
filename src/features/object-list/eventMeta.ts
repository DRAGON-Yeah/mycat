import { executeSql, openConnection } from "../connections/sessionApi";
import { engineKey } from "../nav-tree/sqlIdent";

export type EventMeta = {
  name: string;
  status: string;
  eventType: string;
  executeAt: string;
  intervalValue: string;
  intervalField: string;
  starts: string;
  ends: string;
  definer: string;
  onCompletion: string;
  created: string;
  lastAltered: string;
  lastExecuted: string;
  comment: string;
};

function esc(s: string) {
  return s.replace(/'/g, "''");
}

function cell(v: unknown) {
  if (v == null) return "";
  return String(v);
}

export function formatEventSchedule(m: EventMeta | null | undefined): string {
  if (!m) return "—";
  if (m.eventType.toUpperCase().includes("ONE")) {
    return m.executeAt ? `AT ${m.executeAt}` : "ONE TIME";
  }
  const every =
    m.intervalValue && m.intervalField
      ? `EVERY ${m.intervalValue} ${m.intervalField}`
      : "RECURRENT";
  const parts = [every];
  if (m.starts) parts.push(`STARTS ${m.starts}`);
  if (m.ends) parts.push(`ENDS ${m.ends}`);
  return parts.join(" ");
}

export function formatEventStatus(s?: string) {
  if (!s) return "—";
  const u = s.toUpperCase();
  if (u === "ENABLED") return "启用";
  if (u === "DISABLED") return "禁用";
  if (u === "SLAVESIDE_DISABLED") return "从库禁用";
  return s;
}

export function formatEventType(t?: string) {
  if (!t) return "—";
  const u = t.toUpperCase();
  if (u.includes("ONE")) return "一次性";
  if (u.includes("RECUR")) return "循环";
  return t;
}

export async function listEventMeta(args: {
  connectionId: string;
  engine: string;
  database: string;
}): Promise<Record<string, EventMeta>> {
  const { connectionId, engine, database } = args;
  const e = engineKey(engine);
  const map: Record<string, EventMeta> = {};
  await openConnection(connectionId);

  if (e === "mysql" || e === "mariadb") {
    const out = await executeSql(
      connectionId,
      `SELECT EVENT_NAME, IFNULL(STATUS,''), IFNULL(EVENT_TYPE,''),
              IFNULL(EXECUTE_AT,''), IFNULL(INTERVAL_VALUE,''), IFNULL(INTERVAL_FIELD,''),
              IFNULL(STARTS,''), IFNULL(ENDS,''), IFNULL(DEFINER,''),
              IFNULL(ON_COMPLETION,''), IFNULL(CREATED,''), IFNULL(LAST_ALTERED,''),
              IFNULL(LAST_EXECUTED,''), IFNULL(EVENT_COMMENT,'')
       FROM information_schema.EVENTS
       WHERE EVENT_SCHEMA = '${esc(database)}'
       ORDER BY EVENT_NAME`,
      database,
    );
    for (const row of out.rows) {
      const name = cell(row[0]);
      if (!name) continue;
      map[name] = {
        name,
        status: cell(row[1]),
        eventType: cell(row[2]),
        executeAt: cell(row[3]),
        intervalValue: cell(row[4]),
        intervalField: cell(row[5]),
        starts: cell(row[6]),
        ends: cell(row[7]),
        definer: cell(row[8]),
        onCompletion: cell(row[9]),
        created: cell(row[10]),
        lastAltered: cell(row[11]),
        lastExecuted: cell(row[12]),
        comment: cell(row[13]),
      };
    }
    return map;
  }

  // PG / SQLite: no MySQL Event Scheduler
  return map;
}

export async function listEvents(args: {
  connectionId: string;
  engine: string;
  database: string;
}): Promise<EventMeta[]> {
  const map = await listEventMeta(args);
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, "zh"));
}
