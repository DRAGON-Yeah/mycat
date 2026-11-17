import { useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionDto } from "../connections/types";
import { listDatabases, openConnection } from "../connections/sessionApi";
import { confirmDialog } from "../../lib/confirm";
import { formatDateTime, formatRelative } from "../../lib/localDocs";
import {
  AUTOMATION_CHANGED,
  deleteJob,
  listRuns,
  saveJob,
} from "./automationApi";
import { runJob } from "./automationRunner";
import {
  WEEKDAY_LABELS,
  computeNextRun,
  describeSchedule,
  newStep,
  statusLabel,
  type AutomationJob,
  type JobLogEntry,
  type JobRun,
  type JobStep,
  type ScheduleKind,
} from "./types";

type Props = {
  job: AutomationJob;
  connections: ConnectionDto[];
  onSaved: (job: AutomationJob) => void;
  onDeleted: () => void;
  onMessage: (msg: string) => void;
};

type TabId = "steps" | "schedule" | "history";

const TABS: { id: TabId; label: string }[] = [
  { id: "steps", label: "步骤" },
  { id: "schedule", label: "计划" },
  { id: "history", label: "运行历史" },
];

function cloneJob(job: AutomationJob): AutomationJob {
  return { ...job, schedule: { ...job.schedule }, steps: job.steps.map((s) => ({ ...s })) };
}

