import { newId, nowIso, readJson, writeJson } from "../../lib/localDocs";
import {
  computeNextRun,
  type AutomationJob,
  type JobRun,
} from "./types";

const JOBS_KEY = "mycat_automation_jobs";
const RUNS_KEY = "mycat_automation_runs";
const MAX_RUNS = 300;

export const AUTOMATION_CHANGED = "mycat:automation-changed";

function emit() {
  window.dispatchEvent(new Event(AUTOMATION_CHANGED));
}

function readJobs(): AutomationJob[] {
  const items = readJson<AutomationJob[]>(JOBS_KEY, []);
  return Array.isArray(items) ? items.filter((j) => j && j.id) : [];
}

function writeJobs(items: AutomationJob[]) {
  writeJson(JOBS_KEY, items);
}

export function listJobs(): AutomationJob[] {
  return readJobs().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getJob(id: string): AutomationJob | null {
  return readJobs().find((j) => j.id === id) ?? null;
}

export function saveJob(job: AutomationJob): AutomationJob {
  const next: AutomationJob = {
    ...job,
    updatedAt: nowIso(),
    nextRunAt: job.enabled ? computeNextRun(job.schedule) : null,
  };
  const items = readJobs();
  const idx = items.findIndex((j) => j.id === next.id);
  if (idx >= 0) items[idx] = next;
  else items.push(next);
  writeJobs(items);
  emit();
  return next;
}

export function deleteJob(id: string): void {
  writeJobs(readJobs().filter((j) => j.id !== id));
  writeJson(
    RUNS_KEY,
    readRuns().filter((r) => r.jobId !== id),
  );
  emit();
}

export function duplicateJob(id: string): AutomationJob | null {
  const src = getJob(id);
  if (!src) return null;
  const at = nowIso();
  const copy: AutomationJob = {
    ...src,
    id: newId("job"),
    name: `${src.name} 副本`,
    enabled: false,
    createdAt: at,
    updatedAt: at,
    lastRunAt: null,
    lastStatus: "never",
    lastMessage: null,
    nextRunAt: null,
    steps: src.steps.map((s) => ({ ...s, id: newId("step") })),
  };
  writeJobs([...readJobs(), copy]);
  emit();
  return copy;
}

/** 仅更新运行时字段（不重算计划）。 */
export function patchJob(
  id: string,
  patch: Partial<AutomationJob>,
): AutomationJob | null {
  const items = readJobs();
  const idx = items.findIndex((j) => j.id === id);
  if (idx < 0) return null;
  const next = { ...items[idx]!, ...patch };
  items[idx] = next;
  writeJobs(items);
  emit();
  return next;
}

export function readRuns(): JobRun[] {
  const items = readJson<JobRun[]>(RUNS_KEY, []);
  return Array.isArray(items) ? items.filter((r) => r && r.id) : [];
}

export function listRuns(jobId?: string): JobRun[] {
  const items = readRuns().sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  return jobId ? items.filter((r) => r.jobId === jobId) : items;
}

export function appendRun(run: JobRun): void {
  const items = [run, ...readRuns()].slice(0, MAX_RUNS);
  writeJson(RUNS_KEY, items);
  emit();
}

export function clearRuns(jobId?: string): void {
  writeJson(
    RUNS_KEY,
    jobId ? readRuns().filter((r) => r.jobId !== jobId) : [],
  );
  emit();
}
