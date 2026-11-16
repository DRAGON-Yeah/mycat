import { useEffect, useState } from "react";
import type { ConnectionDto } from "../connections/types";
import { executeSql, openConnection } from "../connections/sessionApi";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  loadTableGroups,
  saveTableGroups,
} from "./tableGroups";
import { exportAllViewsDictionary } from "./tableMenuActions";
import { isSaveCancelled } from "../import-export/csv";
import { identOk } from "./sqlIdent";

export type ViewsFolderMenuTarget = {
  x: number;
  y: number;
  conn: ConnectionDto;
  database: string;
};

type Props = {
  target: ViewsFolderMenuTarget;
  onClose: () => void;
  onRefresh: () => void;
  onMessage: (msg: string) => void;
};

export function ViewsFolderContextMenu({
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
  const [pasteName, setPasteName] = useState("new_view");

  const openConn = useWorkspaceStore((s) => s.openConnection);
  const selectObjectFolder = useWorkspaceStore((s) => s.selectObjectFolder);
  const openViewDesigner = useWorkspaceStore((s) => s.openViewDesigner);

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
    selectObjectFolder(database, "views");
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
        <button type="button" disabled title="请先选择一个视图">
          打开视图
          <span className="menu-shortcut">⌘O</span>
        </button>
        <button type="button" disabled title="请先选择一个视图">
          设计视图
          <span className="menu-shortcut">⌘D</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            ensureContext();
            openViewDesigner({
              connection: conn,
              database,
              view: "new_view",
              mode: "create",
            });
            onClose();
          }}
        >
          新建视图
          <span className="menu-shortcut">⌘N</span>
        </button>
        <button type="button" disabled>
          删除视图
        </button>
        <button type="button" disabled>
          复制视图
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
              ensureContext();
              const n = await exportAllViewsDictionary({ conn, database });
              onMessage(`已导出 ${n} 个视图的数据字典`);
            })
          }
        >
          数据字典…
        </button>

        <div className="dg-menu-sep" />

        <button type="button" disabled title="请先选择一个视图">
          逆向视图到模型…
        </button>
        <button type="button" disabled title="请先选择一个视图">
          生成简易图表…
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
          disabled={busy}
          onClick={() =>
            void (async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (!/create\s+view/i.test(text)) {
                  onMessage("剪贴板中没有 CREATE VIEW 语句");
                  return;
                }
                setPasteSql(text);
                const m = text.match(
                  /create\s+(?:or\s+replace\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:`?[\w]+`?\.)?`?([\w]+)`?/i,
                );
                setPasteName(m?.[1] ? `${m[1]}_copy` : "new_view");
                setPasteOpen(true);
              } catch {
                setPasteSql("");
                setPasteName("new_view");
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
                    "视图名仅允许字母、数字、下划线，且不能以数字开头",
                  );
                }
                const name = pasteName.trim();
                const { rewriteCreateViewName } = await import(
                  "../view-designer/viewDdl"
                );
                const sql = rewriteCreateViewName(
                  pasteSql,
                  name,
                  String(conn.engine),
                  database,
                );
                await openConnection(conn.id);
                await executeSql(conn.id, sql, database);
                onMessage(`已创建视图 ${name}`);
                onRefresh();
                setPasteOpen(false);
              });
            }}
          >
            <h2>粘贴视图 DDL</h2>
            <label>
              目标视图名
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
              placeholder="CREATE VIEW ..."
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
