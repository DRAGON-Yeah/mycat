import { useEffect, useState } from "react";
import type { ConnectionDto } from "../connections/types";
import { executeSql, openConnection } from "../connections/sessionApi";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { loadTableGroups, saveTableGroups } from "./tableGroups";
import { isSaveCancelled } from "../import-export/csv";
import { identOk } from "./sqlIdent";
import { rewriteCreateEventName } from "../event-designer/eventDdl";

export type EventsFolderMenuTarget = {
  x: number;
  y: number;
  conn: ConnectionDto;
  database: string;
};

type Props = {
  target: EventsFolderMenuTarget;
  onClose: () => void;
  onRefresh: () => void;
  onMessage: (msg: string) => void;
};

export function EventsFolderContextMenu({
  target,
  onClose,
  onRefresh,
  onMessage,
}: Props) {
  const { conn, database } = target;
  const [busy, setBusy] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groups, setGroups] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteSql, setPasteSql] = useState("");
  const [pasteName, setPasteName] = useState("Untitled");
  const [canPaste, setCanPaste] = useState(false);

  const openConn = useWorkspaceStore((s) => s.openConnection);
  const selectObjectFolder = useWorkspaceStore((s) => s.selectObjectFolder);
  const openEventDesigner = useWorkspaceStore((s) => s.openEventDesigner);

  useEffect(() => {
    void loadTableGroups(conn.id, database)
      .then((s) => setGroups(s.groups))
      .catch(() => setGroups([]));
    void navigator.clipboard
      .readText()
      .then((t) =>
        setCanPaste(/create\s+(?:definer\s*=\s*[^\s]+\s+)?event/i.test(t)),
      )
      .catch(() => setCanPaste(false));
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
    selectObjectFolder(database, "events");
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
        <button type="button" disabled title="请先选择一个事件">
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
        <button type="button" disabled>
          删除事件
        </button>
        <button type="button" disabled>
          复制事件
          <span className="menu-shortcut">⇧⌘D</span>
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

        <button type="button" disabled>
          复制
        </button>
        <button
          type="button"
          disabled={busy || !canPaste}
          title={canPaste ? undefined : "剪贴板中没有 CREATE EVENT"}
          onClick={() =>
            void (async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (!/create\s+(?:definer\s*=\s*[^\s]+\s+)?event/i.test(text)) {
                  onMessage("剪贴板中没有 CREATE EVENT 语句");
                  return;
                }
                setPasteSql(text);
                const m = text.match(
                  /create\s+(?:definer\s*=\s*[^\s]+\s+)?event\s+(?:`?[\w]+`?\.)?`?([\w]+)`?/i,
                );
                setPasteName(m?.[1] ? `${m[1]}_copy` : "Untitled");
                setPasteOpen(true);
              } catch {
                setPasteSql("");
                setPasteName("Untitled");
                setPasteOpen(true);
              }
            })()
          }
        >
          粘贴
        </button>
        <button type="button" disabled>
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

      {pasteOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (!identOk(pasteName.trim())) {
                  throw new Error(
                    "名称仅允许字母、数字、下划线，且不能以数字开头",
                  );
                }
                const nm = pasteName.trim();
                const sql = rewriteCreateEventName(
                  pasteSql,
                  nm,
                  String(conn.engine),
                  database,
                );
                await openConnection(conn.id);
                await executeSql(conn.id, sql, database);
                onMessage(`已创建事件 ${nm}`);
                onRefresh();
                setPasteOpen(false);
              });
            }}
          >
            <h2>粘贴事件 DDL</h2>
            <label>
              目标名称
              <input
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
                autoFocus
              />
            </label>
            <textarea
              rows={8}
              value={pasteSql}
              onChange={(e) => setPasteSql(e.target.value)}
              placeholder="CREATE EVENT ..."
            />
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  setPasteOpen(false);
                  onClose();
                }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={busy || !pasteSql.trim() || !pasteName.trim()}
              >
                执行
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
