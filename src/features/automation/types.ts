import { newId, nowIso } from "../../lib/localDocs";

export type ScheduleKind = "manual" | "interval" | "daily" | "weekly";

export type JobSchedule = {
  kind: ScheduleKind;
  /** 间隔执行：分钟数 */
  intervalMinutes: number;
  /** 每日 / 每周：HH:mm */
  time: string;
  /** 每周：0=周日 … 6=周六 */
  weekday: number;
};

export type JobStep = {
  id: string;
  name: string;
  sql: string;
  /** 该步骤失败后是否继续执行后续步骤 */
  continueOnError: boolean;
};

export type JobStatus = "never" | "success" | "failed" | "running";

export type AutomationJob = {
  id: string;
  name: string;
  connectionId: string;
  connectionName: string;
  database: string;
  enabled: boolean;
  schedule: JobSchedule;
  steps: JobStep[];
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastStatus: JobStatus;
  lastMessage: string | null;
  nextRunAt: string | null;
};

export type JobLogLevel = "info" | "success" | "error";

export type JobLogEntry = {
  at: string;
  level: JobLogLevel;
  text: string;
};

export type JobRun = {
  id: string;
  jobId: string;
  jobName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "failed";
  entries: JobLogEntry[];
};

export const WEEKDAY_LABELS = [
  "周日",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
];

export function defaultSchedule(): JobSchedule {
  return { kind: "manual", intervalMinutes: 30, time: "02:00", weekday: 1 };
}

export function newStep(index = 1): JobStep {
  return {
    id: newId("step"),
    name: `步骤 ${index}`,
    sql: "",
    continueOnError: false,
  };
}

export function newJob(args: {
  name: string;
  connectionId: string;
  connectionName: string;
  database: string;
}): AutomationJob {
  const at = nowIso();
  return {
    id: newId("job"),
    name: args.name,
    connectionId: args.connectionId,
    connectionName: args.connectionName,
    database: args.database,
    enabled: false,
    schedule: defaultSchedule(),
    steps: [newStep(1)],
    createdAt: at,
    updatedAt: at,
    lastRunAt: null,
    lastStatus: "never",
    lastMessage: null,
    nextRunAt: null,
  };
}

function parseTime(value: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return { h: 2, m: 0 };
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return { h, m: min };
}

export function describeSchedule(s: JobSchedule): string {
  if (s.kind === "manual") return "手动";
  if (s.kind === "interval") {
    const mins = Math.max(1, Math.round(s.intervalMinutes || 1));
    if (mins % 60 === 0) return `每 ${mins / 60} 小时`;
    return `每 ${mins} 分钟`;
  }
  if (s.kind === "daily") return `每天 ${s.time || "02:00"}`;
  const day = WEEKDAY_LABELS[s.weekday] ?? "周一";
  return `每${day} ${s.time || "02:00"}`;
}

/** 依据计划计算下一次运行时间；手动计划返回 null。 */
export function computeNextRun(
  s: JobSchedule,
  from: Date = new Date(),
): string | null {
  if (s.kind === "manual") return null;
  if (s.kind === "interval") {
    const mins = Math.max(1, Math.round(s.intervalMinutes || 1));
    return new Date(from.getTime() + mins * 60_000).toISOString();
  }
  const { h, m } = parseTime(s.time);
  const next = new Date(from.getTime());
  next.setHours(h, m, 0, 0);
  if (s.kind === "daily") {
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next.toISOString();
  }
  const target = Math.min(6, Math.max(0, Math.round(s.weekday)));
  let delta = (target - next.getDay() + 7) % 7;
  if (delta === 0 && next.getTime() <= from.getTime()) delta = 7;
  next.setDate(next.getDate() + delta);
  return next.toISOString();
}

export function statusLabel(status: JobStatus): string {
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  if (status === "running") return "运行中";
  return "未运行";
}
