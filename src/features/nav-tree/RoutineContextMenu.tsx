import { useState } from "react";
import type { ConnectionDto } from "../connections/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { RoutineType } from "../object-list/routineMeta";
import {
  copyRoutine,
  dropRoutine,
  fetchRoutineDdl,
  renameRoutine,
} from "./routineMenuActions";
import { identOk } from "./sqlIdent";
import { isSaveCancelled } from "../import-export/csv";
import { downloadTextFile } from "../import-export/csv";
import { emitTableDataChanged } from "../../lib/tableEvents";
import { RunRoutineDialog } from "../function-designer/RunRoutineDialog";

export type RoutineMenuTarget = {
  x: number;
  y: number;
  conn: ConnectionDto;
  database: string;
  name: string;
  routineType: RoutineType;
};

type Props = {
  target: RoutineMenuTarget;
  onClose: () => void;
  onRefresh: () => void;
  onMessage: (msg: string) => void;
};

export function RoutineContextMenu({
  target,
  onClose,
  onRefresh,
  onMessage,
}: Props) {
  const { conn, database, name, routineType } = target;
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [nextName, setNextName] = useState(`${name}_copy`);

  const openFunctionDesigner = useWorkspaceStore((s) => s.openFunctionDesigner);
  const openConn = useWorkspaceStore((s) => s.openConnection);
  const selectObjectFolder = useWorkspaceStore((s) => s.selectObjectFolder);
  const selectTableMeta = useWorkspaceStore((s) => s.selectTableMeta);

  const label = routineType === "FUNCTION" ? "函数" : "过程";

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
    selectObjectFolder(database, "functions");
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
            setRunOpen(true);
          }}
        >
          运行{label}
          <span className="menu-shortcut">⌘O</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            ensureContext();
            openFunctionDesigner({
              connection: conn,
              database,
              routine: name,
              mode: "alter",
              routineType,
            });
            onClose();
          }}
        >
          设计{label}
          <span className="menu-shortcut">⌘D</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            ensureContext();
            openFunctionDesigner({
              connection: conn,
              database,
              routine: "new_proc",
              mode: "create",
              routineType: "PROCEDURE",
            });
            onClose();
          }}
        >
          新建函数
          <span className="menu-shortcut">⌘N</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setDeleteOpen(true)}
        >
          删除{label}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setNextName(`${name}_copy`);
            setCopyOpen(true);
          }}
        >
          复制{label}
          <span className="menu-shortcut">⇧⌘D</span>
        </button>
        <button type="button" disabled>
          设置权限
        </button>

        <div className="dg-menu-sep" />

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const ddl = await fetchRoutineDdl({
                conn,
                database,
                name,
                routineType,
              });
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
              const ddl = await fetchRoutineDdl({
                conn,
                database,
                name,
                routineType,
              });
              await downloadTextFile(
                `${name}.sql`,
                ddl,
                "application/sql",
              );
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
            <h2>删除{label}</h2>
            <p className="danger-confirm-text">
              确定删除{label}{" "}
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
                    await dropRoutine({
                      conn,
                      database,
                      name,
                      routineType,
                    });
                    emitTableDataChanged({
                      connectionId: conn.id,
                      database,
                      table: name,
                    });
                    selectTableMeta(null);
                    onMessage(`已删除${label} ${name}`);
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
                await renameRoutine({
                  conn,
                  database,
                  name,
                  next,
                  routineType,
                });
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
            <h2>重命名{label}</h2>
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
                await copyRoutine({
                  conn,
                  database,
                  name,
                  newName: next,
                  routineType,
                });
                emitTableDataChanged({
                  connectionId: conn.id,
                  database,
                  table: next,
                });
                onMessage(`已复制${label} → ${next}`);
                onRefresh();
                setCopyOpen(false);
              });
            }}
          >
            <h2>复制{label}</h2>
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

      {runOpen && (
        <RunRoutineDialog
          conn={conn}
          database={database}
          name={name}
          routineType={routineType}
          onClose={() => {
            setRunOpen(false);
            onClose();
          }}
          onMessage={onMessage}
        />
      )}
    </>
  );
}
