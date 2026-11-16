import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ConnectionDto } from "../connections/types";
import { downloadTextFile, isSaveCancelled } from "../import-export/csv";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { loadTableGroups, saveTableGroups } from "./tableGroups";
import { executeSqlFile } from "../backup/backupDump";

export type BackupsFolderMenuTarget = {
  x: number;
  y: number;
  conn: ConnectionDto;
  database: string;
  selectedBackupId?: string | null;
};

type Props = {
  target: BackupsFolderMenuTarget;
  onClose: () => void;
  onRefresh: () => void;
  onMessage: (msg: string) => void;
  onNewBackup: () => void;
  onRestoreSelected?: () => void;
  onDeleteSelected?: () => void;
  onDuplicateSelected?: () => void;
  onExtractSelected?: () => void;
  onRenameSelected?: () => void;
};

export function BackupsFolderContextMenu({
  target,
  onClose,
  onRefresh,
  onMessage,
  onNewBackup,
  onRestoreSelected,
  onDeleteSelected,
  onDuplicateSelected,
  onExtractSelected,
  onRenameSelected,
}: Props) {
  const { conn, database, selectedBackupId } = target;
  const hasSelection = !!selectedBackupId;
  const [busy, setBusy] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groups, setGroups] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState("");
  const [restoreSql, setRestoreSql] = useState<string | null>(null);

  const openConn = useWorkspaceStore((s) => s.openConnection);
  const selectObjectFolder = useWorkspaceStore((s) => s.selectObjectFolder);

  useEffect(() => {
    void loadTableGroups(conn.id, database)
      .then((s) => setGroups(s.groups))
      .catch(() => setGroups([]));
  }, [conn.id, database]);

  async function run(action: () => Promise<void>) {
    try {
      setBusy(true);
      await action();
      onClose();
    } catch (err) {
      if (isSaveCancelled(err)) {
        onClose();
        return;
      }
      onMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function ensureContext() {
    openConn(conn);
    selectObjectFolder(database, "backups");
  }

  async function pickSqlFile(): Promise<string | null> {
    const path = await open({
      title: "选择 SQL 文件",
      multiple: false,
      filters: [{ name: "SQL", extensions: ["sql"] }],
    });
    if (!path || Array.isArray(path)) return null;
    return path;
  }

  return (
    <>
      {!restoreSql && (
        <div
          className="dg-context-menu conn-context-menu"
          style={{ left: target.x, top: target.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            disabled={busy || !hasSelection}
            title={hasSelection ? undefined : "请先选择一个备份"}
            onClick={() => {
              onRestoreSelected?.();
              onClose();
            }}
          >
            还原备份
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              ensureContext();
              onNewBackup();
              onClose();
            }}
          >
            新建备份
            <span className="menu-shortcut">⌘N</span>
          </button>
          <button
            type="button"
            disabled={busy || !hasSelection}
            onClick={() => {
              onDeleteSelected?.();
              onClose();
            }}
          >
            删除备份
          </button>
          <button
            type="button"
            disabled={busy || !hasSelection}
            onClick={() => {
              onDuplicateSelected?.();
              onClose();
            }}
          >
            复制备份
            <span className="menu-shortcut">⇧⌘D</span>
          </button>

          <div className="dg-menu-sep" />

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void (async () => {
                try {
                  setBusy(true);
                  ensureContext();
                  const path = await pickSqlFile();
                  if (!path) {
                    onClose();
                    return;
                  }
                  const sql = await readTextFile(path);
                  setRestoreSql(sql);
                } catch (err) {
                  if (!isSaveCancelled(err)) {
                    onMessage(
                      err instanceof Error ? err.message : String(err),
                    );
                  }
                  onClose();
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            还原备份从…
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const path = await pickSqlFile();
                if (!path) return;
                const sql = await readTextFile(path);
                const base =
                  path.split(/[/\\]/).pop()?.replace(/\.sql$/i, "") ||
                  "extracted";
                await downloadTextFile(`${base}.sql`, sql, "application/sql");
                onMessage("已提取 SQL");
              })
            }
          >
            提取 SQL 从…
          </button>
          <button
            type="button"
            disabled={busy || !hasSelection}
            onClick={() => {
              onExtractSelected?.();
              onClose();
            }}
          >
            提取 SQL…
          </button>

          <div className="dg-menu-sep" />

          <div
            className={`dg-menu-item has-sub ${groupOpen ? "is-open" : ""}`}
            onMouseEnter={() => setGroupOpen(true)}
            onMouseLeave={() => setGroupOpen(false)}
          >
            <button type="button" className="dg-menu-trigger" disabled={busy}>
              管理组
              <span className="dg-menu-arrow">›</span>
            </button>
            {groupOpen && (
              <div className="dg-submenu">
                {groups.length === 0 && (
                  <div className="pane-placeholder" style={{ padding: 8 }}>
                    暂无组
                  </div>
                )}
                {groups.map((g) => (
                  <button key={g} type="button" disabled>
                    {g}
                  </button>
                ))}
                <div className="dg-menu-sep" />
                <div className="dg-submenu-inline">
                  <input
                    value={newGroup}
                    placeholder="新组名"
                    onChange={(e) => setNewGroup(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    disabled={!newGroup.trim()}
                    onClick={() => {
                      const g = newGroup.trim();
                      setNewGroup("");
                      void run(async () => {
                        const s = await loadTableGroups(conn.id, database);
                        const nextGroups = Array.from(
                          new Set([...s.groups, g]),
                        ).sort((a, b) => a.localeCompare(b, "zh"));
                        await saveTableGroups(conn.id, database, {
                          groups: nextGroups,
                          membership: s.membership,
                        });
                        setGroups(nextGroups);
                        onMessage(`已创建组「${g}」`);
                        onRefresh();
                      });
                    }}
                  >
                    创建
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={busy || !hasSelection}
            onClick={() => {
              onRenameSelected?.();
              onClose();
            }}
          >
            重命名
          </button>

          <div className="dg-menu-sep" />

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                ensureContext();
                const marker = await downloadTextFile(
                  `mycat-backups-${database}.txt`,
                  `Mycat backups for ${conn.name} / ${database}\n使用「提取 SQL…」可将备份保存到磁盘。\n`,
                  "text/plain",
                );
                try {
                  await revealItemInDir(marker);
                } catch {
                  onMessage(`已保存标记文件：${marker}`);
                }
              })
            }
          >
            在 Finder 中显示
          </button>

          <div className="dg-menu-sep" />

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onRefresh();
              onClose();
            }}
          >
            刷新
            <span className="menu-shortcut">⌘R</span>
          </button>
        </div>
      )}

      {restoreSql != null && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setRestoreSql(null);
              onClose();
            }
          }}
        >
          <div
            className="modal danger-confirm-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2>还原备份</h2>
            <p className="danger-confirm-text">
              将在当前库 <strong>{database}</strong>{" "}
              执行所选 SQL 文件内容，可能覆盖或修改现有对象。是否继续？
            </p>
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRestoreSql(null);
                  onClose();
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={busy}
                autoFocus
                onClick={() =>
                  void run(async () => {
                    ensureContext();
                    const sql = restoreSql;
                    setRestoreSql(null);
                    const result = await executeSqlFile({
                      connectionId: conn.id,
                      database,
                      sql,
                    });
                    onMessage(
                      `还原完成：执行 ${result.done}/${result.total} 条语句`,
                    );
                    onRefresh();
                  })
                }
              >
                {busy ? "还原中…" : "还原"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