export function JobEditor({
  job,
  connections,
  onSaved,
  onDeleted,
  onMessage,
}: Props) {
  const [draft, setDraft] = useState<AutomationJob>(() => cloneJob(job));
  const [tab, setTab] = useState<TabId>("steps");
  const [dirty, setDirty] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [liveLog, setLiveLog] = useState<JobLogEntry[]>([]);
  const [runs, setRuns] = useState<JobRun[]>(() => listRuns(job.id));
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // 仅在切换到另一个作业时重置草稿；运行期间的运行时字段更新不打断编辑。
  useEffect(() => {
    setDraft(cloneJob(job));
    setDirty(false);
    setLiveLog([]);
    setRuns(listRuns(job.id));
    setOpenRunId(null);
    setTab("steps");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  useEffect(() => {
    function reload() {
      setRuns(listRuns(job.id));
    }
    window.addEventListener(AUTOMATION_CHANGED, reload);
    return () => window.removeEventListener(AUTOMATION_CHANGED, reload);
  }, [job.id]);

  useEffect(() => {
    let cancelled = false;
    if (!draft.connectionId) {
      setDatabases([]);
      return;
    }
    void (async () => {
      try {
        await openConnection(draft.connectionId);
        const list = await listDatabases(draft.connectionId);
        if (!cancelled) setDatabases(list);
      } catch {
        if (!cancelled) setDatabases([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draft.connectionId]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveLog]);

  function patch(next: Partial<AutomationJob>) {
    setDraft((prev) => ({ ...prev, ...next }));
    setDirty(true);
  }

  function patchStep(id: string, next: Partial<JobStep>) {
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === id ? { ...s, ...next } : s)),
    }));
    setDirty(true);
  }

  function addStep() {
    setDraft((prev) => ({
      ...prev,
      steps: [...prev.steps, newStep(prev.steps.length + 1)],
    }));
    setDirty(true);
  }

  function removeStep(id: string) {
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.filter((s) => s.id !== id),
    }));
    setDirty(true);
  }

  function moveStep(id: string, delta: number) {
    setDraft((prev) => {
      const idx = prev.steps.findIndex((s) => s.id === id);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= prev.steps.length) return prev;
      const steps = prev.steps.slice();
      const [item] = steps.splice(idx, 1);
      steps.splice(target, 0, item!);
      return { ...prev, steps };
    });
    setDirty(true);
  }

  function persist(): AutomationJob {
    const saved = saveJob(draft);
    setDraft(cloneJob(saved));
    setDirty(false);
    onSaved(saved);
    return saved;
  }

  function handleSave() {
    if (!draft.name.trim()) {
      onMessage("请填写作业名称");
      return;
    }
    const saved = persist();
    onMessage(`已保存作业「${saved.name}」`);
  }

  async function handleRun() {
    if (running) return;
    const target = dirty ? persist() : draft;
    if (target.steps.every((s) => !s.sql.trim())) {
      onMessage("请先填写至少一个步骤的 SQL");
      return;
    }
    setRunning(true);
    setLiveLog([]);
    setTab("history");
    try {
      const run = await runJob(target, (e) =>
        setLiveLog((prev) => [...prev, e]),
      );
      setDraft((prev) => ({
        ...prev,
        lastRunAt: run.finishedAt,
        lastStatus: run.status,
        lastMessage:
          [...run.entries].reverse().find((e) => e.level === "error")?.text ??
          "执行成功",
      }));
      onMessage(
        run.status === "success"
          ? `作业「${target.name}」执行成功`
          : `作业「${target.name}」执行失败`,
      );
    } catch (err) {
      onMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function handleDelete() {
    const ok = await confirmDialog({
      title: "删除作业",
      message: `确定删除作业「${draft.name}」及其运行历史？`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    deleteJob(draft.id);
    onDeleted();
  }

  const nextRun = useMemo(
    () => (draft.enabled ? computeNextRun(draft.schedule) : null),
    [draft.enabled, draft.schedule],
  );

  const status = running ? "running" : draft.lastStatus;

  return (
    <div className="auto-editor">
      <header className="auto-editor-head">
        <input
          className="auto-name"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="作业名称"
          aria-label="作业名称"
        />
        <span className={`auto-status is-${status}`}>
          {running ? "运行中" : statusLabel(draft.lastStatus)}
        </span>
        <div className="auto-editor-actions">
          <button
            type="button"
            className="obj-tool-btn"
            disabled={!dirty}
            onClick={handleSave}
          >
            保存
          </button>
          <button
            type="button"
            className="obj-tool-btn is-primary-text"
            disabled={running}
            onClick={() => void handleRun()}
          >
            {running ? "运行中…" : "运行"}
          </button>
          <button
            type="button"
            className="obj-tool-btn is-danger-text"
            disabled={running}
            onClick={() => void handleDelete()}
          >
            删除
          </button>
        </div>
      </header>

      <div className="auto-meta">
        <label>
          <span>连接</span>
          <select
            value={draft.connectionId}
            onChange={(e) => {
              const conn = connections.find((c) => c.id === e.target.value);
              patch({
                connectionId: e.target.value,
                connectionName: conn?.name ?? "",
                database: conn?.database?.trim() || "",
              });
            }}
          >
            <option value="">— 选择连接 —</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>数据库</span>
          <input
            list={`auto-db-${draft.id}`}
            value={draft.database}
            onChange={(e) => patch({ database: e.target.value })}
            placeholder="可选"
          />
          <datalist id={`auto-db-${draft.id}`}>
            {databases.map((db) => (
              <option key={db} value={db} />
            ))}
          </datalist>
        </label>
        <label className="auto-check">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          启用计划
        </label>
        <div className="auto-next">
          <span>下次运行</span>
          <strong>{nextRun ? formatDateTime(nextRun) : "—"}</strong>
          {nextRun && <em>{formatRelative(nextRun)}</em>}
        </div>
      </div>

      <nav className="auto-tabs" aria-label="作业设置">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "is-active" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "steps" ? ` (${draft.steps.length})` : ""}
            {t.id === "history" ? ` (${runs.length})` : ""}
          </button>
        ))}
      </nav>

      <div className="auto-tab-body">
        {tab === "steps" && (
          <div className="auto-steps">
            {draft.steps.map((step, i) => (
              <div className="auto-step" key={step.id}>
                <div className="auto-step-head">
                  <span className="auto-step-index">{i + 1}</span>
                  <input
                    className="auto-step-name"
                    value={step.name}
                    onChange={(e) =>
                      patchStep(step.id, { name: e.target.value })
                    }
                    placeholder="步骤名称"
                  />
                  <label className="auto-check">
                    <input
                      type="checkbox"
                      checked={step.continueOnError}
                      onChange={(e) =>
                        patchStep(step.id, {
                          continueOnError: e.target.checked,
                        })
                      }
                    />
                    失败继续
                  </label>
                  <div className="auto-step-tools">
                    <button
                      type="button"
                      title="上移"
                      disabled={i === 0}
                      onClick={() => moveStep(step.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="下移"
                      disabled={i === draft.steps.length - 1}
                      onClick={() => moveStep(step.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      title="删除步骤"
                      onClick={() => removeStep(step.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <textarea
                  className="auto-sql"
                  value={step.sql}
                  spellCheck={false}
                  placeholder="在此输入该步骤要执行的 SQL…"
                  onChange={(e) => patchStep(step.id, { sql: e.target.value })}
                />
              </div>
            ))}
            {draft.steps.length === 0 && (
              <p className="pane-placeholder">还没有步骤，点击下方按钮添加。</p>
            )}
            <button type="button" className="auto-add-step" onClick={addStep}>
              ＋ 添加步骤
            </button>
          </div>
        )}

        {tab === "schedule" && (
          <div className="auto-schedule">
            <label>
              <span>计划类型</span>
              <select
                value={draft.schedule.kind}
                onChange={(e) =>
                  patch({
                    schedule: {
                      ...draft.schedule,
                      kind: e.target.value as ScheduleKind,
                    },
                  })
                }
              >
                <option value="manual">手动</option>
                <option value="interval">间隔执行</option>
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
              </select>
            </label>

            {draft.schedule.kind === "interval" && (
              <label>
                <span>间隔（分钟）</span>
                <input
                  type="number"
                  min={1}
                  value={draft.schedule.intervalMinutes}
                  onChange={(e) =>
                    patch({
                      schedule: {
                        ...draft.schedule,
                        intervalMinutes: Math.max(1, Number(e.target.value) || 1),
                      },
                    })
                  }
                />
              </label>
            )}

            {(draft.schedule.kind === "daily" ||
              draft.schedule.kind === "weekly") && (
              <label>
                <span>时间</span>
                <input
                  type="time"
                  value={draft.schedule.time}
                  onChange={(e) =>
                    patch({
                      schedule: { ...draft.schedule, time: e.target.value },
                    })
                  }
                />
              </label>
            )}

            {draft.schedule.kind === "weekly" && (
              <label>
                <span>星期</span>
                <select
                  value={draft.schedule.weekday}
                  onChange={(e) =>
                    patch({
                      schedule: {
                        ...draft.schedule,
                        weekday: Number(e.target.value),
                      },
                    })
                  }
                >
                  {WEEKDAY_LABELS.map((label, idx) => (
                    <option key={label} value={idx}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <p className="auto-hint">
              当前计划：<strong>{describeSchedule(draft.schedule)}</strong>
              {nextRun ? ` · 下次 ${formatDateTime(nextRun)}` : ""}
              <br />
              应用运行期间由内置调度器触发；关闭应用后不会执行。
            </p>
          </div>
        )}

        {tab === "history" && (
          <div className="auto-history">
            {(running || liveLog.length > 0) && (
              <div className="auto-live">
                <div className="auto-live-head">
                  <span>{running ? "正在运行…" : "本次运行日志"}</span>
                </div>
                <pre className="auto-log" ref={logRef}>
                  {liveLog
                    .map((e) => `[${new Date(e.at).toLocaleTimeString()}] ${e.text}`)
                    .join("\n")}
                </pre>
              </div>
            )}
            {runs.length === 0 && !running && (
              <p className="pane-placeholder">暂无运行记录。</p>
            )}
            {runs.map((run) => {
              const open = openRunId === run.id;
              return (
                <div key={run.id} className="auto-run">
                  <button
                    type="button"
                    className="auto-run-head"
                    onClick={() => setOpenRunId(open ? null : run.id)}
                  >
                    <span className={`auto-run-dot is-${run.status}`} />
                    <span className="auto-run-time">
                      {formatDateTime(run.startedAt)}
                    </span>
                    <span className={`auto-run-status is-${run.status}`}>
                      {run.status === "success" ? "成功" : "失败"}
                    </span>
                    <span className="auto-run-duration">{run.durationMs} ms</span>
                    <span className="auto-run-twist">{open ? "▾" : "▸"}</span>
                  </button>
                  {open && (
                    <pre className="auto-log">
                      {run.entries
                        .map(
                          (e) =>
                            `[${new Date(e.at).toLocaleTimeString()}] ${e.text}`,
                        )
                        .join("\n")}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
