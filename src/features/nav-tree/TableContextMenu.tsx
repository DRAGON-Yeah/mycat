import { useEffect, useState } from "react";
import type { ConnectionDto } from "../connections/types";
import { executeSql, openConnection } from "../connections/sessionApi";
import { downloadTextFile } from "../import-export/csv";
import { TableIoWizard } from "../import-export/TableIoWizard";
import { emitTableDataChanged } from "../../lib/tableEvents";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { identOk } from "./sqlIdent";
import {
  loadTableGroups,
  saveTableGroups,
} from "./tableGroups";
import {
  listTableProfiles,
  newTableProfileId,
  saveTableProfiles,
  type TableOpenProfile,
} from "./tableProfiles";
import {
  generateTableRows,
  grantTablePrivilege,
  listTableGrants,
  suggestColumnsFromPrompt,
} from "./tableDataTools";
import {
  copyTable,
  dropTableOrView,
  dumpSingleTable,
  emptyTable,
  exportTableDictionary,
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [profiles, setProfiles] = useState<TableOpenProfile[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [membership, setMembership] = useState<Record<string, string>>({});
  const [newGroup, setNewGroup] = useState("");
  const [copyDialog, setCopyDialog] = useState<"structure" | "data" | null>(
    null,
  );
  const [copyName, setCopyName] = useState(`${table}_copy`);
  const [genOpen, setGenOpen] = useState(false);
  const [genCount, setGenCount] = useState(10);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [permOpen, setPermOpen] = useState(false);
  const [grants, setGrants] = useState<string[]>([]);
  const [grantUser, setGrantUser] = useState("app@%");
  const [grantPriv, setGrantPriv] = useState("SELECT");
  const [ioWizard, setIoWizard] = useState<"import" | "export" | "mask" | null>(
    null,
  );
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteSql, setPasteSql] = useState("");

  const openTable = useWorkspaceStore((s) => s.openTable);
  const openConn = useWorkspaceStore((s) => s.openConnection);
  const selectDatabase = useWorkspaceStore((s) => s.selectDatabase);
  const selectTableMeta = useWorkspaceStore((s) => s.selectTableMeta);
  const openTableDesigner = useWorkspaceStore((s) => s.openTableDesigner);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const designerTabs = useWorkspaceStore((s) => s.designerTabs);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const closeDesignerTab = useWorkspaceStore((s) => s.closeDesignerTab);

  const isView = kind === "view";
  const maintainOps = maintainOpsForEngine(String(conn.engine));
  const isMysql = String(conn.engine).toLowerCase() === "mysql";

  useEffect(() => {
    void listTableProfiles(conn.id, database, table)
      .then(setProfiles)
      .catch(() => setProfiles([]));
    void loadTableGroups(conn.id, database)
      .then((s) => {
        setGroups(s.groups);
        setMembership(s.membership);
      })
      .catch(() => {
        setGroups([]);
        setMembership({});
      });
  }, [conn.id, database, table]);

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
    const designers = designerTabs.filter(
      (t) =>
        t.connectionId === conn.id &&
        t.database === database &&
        t.table === tableName,
    );
    for (const t of designers) {
      closeDesignerTab(t.id, { force: true });
    }
  }

  function ensureContext() {
    openConn(conn);
    selectDatabase(database);
    selectTableMeta(table);
  }

  async function saveCurrentAsProfile() {
    const active = tabs.find(
      (t) =>
        t.connectionId === conn.id &&
        t.database === database &&
        t.table === table,
    );
    const name = `配置 ${profiles.length + 1}`;
    const next: TableOpenProfile[] = [
      ...profiles,
      {
        id: newTableProfileId(),
        name,
        sortCol: active?.openOptions?.sortCol,
        sortDir: active?.openOptions?.sortDir,
        filterCol: active?.openOptions?.filterCol,
        filterValue: active?.openOptions?.filterValue,
        pageSize: active?.openOptions?.pageSize ?? 1000,
      },
    ];
    await saveTableProfiles(conn.id, database, table, next);
    setProfiles(next);
    onMessage(`已保存打开配置「${name}」`);
  }

  async function assignGroup(groupName: string | null) {
    const nextMembership = { ...membership };
    if (!groupName) delete nextMembership[table];
    else nextMembership[table] = groupName;
    const nextGroups = groupName
      ? Array.from(new Set([...groups, groupName])).sort((a, b) =>
          a.localeCompare(b, "zh"),
        )
      : groups;
    await saveTableGroups(conn.id, database, {
      groups: nextGroups,
      membership: nextMembership,
    });
    setGroups(nextGroups);
    setMembership(nextMembership);
    onMessage(groupName ? `已加入组「${groupName}」` : "已移出组");
    onRefresh();
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
            openTable(table);
            onClose();
          }}
        >
          打开{isView ? "视图" : "表"}
          <span className="menu-shortcut">⌘O</span>
        </button>

        <div
          className={`dg-menu-item has-sub ${profileOpen ? "is-open" : ""}`}
          onMouseEnter={() => setProfileOpen(true)}
          onMouseLeave={() => setProfileOpen(false)}
        >
          <button type="button" className="dg-menu-trigger" disabled={busy}>
            通过配置文件打开表
            <span className="dg-menu-arrow">›</span>
          </button>
          {profileOpen && (
            <div className="dg-submenu">
              <button
                type="button"
                onClick={() => {
                  ensureContext();
                  openTable(table);
                  onClose();
                }}
              >
                默认打开
              </button>
              {profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    ensureContext();
                    openTable(table, {
                      sortCol: p.sortCol,
                      sortDir: p.sortDir,
                      filterCol: p.filterCol,
                      filterValue: p.filterValue,
                      pageSize: p.pageSize,
                    });
                    onClose();
                  }}
                >
                  {p.name}
                </button>
              ))}
              <div className="dg-menu-sep" />
              <button
                type="button"
                onClick={() => void run(() => saveCurrentAsProfile())}
              >
                另存为配置…
              </button>
            </div>
          )}
        </div>

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
        <button
          type="button"
          disabled={busy || isView}
          onClick={() => {
            setAiPrompt(`用户表，含邮箱、姓名、状态`);
            setAiOpen(true);
          }}
        >
          通过 AI 新建表
        </button>

        <div className="dg-menu-sep" />

        <button
          type="button"
          className="is-danger"
          disabled={busy}
          onClick={() => {
            const label = isView ? "视图" : "表";
            if (!window.confirm(`删除${label}「${table}」？此操作不可恢复。`)) {
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
                if (!window.confirm(`清空表「${table}」的所有数据？`)) return;
                void run(async () => {
                  await emptyTable({ conn, database, table });
                  emitTableDataChanged({
                    connectionId: conn.id,
                    database,
                    table,
                  });
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
                if (!window.confirm(`截断表「${table}」？`)) return;
                void run(async () => {
                  await truncateTable({ conn, database, table });
                  emitTableDataChanged({
                    connectionId: conn.id,
                    database,
                    table,
                  });
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
        <button
          type="button"
          disabled={busy || !isMysql}
          title={isMysql ? undefined : "目前仅 MySQL"}
          onClick={() =>
            void (async () => {
              try {
                setBusy(true);
                const lines = await listTableGrants({
                  connectionId: conn.id,
                  engine: String(conn.engine),
                  database,
                  table,
                });
                setGrants(lines);
                setPermOpen(true);
              } catch (err) {
                onMessage(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          设置权限
        </button>

        <div className="dg-menu-sep" />

        {!isView && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setIoWizard("import")}
            >
              导入向导…
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setIoWizard("export")}
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
        {!isView && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setGenCount(10);
              setGenOpen(true);
            }}
          >
            数据生成…
          </button>
        )}
        {!isView && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setIoWizard("mask")}
          >
            数据脱敏…
          </button>
        )}

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
                        !window.confirm(`${label}「${table}」可能锁表，继续？`)
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
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          title="导出 Mermaid 模型文档（本地文件）"
          onClick={() =>
            void run(async () => {
              await reverseSingleTableModel({ conn, database, table });
              onMessage("已导出逆向模型（Mermaid .md）");
            })
          }
        >
          导出逆向模型…
        </button>
        <button
          type="button"
          disabled
          title="稍后：BI 工作区尚未实现"
        >
          创建 BI 工作区…（稍后）
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
              <button
                type="button"
                className={!membership[table] ? "is-checked" : ""}
                onClick={() => void run(() => assignGroup(null))}
              >
                无组
              </button>
              {groups.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={membership[table] === g ? "is-checked" : ""}
                  onClick={() => void run(() => assignGroup(g))}
                >
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
                    void run(() => assignGroup(g));
                  }}
                >
                  加入
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              try {
                await navigator.clipboard.writeText(table);
              } catch {
                /* ignore */
              }
              onMessage(`已复制表名 ${table}`);
            })
          }
        >
          复制
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void (async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (!/create\s+(table|view)/i.test(text)) {
                  onMessage("剪贴板中没有 CREATE TABLE/VIEW 语句");
                  return;
                }
                setPasteSql(text);
                setPasteOpen(true);
              } catch {
                onMessage("无法读取剪贴板，请粘贴到对话框");
                setPasteSql("");
                setPasteOpen(true);
              }
            })()
          }
        >
          粘贴
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await dumpSingleTable({
                conn,
                database,
                table,
                includeData: false,
              });
              const meta = {
                connection: conn.name,
                engine: conn.engine,
                database,
                table,
                sharedAt: new Date().toISOString(),
              };
              downloadTextFile(
                `${table}-share.json`,
                `${JSON.stringify(meta, null, 2)}\n`,
                "application/json",
              );
              onMessage("已导出共享包（结构 SQL + 元数据 JSON）");
            })
          }
        >
          导出共享包…
        </button>
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

      {renameOpen && (
        <div className="modal-backdrop" role="presentation">
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

      {copyDialog && (
        <div className="modal-backdrop" role="presentation">
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
                onMessage(`已复制表 → ${next}`);
                onRefresh();
                setCopyDialog(null);
              });
            }}
          >
            <h2>复制表</h2>
            <label>
              新表名
              <input
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  setCopyDialog(null);
                  onClose();
                }}
              >
                取消
              </button>
              <button type="submit" disabled={busy}>
                确定
              </button>
            </div>
          </form>
        </div>
      )}

      {genOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const n = await generateTableRows({
                  connectionId: conn.id,
                  database,
                  table,
                  count: genCount,
                });
                emitTableDataChanged({
                  connectionId: conn.id,
                  database,
                  table,
                });
                onMessage(`已生成 ${n} 行测试数据`);
                onRefresh();
                setGenOpen(false);
              });
            }}
          >
            <h2>数据生成 · {table}</h2>
            <label>
              行数（1–5000）
              <input
                type="number"
                min={1}
                max={5000}
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value) || 1)}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  setGenOpen(false);
                  onClose();
                }}
              >
                取消
              </button>
              <button type="submit" disabled={busy}>
                生成
              </button>
            </div>
          </form>
        </div>
      )}

      {aiOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              const suggested = suggestColumnsFromPrompt(aiPrompt);
              ensureContext();
              openTableDesigner({
                connection: conn,
                database,
                table: suggested.tableName,
                mode: "create",
                seedColumns: suggested.columns,
              });
              setAiOpen(false);
              onClose();
            }}
          >
            <h2>通过 AI 新建表</h2>
            <p className="table-io-meta">
              本地启发式生成列结构（无需外网）。描述表用途与字段即可。
            </p>
            <label>
              需求描述
              <textarea
                rows={4}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  setAiOpen(false);
                  onClose();
                }}
              >
                取消
              </button>
              <button type="submit" disabled={!aiPrompt.trim()}>
                生成并打开设计器
              </button>
            </div>
          </form>
        </div>
      )}

      {permOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" style={{ minWidth: 420 }}>
            <h2>表权限 · {database}.{table}</h2>
            <pre className="perm-grants">
              {grants.length ? grants.join("\n") : "（无相关 GRANT）"}
            </pre>
            <label>
              用户 (user@host)
              <input
                value={grantUser}
                onChange={(e) => setGrantUser(e.target.value)}
              />
            </label>
            <label>
              权限
              <input
                value={grantPriv}
                onChange={(e) => setGrantPriv(e.target.value)}
                placeholder="SELECT,INSERT"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  setPermOpen(false);
                  onClose();
                }}
              >
                关闭
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await grantTablePrivilege({
                      connectionId: conn.id,
                      engine: String(conn.engine),
                      database,
                      table,
                      userHost: grantUser,
                      privilege: grantPriv,
                    });
                    onMessage("已执行 GRANT");
                    setPermOpen(false);
                  })
                }
              >
                授予
              </button>
            </div>
          </div>
        </div>
      )}

      {pasteOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await openConnection(conn.id);
                if (isMysql) {
                  await executeSql(conn.id, `USE \`${database.replace(/`/g, "``")}\``);
                }
                await executeSql(conn.id, pasteSql);
                onMessage("已执行粘贴的 DDL");
                onRefresh();
                setPasteOpen(false);
              });
            }}
          >
            <h2>粘贴 DDL</h2>
            <textarea
              rows={8}
              value={pasteSql}
              onChange={(e) => setPasteSql(e.target.value)}
              placeholder="CREATE TABLE ..."
              autoFocus
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
              <button type="submit" disabled={busy || !pasteSql.trim()}>
                执行
              </button>
            </div>
          </form>
        </div>
      )}

      {ioWizard && (
        <TableIoWizard
          mode={ioWizard}
          connectionId={conn.id}
          database={database}
          table={table}
          onClose={() => {
            setIoWizard(null);
            onClose();
          }}
          onDone={(msg) => {
            onMessage(msg);
            onRefresh();
          }}
        />
      )}
    </>
  );
}
