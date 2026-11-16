import { useState } from "react";
import type { ConnectionDto } from "../connections/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  copyEvent,
  dropEvent,
  fetchEventDdl,
  renameEvent,
  setEventEnabled,
} from "./eventMenuActions";
import { identOk } from "./sqlIdent";
import { isSaveCancelled } from "../import-export/csv";
import { downloadTextFile } from "../import-export/csv";
import { emitTableDataChanged } from "../../lib/tableEvents";

export type EventMenuTarget = {
  x: number;
  y: number;
  conn: ConnectionDto;
  database: string;
  name: string;
};

type Props = {
  target: EventMenuTarget;
  onClose: () => void;
  onRefresh: () => void;
  onMessage: (msg: string) => void;
};

export function EventContextMenu({
  target,
  onClose,
  onRefresh,
  onMessage,
}: Props) {
  const { conn, database, name } = target;
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [nextName, setNextName] = useState(`${name}_copy`);

  const openEventDesigner = useWorkspaceStore((s) => s.openEventDesigner);
  const openConn = useWorkspaceStore((s) => s.openConnection);
  const selectObjectFolder = useWorkspaceStore((s) => s.selectObjectFolder);
  const selectTableMeta = useWorkspaceStore((s) => s.selectTableMeta);

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
    selectObjectFolder(database, "events");
    selectTableMeta(name);
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
          onClick={() => {
            ensureContext();
            openEventDesigner({
              connection: conn,
              database,
              event: name,
              mode: "alter",
            });
            onClose();
          }}
        >
          设计事件
          <span className="menu-shortcut">⌘D</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            ensureContext();
            openEventDesigner({
              connection: conn,
              database,
              event: "Untitled",
              mode: "create",
            });
            onClose();
          }}
        >
          新建事件
          <span className="menu-shortcut">⌘N</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setDeleteOpen(true)}
        >
          删除事件
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setNextName(`${name}_copy`);
            setCopyOpen(true);
          }}
        >
          复制事件
        </button>

        <div className="dg-menu-sep" />

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await setEventEnabled({
                conn,
                database,
                name,
                enable: true,
              });
              onMessage(`已启用事件 ${name}`);
              onRefresh();
            })
          }
        >
          启用
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await setEventEnabled({
                conn,
                database,
                name,
                enable: false,
              });
              onMessage(`已禁用事件 ${name}`);
              onRefresh();
            })
          }
        >
          禁用
        </button>

        <div className="dg-menu-sep" />

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const ddl = await fetchEventDdl({ conn, database, name });
              await navigator.clipboard.writeText(ddl);
              onMessage("已复制 DDL 到剪贴板");
            })
          }
        >
          复制 DDL
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const ddl = await fetchEventDdl({ conn, database, name });
              await downloadTextFile(`${name}.sql`, ddl, "application/sql");
              onMessage("已导出共享包");
            })
          }
        >
          共享…
        </button>

        <div className="dg-menu-sep" />

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setNextName(name);
            setRenameOpen(true);
          }}
        >
          重命名
        </button>
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
          <div className="modal danger-confirm-modal">
            <h2>删除事件</h2>
            <p className="danger-confirm-text">
              确定删除事件{" "}
              <strong>
                {database}.{name}
              </strong>{" "}
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
                    await dropEvent({ conn, database, name });
                    emitTableDataChanged({
                      connectionId: conn.id,
                      database,
                      table: name,
                    });
                    selectTableMeta(null);
                    onMessage(`已删除事件 ${name}`);
                    onRefresh();
                    setDeleteOpen(false);
                  })
                }
              >
                {busy ? "删除中…" : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const next = nextName.trim();
                if (!identOk(next)) throw new Error("目标名称非法");
                await renameEvent({ conn, database, name, next });
                emitTableDataChanged({
                  connectionId: conn.id,
                  database,
                  table: next,
                });
                selectTableMeta(next);
                onMessage(`已重命名 → ${next}`);
                onRefresh();
                setRenameOpen(false);
              });
            }}
          >
            <h2>重命名事件</h2>
            <label>
              新名称
              <input
                value={nextName}
                onChange={(e) => setNextName(e.target.value)}
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
              <button type="submit" disabled={busy || !nextName.trim()}>
                确定
              </button>
            </div>
          </form>
        </div>
      )}

      {copyOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const next = nextName.trim();
                if (!identOk(next)) throw new Error("目标名称非法");
                await copyEvent({
                  conn,
                  database,
                  name,
                  newName: next,
                });
                emitTableDataChanged({
                  connectionId: conn.id,
                  database,
                  table: next,
                });
                onMessage(`已复制事件 → ${next}`);
                onRefresh();
                setCopyOpen(false);
              });
            }}
          >
            <h2>复制事件</h2>
            <label>
              新名称
              <input
                value={nextName}
                onChange={(e) => setNextName(e.target.value)}
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  setCopyOpen(false);
                  onClose();
                }}
              >
                取消
              </button>
              <button type="submit" disabled={busy || !nextName.trim()}>
                确定
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
