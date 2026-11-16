import { useState } from "react";
import type { ConnectionDto } from "../connections/types";
import { downloadTextFile, isSaveCancelled } from "../import-export/csv";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  deleteBackup,
  duplicateBackup,
  getBackupSql,
  renameBackup,
  type BackupMeta,
} from "../backup/backupMeta";
import { executeSqlFile } from "../backup/backupDump";

export type BackupItemMenuTarget = {
  x: number;
  y: number;
  conn: ConnectionDto;
  database: string;
  backup: BackupMeta;
};

type Props = {
  target: BackupItemMenuTarget;
  onClose: () => void;
  onRefresh: () => void;
  onMessage: (msg: string) => void;
  onNewBackup: () => void;
};

export function BackupItemContextMenu({
  target,
  onClose,
  onRefresh,
  onMessage,
  onNewBackup,
}: Props) {
  const { conn, database, backup } = target;
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(backup.displayName);

  const openConn = useWorkspaceStore((s) => s.openConnection);
  const selectObjectFolder = useWorkspaceStore((s) => s.selectObjectFolder);

  function ensureContext() {
    openConn(conn);
    selectObjectFolder(database, "backups");
  }

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

  return (
    <>
      <div
        className="dg-context-menu conn-context-menu"
        style={{ left: target.x, top: target.y }}
        role="menu"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() => setRestoreOpen(true)}
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
          disabled={busy}
          onClick={() => setDeleteOpen(true)}
        >
          删除备份
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await duplicateBackup({
                connectionId: conn.id,
                database,
                id: backup.id,
              });
              onMessage("已复制备份");
              onRefresh();
            })
          }
        >
          复制备份
          <span className="menu-shortcut">⇧⌘D</span>
        </button>

        <div className="dg-menu-sep" />

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const sql = await getBackupSql({
                connectionId: conn.id,
                database,
                id: backup.id,
              });
              await downloadTextFile(
                backup.fileName,
                sql,
                "application/sql",
              );
              onMessage("已提取 SQL");
            })
          }
        >
          提取 SQL…
        </button>

        <div className="dg-menu-sep" />

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRenameValue(backup.displayName);
            setRenameOpen(true);
          }}
        >
          重命名
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

      {deleteOpen && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal danger-confirm-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2>删除备份</h2>
            <p className="danger-confirm-text">
              确定删除备份 <strong>{backup.displayName}</strong>{" "}
              吗？此操作不可恢复。
            </p>
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDeleteOpen(false);
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
                    await deleteBackup({
                      connectionId: conn.id,
                      database,
                      id: backup.id,
                    });
                    onMessage(`已删除备份 ${backup.displayName}`);
                    onRefresh();
                  })
                }
              >
                {busy ? "删除中…" : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreOpen && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal danger-confirm-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2>还原备份</h2>
            <p className="danger-confirm-text">
              将在当前库 <strong>{database}</strong> 执行备份{" "}
              <strong>{backup.displayName}</strong>{" "}
              的 SQL，可能覆盖或修改现有对象。是否继续？
            </p>
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRestoreOpen(false);
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
                    const sql = await getBackupSql({
                      connectionId: conn.id,
                      database,
                      id: backup.id,
                    });
                    if (!sql.trim()) throw new Error("备份内容为空");
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

      {renameOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await renameBackup({
                  connectionId: conn.id,
                  database,
                  id: backup.id,
                  displayName: renameValue,
                });
                onMessage("已重命名");
                onRefresh();
              });
            }}
          >
            <h2>重命名备份</h2>
            <label>
              名称
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  setRenameOpen(false);
                  onClose();
                }}
              >
                取消
              </button>
              <button type="submit" disabled={busy || !renameValue.trim()}>
                确定
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
