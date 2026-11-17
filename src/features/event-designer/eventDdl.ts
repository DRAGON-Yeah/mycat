import { quoteIdent, quoteTable } from "../nav-tree/sqlIdent";

export type EventScheduleKind = "AT" | "EVERY";

export type ParsedEvent = {
  name: string;
  status: "ENABLE" | "DISABLE" | "DISABLE ON SLAVE";
  onCompletion: "PRESERVE" | "NOT PRESERVE";
  definer: string;
  comment: string;
  scheduleKind: EventScheduleKind;
  atDatetime: string;
  everyExpr: string;
  starts: string;
  ends: string;
  /** Raw ON SCHEDULE clause fallback */
  scheduleRaw: string;
  body: string;
  rawDdl: string;
};

const EMPTY: ParsedEvent = {
  name: "",
  status: "ENABLE",
  onCompletion: "NOT PRESERVE",
  definer: "",
  comment: "",
  scheduleKind: "AT",
  atDatetime: "CURRENT_TIMESTAMP",
  everyExpr: "1 DAY",
  starts: "",
  ends: "",
  scheduleRaw: "",
  body: "",
  rawDdl: "",
};

export function parseEventDdl(ddl: string): ParsedEvent {
  const raw = ddl.trim();
  if (!raw) return { ...EMPTY };

  const nameMatch = raw.match(
    /create\s+(?:definer\s*=\s*[^\s]+\s+)?event\s+(?:`?[\w]+`?\.)?`?([\w]+)`?/i,
  );
  const name = nameMatch?.[1] ?? "";

  const definerMatch = raw.match(/definer\s*=\s*`?([^`\s]+)`?@`?([^`\s]+)`?/i);
  const definer = definerMatch
    ? `${definerMatch[1]}@${definerMatch[2]}`
    : "";

  const status: ParsedEvent["status"] = /disable\s+on\s+slave/i.test(raw)
    ? "DISABLE ON SLAVE"
    : /\bdisable\b/i.test(raw)
      ? "DISABLE"
      : "ENABLE";

  const onCompletion: "PRESERVE" | "NOT PRESERVE" =
    /on\s+completion\s+preserve/i.test(raw) &&
    !/on\s+completion\s+not\s+preserve/i.test(raw)
      ? "PRESERVE"
      : "NOT PRESERVE";

  const commentMatch = raw.match(/comment\s+'((?:\\'|[^'])*)'/i);
  const comment = commentMatch?.[1]?.replace(/\\'/g, "'") ?? "";

  const schedMatch = raw.match(
    /on\s+schedule\s+([\s\S]*?)(?=\s+on\s+completion|\s+enable|\s+disable|\s+comment|\s+do\b)/i,
  );
  const scheduleRaw = schedMatch?.[1]?.trim() ?? "";

  let scheduleKind: EventScheduleKind = "EVERY";
  let atDatetime = "";
  let everyExpr = "1 DAY";
  let starts = "";
  let ends = "";

  const atM = scheduleRaw.match(/^at\s+(.+?)(?:\s+on\s+completion|$)/i) ||
    scheduleRaw.match(/^at\s+(.+)$/i);
  const everyM = scheduleRaw.match(
    /^every\s+(.+?)(?:\s+starts\s+(.+?))?(?:\s+ends\s+(.+))?$/i,
  );

  if (/^\s*at\b/i.test(scheduleRaw)) {
    scheduleKind = "AT";
    atDatetime = atM?.[1]?.trim() || scheduleRaw.replace(/^\s*at\s+/i, "").trim();
  } else if (everyM) {
    scheduleKind = "EVERY";
    everyExpr = everyM[1]?.trim() || "1 DAY";
    starts = everyM[2]?.trim() || "";
    ends = everyM[3]?.trim() || "";
  } else if (scheduleRaw) {
    // keep raw; default EVERY fields
    if (/\bat\b/i.test(scheduleRaw)) {
      scheduleKind = "AT";
      atDatetime = scheduleRaw.replace(/^\s*at\s+/i, "").trim();
    }
  }

  let body = "BEGIN\n\nEND";
  const doIdx = raw.search(/\bdo\b/i);
  if (doIdx >= 0) {
    body = raw
      .slice(doIdx)
      .replace(/^\s*do\s+/i, "")
      .replace(/;\s*$/, "")
      .trim();
  }

  return {
    name,
    status,
    onCompletion,
    definer,
    comment,
    scheduleKind,
    atDatetime,
    everyExpr,
    starts,
    ends,
    scheduleRaw,
    body,
    rawDdl: raw,
  };
}

export const EVENT_INTERVAL_UNITS = [
  "YEAR",
  "QUARTER",
  "MONTH",
  "WEEK",
  "DAY",
  "HOUR",
  "MINUTE",
  "SECOND",
  "YEAR_MONTH",
  "DAY_HOUR",
  "DAY_MINUTE",
  "DAY_SECOND",
  "HOUR_MINUTE",
  "HOUR_SECOND",
  "MINUTE_SECOND",
] as const;

export type EventIntervalUnit = (typeof EVENT_INTERVAL_UNITS)[number];

export function splitIntervalExpr(expr: string): {
  value: string;
  unit: EventIntervalUnit;
} {
  const m = expr.trim().match(/^(\d+(?:\.\d+)?)\s+([A-Za-z_]+)$/);
  if (m) {
    const unit = m[2]!.toUpperCase() as EventIntervalUnit;
    if ((EVENT_INTERVAL_UNITS as readonly string[]).includes(unit)) {
      return { value: m[1]!, unit };
    }
  }
  return { value: "1", unit: "DAY" };
}

export function buildCreateEventSql(args: {
  engine: string;
  database: string;
  name: string;
  status: "ENABLE" | "DISABLE" | "DISABLE ON SLAVE";
  onCompletion: "PRESERVE" | "NOT PRESERVE";
  definer?: string;
  comment?: string;
  scheduleKind: EventScheduleKind;
  atDatetime: string;
  /** e.g. AT CURRENT_TIMESTAMP + INTERVAL 1 HOUR */
  atIntervalEnabled?: boolean;
  atIntervalValue?: string;
  atIntervalUnit?: string;
  everyValue?: string;
  everyUnit?: string;
  everyExpr?: string;
  startsEnabled?: boolean;
  starts?: string;
  startsIntervalEnabled?: boolean;
  startsIntervalValue?: string;
  startsIntervalUnit?: string;
  endsEnabled?: boolean;
  ends?: string;
  endsIntervalEnabled?: boolean;
  endsIntervalValue?: string;
  endsIntervalUnit?: string;
  scheduleRaw?: string;
  body: string;
}): string {
  const qt = quoteTable(args.engine, args.database, args.name);
  let schedule: string;
  if (args.scheduleRaw?.trim()) {
    schedule = args.scheduleRaw.trim().replace(/^on\s+schedule\s+/i, "");
  } else if (args.scheduleKind === "AT") {
    let at = args.atDatetime.trim() || "CURRENT_TIMESTAMP";
    if (
      args.atIntervalEnabled &&
      args.atIntervalValue?.trim() &&
      args.atIntervalUnit
    ) {
      at = `${at} + INTERVAL ${args.atIntervalValue.trim()} ${args.atIntervalUnit}`;
    }
    schedule = `AT ${at}`;
  } else {
    const every =
      args.everyValue?.trim() && args.everyUnit
        ? `${args.everyValue.trim()} ${args.everyUnit}`
        : args.everyExpr?.trim() || "1 DAY";
    schedule = `EVERY ${every}`;
    if (args.startsEnabled && args.starts?.trim()) {
      let s = args.starts.trim();
      if (
        args.startsIntervalEnabled &&
        args.startsIntervalValue?.trim() &&
        args.startsIntervalUnit
      ) {
        s = `${s} + INTERVAL ${args.startsIntervalValue.trim()} ${args.startsIntervalUnit}`;
      }
      schedule += `\nSTARTS ${s}`;
    }
    if (args.endsEnabled && args.ends?.trim()) {
      let e = args.ends.trim();
      if (
        args.endsIntervalEnabled &&
        args.endsIntervalValue?.trim() &&
        args.endsIntervalUnit
      ) {
        e = `${e} + INTERVAL ${args.endsIntervalValue.trim()} ${args.endsIntervalUnit}`;
      }
      schedule += `\nENDS ${e}`;
    }
  }

  const definer = args.definer?.trim();
  const head = definer
    ? `CREATE DEFINER = ${formatDefiner(definer)} EVENT ${qt}`
    : `CREATE EVENT ${qt}`;

  const parts = [
    head,
    `ON SCHEDULE`,
    schedule,
    `ON COMPLETION ${args.onCompletion}`,
    args.status,
  ];
  if (args.comment?.trim()) {
    parts.push(`COMMENT '${args.comment.trim().replace(/'/g, "\\'")}'`);
  }
  let body = args.body.trim();
  // 空事件体生成 `DO ;` 是非法 SQL，退化为空语句块
  if (!body) body = "BEGIN\nEND";
  if (!/;\s*$/.test(body)) body = `${body};`;
  parts.push(`DO ${body}`);
  const sql = parts.join("\n");
  return sql.endsWith(";") ? sql : `${sql};`;
}

function formatDefiner(d: string): string {
  // Accept user@host or already-quoted
  if (d.includes("`") || d.includes("'")) return d;
  const m = d.match(/^([^@]+)@(.+)$/);
  if (m) return `\`${m[1]}\`@\`${m[2]}\``;
  return `\`${d}\`@\`%\``;
}

export function rewriteCreateEventName(
  ddl: string,
  newName: string,
  engine: string,
  database: string,
): string {
  const p = parseEventDdl(ddl);
  return buildCreateEventSql({
    engine,
    database,
    name: newName,
    status: p.status,
    onCompletion: p.onCompletion,
    definer: p.definer,
    comment: p.comment,
    scheduleKind: p.scheduleKind,
    atDatetime: p.atDatetime,
    everyExpr: p.everyExpr,
    startsEnabled: !!p.starts,
    starts: p.starts,
    endsEnabled: !!p.ends,
    ends: p.ends,
    scheduleRaw: p.scheduleRaw,
    body: p.body,
  });
}

export function buildDropEventSql(args: {
  engine: string;
  database: string;
  name: string;
}): string {
  const qt = quoteTable(args.engine, args.database, args.name);
  return `DROP EVENT IF EXISTS ${qt}`;
}

export function buildAlterEventStatusSql(args: {
  engine: string;
  database: string;
  name: string;
  enable: boolean;
}): string {
  const qt = quoteTable(args.engine, args.database, args.name);
  return `ALTER EVENT ${qt} ${args.enable ? "ENABLE" : "DISABLE"}`;
}

export function buildRenameEventViaAlterSql(args: {
  engine: string;
  database: string;
  name: string;
  next: string;
}): string {
  const qt = quoteTable(args.engine, args.database, args.name);
  const qn = quoteIdent(args.engine, args.next);
  return `ALTER EVENT ${qt} RENAME TO ${qn}`;
}
