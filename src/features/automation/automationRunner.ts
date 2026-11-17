import { executeSql, openConnection } from "../connections/sessionApi";
import { newId, nowIso } from "../../lib/localDocs";
import {
  appendRun,
  getJob,
  listJobs,
  patchJob,
} from "./automationApi";
import {
  computeNextRun,
  type AutomationJob,
  type JobLogEntry,
  type JobLogLevel,
  type JobRun,
} from "./types";

export type RunListener = (entry: JobLogEntry) => void;

function entry(level: JobLogLevel, text: string): JobLogEntry {
  return { at: nowIso(), level, text };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 执行一个自动化作业：按顺序运行每个步骤的 SQL。
 * 步骤失败时依据 continueOnError 决定是否继续。
 */
export async function runJob(
  job: AutomationJob,
  onEntry?: RunListener,
): Promise<JobRun> {
  const startedAt = new Date();
  const entries: JobLogEntry[] = [];
  const push = (level: JobLogLevel, text: string) => {
    const e = entry(level, text);
    entries.push(e);
    onEntry?.(e);
  };

  push("info", `作业「${job.name}」开始运行（${job.steps.length} 个步骤）`);
  patchJob(job.id, { lastStatus: "running" });

  let status: "success" | "failed" = "success";
  try {
    await openConnection(job.connectionId);
    push(
      "info",
      `已连接「${job.connectionName}」${job.database ? ` · 数据库 ${job.database}` : ""}`,
    );

    for (let i = 0; i < job.steps.length; i++) {
      const step = job.steps[i]!;
      const sql = step.sql.trim();
      if (!sql) {
        push("info", `步骤 ${i + 1}「${step.name}」为空，已跳过`);
        continue;
      }
      push("info", `步骤 ${i + 1}/${job.steps.length}「${step.name}」执行中…`);
      try {
        const out = await executeSql(
          job.connectionId,
          sql,
          job.database || null,
        );
        const detail =
          out.columns.length > 0
            ? `${out.rows.length} 行结果`
            : `影响 ${out.rowsAffected} 行`;
        push(
          "success",
          `步骤 ${i + 1} 完成 · ${detail} · ${out.elapsedMs} ms`,
        );
      } catch (err) {
        status = "failed";
        push("error", `步骤 ${i + 1} 失败：${errorText(err)}`);
        if (!step.continueOnError) {
          push("error", "已中止后续步骤");
          break;
        }
        push("info", "按设置继续执行后续步骤");
      }
    }
  } catch (err) {
    status = "failed";
    push("error", `连接失败：${errorText(err)}`);
  }

  const finishedAt = new Date();
  push(
    status === "success" ? "success" : "error",
    `作业${status === "success" ? "完成" : "失败"} · 耗时 ${finishedAt.getTime() - startedAt.getTime()} ms`,
  );

  const run: JobRun = {
    id: newId("run"),
    jobId: job.id,
    jobName: job.name,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    status,
    entries,
  };
  appendRun(run);

  const lastError = [...entries].reverse().find((e) => e.level === "error");
  patchJob(job.id, {
    lastRunAt: finishedAt.toISOString(),
    lastStatus: status,
    lastMessage: lastError?.text ?? "执行成功",
    nextRunAt: job.enabled ? computeNextRun(job.schedule, finishedAt) : null,
  });

  return run;
}

export async function runJobById(
  jobId: string,
  onEntry?: RunListener,
): Promise<JobRun | null> {
  const job = getJob(jobId);
  if (!job) return null;
  return runJob(job, onEntry);
}

/* ------------------------------------------------------------------ */
/* 定时调度器：应用运行期间每 15 秒检查一次到期作业                    */
/* ------------------------------------------------------------------ */

const TICK_MS = 15_000;
let timer: number | null = null;
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const job of listJobs()) {
      if (!job.enabled) continue;
      if (!job.nextRunAt) {
        patchJob(job.id, { nextRunAt: computeNextRun(job.schedule) });
        continue;
      }
      const due = new Date(job.nextRunAt).getTime();
      if (Number.isNaN(due) || due > now) continue;
      const fresh = getJob(job.id);
      if (!fresh || !fresh.enabled) continue;
      // 先推迟下次运行时间，避免执行期间重复触发
      patchJob(fresh.id, {
        nextRunAt: computeNextRun(fresh.schedule, new Date()),
      });
      await runJob(fresh);
    }
  } catch {
    // 调度失败不应影响应用
  } finally {
    ticking = false;
  }
}

export function startAutomationScheduler(): void {
  if (timer != null) return;
  timer = window.setInterval(() => void tick(), TICK_MS);
  window.setTimeout(() => void tick(), 3000);
}

export function stopAutomationScheduler(): void {
  if (timer == null) return;
  window.clearInterval(timer);
  timer = null;
}
