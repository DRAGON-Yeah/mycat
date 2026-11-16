import { useRef, useState } from "react";
import type { ConnectionDto } from "../connections/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { identOk } from "./sqlIdent";
import {
  copyTable,
  dropTableOrView,
  dumpSingleTable,
  emptyTable,
  exportTableCsv,
  exportTableDictionary,
  importTableCsv,
  maintainOpsForEngine,
  maintainTable,
  renameTable,
  reverseSingleTableModel,
  truncateTable,
  type MaintainOp,
} from "./tableMenuActions";

export type TableMenuTarget = {
  x: number;
  y: number;
  conn: ConnectionDto;
  database: string;
  table: string;
  kind?: string;
};

type Props = {
  target: TableMenuTarget;
  onClose: () => void;
  onRefresh: () => void;
  onMessage: (msg: string) => void;
};

const LATER = "稍后";

export function TableContextMenu({
  target,
  onClose,
  onRefresh,
  onMessage,
}: Props) {
  const { conn, database, table, kind } = target;
  const [busy, setBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(table);
  const [copyOpen, setCopyOpen] = useState(false);
  const [dumpOpen, setDumpOpen] = useState(false);
  const [maintainOpen, setMaintainOpen] = useState(false);
  const [copyDialog, setCopyDialog] = useState<"structure" | "data" | null>(
    null,
  );
  const [copyName, setCopyName] = useState(`${table}_copy`);
  const importRef = useRef<HTMLInputElement>(null);

  const openTable = useWorkspaceStore((s) => s.openTable);
  const openConn = useWorkspaceStore((s) => s.openConnection);
  const selectDatabase = useWorkspaceStore((s) => s.selectDatabase);
  const selectTableMeta = useWorkspaceStore((s) => s.selectTableMeta);
  const openTableDesigner = useWorkspaceStore((s) => s.openTableDesigner);
  const setToolbarAction = useWorkspaceStore((s) => s.setToolbarAction);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const closeTab = useWorkspaceStore((s) => s.closeTab);

  const isView = kind === "view";
  const maintainOps = maintainOpsForEngine(String(conn.engine));

  async function run(action: () => Promise<void>) {
    try {
      setBusy(true);
      await action();
      onClose();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function closeRelatedTabs(tableName: string) {
    const related = tabs.filter(
      (t) =>
        t.connectionId === conn.id &&
        t.database === database &&
        t.table === tableName,
    );
    for (const t of related) {
      closeTab(t.id, { force: true });
    }
  }

  function ensureContext() {
    openConn(conn);
    selectDatabase(database);
    selectTableMeta(table);
  }

  const laterBtn = (label: string) => (
    <button type="button" disabled title={`${label}（本版本未实现）`}>
      {label}
      <span className="menu-shortcut">{LATER}</span>
    </button>
  );

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
            openTable(table);
            onClose();
          }}
        >
          打开{isView ? "视图" : "表"}
          <span className="menu-shortcut">⌘O</span>
        </button>
        {laterBtn("通过配置文件打开表")}
        <button
          type="button"
          disabled={busy || isView}
          onClick={() => {
            ensureContext();
            openTableDesigner({
              connection: conn,
              database,
              table,
              mode: "alter",
            });
            onClose();
          }}
        >
          设计{isView ? "视图" : "表"}
          <span className="menu-shortcut">⌘D</span>
        </button>
        <button
          type="button"
          disabled={busy || isView}
          onClick={() => {
            ensureContext();
            openTableDesigner({
              connection: conn,
              database,
              table: "new_table",
              mode: "create",
            });
            onClose();
          }}
        >
          新建表
          <span className="menu-shortcut">⌘N</span>
        </button>
        {laterBtn("通过 AI 新建表")}

        <div className="dg-menu-sep" />

        <button
          type="button"
          className="is-danger"
          disabled={busy}
          onClick={() => {
            const label = isView ? "视图" : "表";
            if (
              !window.confirm(`删除${label}「${table}」？此操作不可恢复。`)
            ) {
              return;
            }
            void run(async () => {
              await dropTableOrView({ conn, database, table, isView });
              closeRelatedTabs(table);
              onMessage(`已删除${label} ${table}`);
              onRefresh();
            });
          }}
        >
          删除{isView ? "视图" : "表"}
        </button>
        {!isView && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    `清空表「${table}」的所有数据？\n（DELETE FROM）`,
                  )
                ) {
                  return;
                }
                void run(async () => {
                  await emptyTable({ conn, database, table });
                  onMessage(`已清空表 ${table}`);
                  onRefresh();
                });
              }}
            >
              清空表
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    `截断表「${table}」？\n将清空数据并尽量重置自增。`,
                  )
                ) {
                  return;
                }
                void run(async () => {
                  await truncateTable({ conn, database, table });
                  onMessage(`已截断表 ${table}`);
                  onRefresh();
                });
              }}
            >
              截断表
            </button>
            <div
              className={`dg-menu-item has-sub ${copyOpen ? "is-open" : ""}`}
              onMouseEnter={() => setCopyOpen(true)}
              onMouseLeave={() => setCopyOpen(false)}
            >
              <button type="button" className="dg-menu-trigger" disabled={busy}>
                复制表
                <span className="dg-menu-arrow">›</span>
              </button>
              {copyOpen && (
                <div className="dg-submenu">
                  <button
                    type="button"
                    onClick={() => {
                      setCopyName(`${table}_copy`);
                      setCopyDialog("structure");
                    }}
                  >
                    仅结构…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCopyName(`${table}_copy`);
                      setCopyDialog("data");
                    }}
                  >
                    结构与数据…
                  </button>
                </div>
              )}
            </div>
          </>
        )}
        {laterBtn("设置权限")}

        <div className="dg-menu-sep" />

        {!isView && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => importRef.current?.click()}
            >
              导入向导…
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const n = await exportTableCsv({
                    connectionId: conn.id,
                    table,
                    database,
                  });
                  onMessage(`已导出 ${n} 行 CSV`);
                })
              }
            >
              导出向导…
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await exportTableDictionary({ conn, database, table });
              onMessage("已导出数据字典");
            })
          }
        >
          数据字典…
        </button>
        {laterBtn("数据生成…")}
        {laterBtn("数据脱敏…")}

        <div className="dg-menu-sep" />

        {!isView && (
          <div
            className={`dg-menu-item has-sub ${dumpOpen ? "is-open" : ""}`}
            onMouseEnter={() => setDumpOpen(true)}
            onMouseLeave={() => setDumpOpen(false)}
          >
            <button type="button" className="dg-menu-trigger" disabled={busy}>
              转储 SQL 文件
              <span className="dg-menu-arrow">›</span>
            </button>
            {dumpOpen && (
              <div className="dg-submenu">
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      await dumpSingleTable({
                        conn,
                        database,
                        table,
                        includeData: true,
                      });
                      onMessage("已转储结构+数据");
                    })
                  }
                >
                  结构与数据…
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      await dumpSingleTable({
                        conn,
                        database,
                        table,
                        includeData: false,
                      });
                      onMessage("已转储仅结构");
                    })
                  }
                >
                  仅结构…
                </button>
              </div>
            )}
          </div>
        )}

        {!isView && (
          <div
            className={`dg-menu-item has-sub ${maintainOpen ? "is-open" : ""}`}
            onMouseEnter={() => setMaintainOpen(true)}
            onMouseLeave={() => setMaintainOpen(false)}
          >
            <button
              type="button"
              className="dg-menu-trigger"
              disabled={busy || maintainOps.length === 0}
            >
              维护
              <span className="dg-menu-arrow">›</span>
            </button>
            {maintainOpen && (
              <div className="dg-submenu">
                {(
                  [
                    ["analyze", "分析表"],
                    ["optimize", "优化表"],
                    ["check", "检查表"],
                    ["repair", "修复表"],
                  ] as [MaintainOp, string][]
                ).map(([op, label]) => (
                  <button
                    key={op}
                    type="button"
                    disabled={!maintainOps.includes(op)}
                    onClick={() => {
                      if (
                        (op === "repair" || op === "optimize") &&
                        !window.confirm(
                          `${label}「${table}」可能锁表，是否继续？`,
                        )
                      ) {
                        return;
                      }
                      void run(async () => {
                        await maintainTable({ conn, database, table, op });
                        onMessage(`已完成：${label}`);
                      });
                    }}
                  >
                    {label}
                    {!maintainOps.includes(op) && (
                      <span className="menu-shortcut">N/A</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await reverseSingleTableModel({ conn, database, table });
              setToolbarAction("model", "model");
              onMessage("已生成逆向模型");
            })
          }
        >
          逆向表到模型…
        </button>
        {laterBtn("创建 BI 工作区…")}

        <div className="dg-menu-sep" />

        {laterBtn("管理组")}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              try {
                await navigator.clipboard.writeText(table);
              } catch {
                // ignore
              }
              onMessage(`已复制表名 ${table}`);
            })
          }
        >
          复制
        </button>
        <button type="button" disabled title="需要剪贴板中的表结构 DDL">
          粘贴
        </button>
        {laterBtn("共享…")}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRenameValue(table);
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

      <input
        ref={importRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void run(async () => {
            const r = await importTableCsv({
              connectionId: conn.id,
              table,
              database,
              file,
            });
            onMessage(`导入完成：成功 ${r.ok}，失败 ${r.failed}`);
          });
        }}
      />

      {renameOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setRenameOpen(false);
              onClose();
            }
          }}
        >
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              const next = renameValue.trim();
              if (!next || next === table) {
                setRenameOpen(false);
                onClose();
                return;
              }
              void run(async () => {
                await renameTable({ conn, database, table, next });
                closeRelatedTabs(table);
                onMessage(`已重命名为 ${next}`);
                onRefresh();
                setRenameOpen(false);
              });
            }}
          >
            <h2>重命名{isView ? "视图" : "表"}</h2>
            <label>
              新名称
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                disabled={busy}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRenameOpen(false);
                  onClose();
                }}
              >
                取消
              </button>
              <button type="submit" disabled={busy || !renameValue.trim()}>
                {busy ? "处理中…" : "确定"}
              </button>
            </div>
          </form>
        </div>
      )}

      {copyDialog && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setCopyDialog(null);
              onClose();
            }
          }}
        >
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              const next = copyName.trim();
              if (!identOk(next)) {
                onMessage("目标表名非法");
                return;
              }
              void run(async () => {
                await copyTable({
                  conn,
                  database,
                  table,
                  newName: next,
                  includeData: copyDialog === "data",
                });
                onMessage(
                  copyDialog === "data"
                    ? `已复制表 ${table} → ${next}（含数据）`
                    : `已复制表结构 ${table} → ${next}`,
                );
                onRefresh();
                setCopyDialog(null);
              });
            }}
          >
            <h2>
              复制表
              {copyDialog === "data" ? "（结构与数据）" : "（仅结构）"}
            </h2>
            <label>
              新表名
              <input
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
                autoFocus
                disabled={busy}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setCopyDialog(null);
                  onClose();
                }}
              >
                取消
              </button>
              <button type="submit" disabled={busy || !copyName.trim()}>
                {busy ? "处理中…" : "确定"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
