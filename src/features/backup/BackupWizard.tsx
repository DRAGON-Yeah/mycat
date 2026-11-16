import { useEffect, useMemo, useState } from "react";
import type { ConnectionDto } from "../connections/types";
import {
  listBackupObjectGroups,
  type BackupObjectGroup,
} from "./backupObjects";
import {
  nodesFromKeys,
  runBackupDump,
  type BackupProgress,
} from "./backupDump";
import {
  defaultBackupProfile,
  loadBackupProfile,
  saveBackupProfile,
  type BackupAdvancedOptions,
} from "./backupProfile";

type TabId = "general" | "objects" | "advanced" | "log";

type Props = {
  conn: ConnectionDto;
  database: string;
  onClose: () => void;
  onCompleted: () => void;
  onMessage: (msg: string) => void;
};

const TABS: { id: TabId; label: string }[] = [
  { id: "general", label: "常规" },
  { id: "objects", label: "对象选择" },
  { id: "advanced", label: "高级" },
  { id: "log", label: "消息日志" },
];

export function BackupWizard({
  conn,
  database,
  onClose,
  onCompleted,
  onMessage,
}: Props) {
  const [tab, setTab] = useState<TabId>("general");
  const [comment, setComment] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState<BackupAdvancedOptions>(
    defaultBackupProfile().advanced,
  );
  const [groups, setGroups] = useState<BackupObjectGroup[]>([]);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    table: true,
    view: true,
    function: true,
    event: true,
  });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BackupProgress>({
    objectsTotal: 0,
    objectsDone: 0,
    recordsDone: 0,
    elapsedMs: 0,
    percent: 0,
    lines: [],
  });
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const title = `新建备份 @${database} (${conn.host || "localhost"}) - 备份`;

  useEffect(() => {
    const p = loadBackupProfile(conn.id, database);
    setComment(p.comment);
    setSelectedKeys(p.selectedKeys);
    setAdvanced(p.advanced);
  }, [conn.id, database]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingObjects(true);
      try {
        const g = await listBackupObjectGroups({
          connectionId: conn.id,
          engine: String(conn.engine),
          database,
        });
        if (!cancelled) {
          setGroups(g);
          // default select all if profile empty
          setSelectedKeys((prev) => {
            if (prev.length > 0) return prev;
            return g.flatMap((x) => x.items.map((i) => i.key));
          });
        }
      } catch (err) {
        if (!cancelled) {
          onMessage(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoadingObjects(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // intentionally omit onMessage — parent often passes inline fn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, conn.engine, database]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => i.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, search]);

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  function toggleKey(key: string) {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function toggleGroup(group: BackupObjectGroup) {
    const keys = group.items.map((i) => i.key);
    const allOn = keys.every((k) => selectedSet.has(k));
    setSelectedKeys((prev) => {
      if (allOn) return prev.filter((k) => !keys.includes(k));
      const set = new Set(prev);
      keys.forEach((k) => set.add(k));
      return Array.from(set);
    });
  }

  function selectAll(on: boolean) {
    if (!on) {
      setSelectedKeys([]);
      return;
    }
    setSelectedKeys(groups.flatMap((g) => g.items.map((i) => i.key)));
  }

  function persistProfile() {
    saveBackupProfile(conn.id, database, {
      comment,
      selectedKeys,
      advanced,
    });
    onMessage("已保存配置文件");
    setProfileMenuOpen(false);
  }

  async function startBackup() {
    const selected = nodesFromKeys(selectedKeys);
    setTab("log");
    setRunning(true);
    setProgress({
      objectsTotal: selected.length,
      objectsDone: 0,
      recordsDone: 0,
      elapsedMs: 0,
      percent: 0,
      lines: [],
    });
    try {
      await runBackupDump({
        conn,
        database,
        comment,
        selected,
        advanced,
        onProgress: setProgress,
      });
      onMessage("备份完成");
      onCompleted();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const elapsedLabel =
    progress.elapsedMs > 0
      ? `${(progress.elapsedMs / 1000).toFixed(2)}s`
      : "0";

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <div
        className="bak-wizard"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="bak-wizard-header">
          <h2>{title}</h2>
          <nav className="bak-wizard-tabs" aria-label="备份步骤">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? "is-active" : undefined}
                disabled={running && t.id !== "log"}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        <div className="bak-wizard-body">
          {tab === "general" && (
            <div className="bak-wizard-pane bak-wizard-general">
              <div className="bak-meta-row">
                <span>连接名称:</span>
                <strong>{conn.name}</strong>
              </div>
              <div className="bak-meta-row">
                <span>主机:</span>
                <strong>{conn.host || "localhost"}</strong>
              </div>
              <div className="bak-meta-row">
                <span>模式:</span>
                <strong>{database}</strong>
              </div>
              <label className="bak-comment-label">
                注释:
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={8}
                  disabled={running}
                />
              </label>
            </div>
          )}

          {tab === "objects" && (
            <div className="bak-wizard-pane bak-wizard-objects">
              <p className="bak-objects-title">数据库对象:</p>
              <div className="bak-objects-tree">
                {loadingObjects && (
                  <p className="pane-placeholder">加载对象…</p>
                )}
                {!loadingObjects &&
                  filteredGroups.map((g) => {
                    const keys = g.items.map((i) => i.key);
                    const allOn =
                      keys.length > 0 && keys.every((k) => selectedSet.has(k));
                    const someOn = keys.some((k) => selectedSet.has(k));
                    const open = expanded[g.kind] !== false;
                    return (
                      <div key={g.kind} className="bak-obj-group">
                        <div className="bak-obj-row bak-obj-parent">
                          <button
                            type="button"
                            className={`bak-twist ${open ? "is-open" : ""}`}
                            onClick={() =>
                              setExpanded((e) => ({
                                ...e,
                                [g.kind]: !open,
                              }))
                            }
                            aria-label={open ? "折叠" : "展开"}
                          >
                            ▸
                          </button>
                          <label>
                            <input
                              type="checkbox"
                              checked={allOn}
                              ref={(el) => {
                                if (el) el.indeterminate = !allOn && someOn;
                              }}
                              onChange={() => toggleGroup(g)}
                              disabled={running || keys.length === 0}
                            />
                            <span className={`bak-obj-icon is-${g.kind}`}>
                              {g.kind === "table"
                                ? "T"
                                : g.kind === "view"
                                  ? "V"
                                  : g.kind === "function"
                                    ? "fx"
                                    : "Ev"}
                            </span>
                            {g.label} ({g.items.length})
                          </label>
                        </div>
                        {open &&
                          g.items.map((item) => (
                            <label
                              key={item.key}
                              className="bak-obj-row bak-obj-child"
                            >
                              <input
                                type="checkbox"
                                checked={selectedSet.has(item.key)}
                                onChange={() => toggleKey(item.key)}
                                disabled={running}
                              />
                              <span className={`bak-obj-icon is-${item.kind}`}>
                                {item.kind === "table"
                                  ? "T"
                                  : item.kind === "view"
                                    ? "V"
                                    : item.kind === "function"
                                      ? "fx"
                                      : "Ev"}
                              </span>
                              {item.name}
                            </label>
                          ))}
                      </div>
                    );
                  })}
                {!loadingObjects && filteredGroups.length === 0 && (
                  <p className="pane-placeholder">无匹配对象</p>
                )}
              </div>
              <div className="bak-objects-tools">
                <input
                  className="bak-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索"
                  disabled={running}
                />
                <div className="bak-objects-actions">
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => selectAll(true)}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => selectAll(false)}
                  >
                    取消全选
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "advanced" && (
            <div className="bak-wizard-pane bak-wizard-advanced">
              <label className="bak-check">
                <input
                  type="checkbox"
                  checked={advanced.lockTables}
                  disabled={running}
                  onChange={(e) =>
                    setAdvanced((a) => ({
                      ...a,
                      lockTables: e.target.checked,
                    }))
                  }
                />
                锁定所有表
              </label>
              <label className="bak-check">
                <input
                  type="checkbox"
                  checked={advanced.singleTransaction}
                  disabled={running}
                  onChange={(e) =>
                    setAdvanced((a) => ({
                      ...a,
                      singleTransaction: e.target.checked,
                    }))
                  }
                />
                使用单一事务 (只限 InnoDB)
              </label>
              <label className="bak-check">
                <input
                  type="checkbox"
                  checked={advanced.useCustomFileName}
                  disabled={running}
                  onChange={(e) =>
                    setAdvanced((a) => ({
                      ...a,
                      useCustomFileName: e.target.checked,
                    }))
                  }
                />
                使用指定的文件名称
              </label>
              <input
                className="bak-filename"
                value={advanced.fileNameTemplate}
                disabled={running || !advanced.useCustomFileName}
                onChange={(e) =>
                  setAdvanced((a) => ({
                    ...a,
                    fileNameTemplate: e.target.value,
                  }))
                }
              />
              <p className="bak-format-hint">
                格式: %Y 年, %m 月, %d 日
                <br />
                %H 时, %M 分, %S 秒
              </p>
            </div>
          )}

          {tab === "log" && (
            <div className="bak-wizard-pane bak-wizard-log">
              <div className="bak-log-stats">
                <div>
                  对象: <strong>{progress.objectsTotal}</strong>
                </div>
                <div>
                  已处理对象: <strong>{progress.objectsDone}</strong>
                </div>
                <div>
                  已处理记录: <strong>{progress.recordsDone}</strong>
                </div>
                <div>
                  时间: <strong>{elapsedLabel}</strong>
                </div>
              </div>
              <pre className="bak-log-console">
                {progress.lines.length === 0
                  ? ""
                  : progress.lines.join("\n")}
              </pre>
              <div className="bak-progress">
                <div
                  className="bak-progress-bar"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <footer className="bak-wizard-footer">
          <div className="bak-wizard-footer-left">
            <div className={`bak-split-btn ${profileMenuOpen ? "is-open" : ""}`}>
              <button
                type="button"
                disabled={running}
                onClick={() => persistProfile()}
              >
                保存配置文件
              </button>
              <button
                type="button"
                className="bak-split-arrow"
                disabled={running}
                aria-label="配置文件选项"
                onClick={() => setProfileMenuOpen((v) => !v)}
              >
                ▾
              </button>
              {profileMenuOpen && (
                <div className="bak-split-menu">
                  <button type="button" onClick={() => persistProfile()}>
                    保存配置文件
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const p = loadBackupProfile(conn.id, database);
                      setComment(p.comment);
                      setSelectedKeys(p.selectedKeys);
                      setAdvanced(p.advanced);
                      onMessage("已加载配置文件");
                      setProfileMenuOpen(false);
                    }}
                  >
                    加载配置文件
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="bak-wizard-footer-right">
            <button type="button" disabled={running} onClick={onClose}>
              关闭
            </button>
            <button
              type="button"
              className="is-primary"
              disabled={running}
              onClick={() => void startBackup()}
            >
              {running ? "备份中…" : progress.percent === 100 ? "开始" : "备份"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
