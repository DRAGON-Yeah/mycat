import { useCallback, useEffect, useMemo, useState } from "react";
import { listConnections } from "../connections/api";
import type { ConnectionDto } from "../connections/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { confirmDialog } from "../../lib/confirm";
import { formatDateTime, formatRelative } from "../../lib/localDocs";
import {
  AUTOMATION_CHANGED,
  deleteJob,
  duplicateJob,
  listJobs,
  saveJob,
} from "./automationApi";
import { runJobById } from "./automationRunner";
import { JobEditor } from "./JobEditor";
import {
  describeSchedule,
  newJob,
  statusLabel,
  type AutomationJob,
} from "./types";

export function AutomationPane() {
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);
  const selectedDatabase = useWorkspaceStore((s) => s.selectedDatabase);
  const [jobs, setJobs] = useState<AutomationJob[]>(() => listJobs());
  const [connections, setConnections] = useState<ConnectionDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const items = listJobs();
    return items[items.length - 1]?.id ?? null;
  });
  const [filter, setFilter] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const reload = useCallback(() => {
    const items = listJobs();
    setJobs(items);
    setSelectedId((prev) =>
      prev && items.some((j) => j.id === prev)
        ? prev
        : (items[items.length - 1]?.id ?? null),
    );
  }, []);

  useEffect(() => {
    reload();
    function onChanged() {
      reload();
    }
    window.addEventListener(AUTOMATION_CHANGED, onChanged);
    return () => window.removeEventListener(AUTOMATION_CHANGED, onChanged);
  }, [reload]);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listConnections();
        setConnections(list);
      } catch {
        setConnections([]);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) =>
        j.name.toLowerCase().includes(q) ||
        j.connectionName.toLowerCase().includes(q) ||
        j.database.toLowerCase().includes(q),
    );
  }, [jobs, filter]);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  function createJob() {
    const conn = activeConnection ?? connections[0];
    if (!conn) {
      showToast("请先在左侧新建并打开一个连接");
      return;
    }
    const job = saveJob(
      newJob({
        name: `作业 ${jobs.length + 1}`,
        connectionId: conn.id,
        connectionName: conn.name,
        database: (activeConnection ? selectedDatabase : null) || conn.database?.trim() || "",
      }),
    );
    reload();
    setSelectedId(job.id);
    showToast(`已创建「${job.name}」`);
  }

  async function removeSelected() {
    if (!selected) return;
    const ok = await confirmDialog({
      title: "删除作业",
      message: `确定删除作业「${selected.name}」及其运行历史？`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    deleteJob(selected.id);
    reload();
    showToast("已删除作业");
  }

  function copySelected() {
    if (!selected) return;
    const copy = duplicateJob(selected.id);
    reload();
    if (copy) {
      setSelectedId(copy.id);
      showToast(`已复制为「${copy.name}」`);
    }
  }

  async function runSelected() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const run = await runJobById(selected.id);
      showToast(
        run?.status === "success"
          ? `「${selected.name}」执行成功`
          : `「${selected.name}」执行失败`,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      reload();
    }
  }

  return (
    <div className="feature-pane automation-pane">
      <div className="object-list-toolbar navicat-obj-toolbar">
        <div className="obj-toolbar-left">
          <button
            type="button"
            className="obj-tool-btn"
            title="刷新"
            onClick={() => reload()}
          >
            ↻
          </button>
          <button type="button" className="obj-tool-btn" onClick={createJob}>
            新建作业
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            disabled={!selected || busy}
            onClick={() => void runSelected()}
          >
            {busy ? "运行中…" : "运行"}
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            disabled={!selected}
            onClick={copySelected}
          >
            复制
          </button>
          <button
            type="button"
            className="obj-tool-btn is-danger-text"
            disabled={!selected || busy}
            onClick={() => void removeSelected()}
          >
            删除
          </button>
          <span className="obj-tool-sep" />
          <span className="object-list-title">
            自动化作业
            <span className="object-list-count">{filtered.length}</span>
          </span>
        </div>
        <input
          className="object-list-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索作业"
        />
      </div>

      {toast && <p className="obj-toast">{toast}</p>}

      <div className="automation-body">
        <ul className="automation-list">
          {filtered.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                className={`auto-item ${job.id === selectedId ? "is-active" : ""}`}
                onClick={() => setSelectedId(job.id)}
              >
                <span className={`auto-item-dot is-${job.lastStatus}`} />
                <span className="auto-item-main">
                  <span className="auto-item-name">{job.name}</span>
                  <span className="auto-item-sub">
                    {describeSchedule(job.schedule)} · {job.connectionName || "未设置连接"}
                  </span>
                  <span className="auto-item-sub">
                    {job.lastRunAt
                      ? `上次 ${formatRelative(job.lastRunAt)} · ${statusLabel(job.lastStatus)}`
                      : "尚未运行"}
                    {job.enabled && job.nextRunAt
                      ? ` · 下次 ${formatDateTime(job.nextRunAt)}`
                      : ""}
                  </span>
                </span>
                {job.enabled && <span className="auto-item-flag">计划</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="pane-placeholder">
              {jobs.length === 0
                ? "还没有作业，点击「新建作业」开始。"
                : "无匹配作业"}
            </li>
          )}
        </ul>

        <div className="automation-detail">
          {selected ? (
            <JobEditor
              key={selected.id}
              job={selected}
              connections={connections}
              onSaved={() => reload()}
              onDeleted={() => reload()}
              onMessage={showToast}
            />
          ) : (
            <div className="feature-empty">
              <h2>自动化</h2>
              <p>
                用作业把多条 SQL 组织成可重复执行的流程，并按间隔、每天或每周自动运行。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
