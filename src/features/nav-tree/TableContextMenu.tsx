import { useEffect, useState } from "react";
import type { ConnectionDto } from "../connections/types";
import { executeSql, openConnection } from "../connections/sessionApi";
import { downloadTextFile, isSaveCancelled } from "../import-export/csv";
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
  revokeTablePrivilege,
} from "./tableDataTools";
import { getGridViewSnapshot } from "../data-grid/gridViewSnapshot";
import {
  copyTable,
  copyView,
  dropTableOrView,
  dumpSingleTable,
  emptyTable,
  exportTableDictionary,
  fetchCreateDdl,
  maintainOpsForEngine,
  maintainTable,
  renameTable,
  reverseSingleTableModel,
  truncateTable,
  type MaintainOp,
} from "./tableMenuActions";
import { SimpleChartDialog } from "./SimpleChartDialog";

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
  const [permOpen, setPermOpen] = useState(false);
  const [grants, setGrants] = useState<string[]>([]);
  const [grantUser, setGrantUser] = useState("app@%");
  const [grantPriv, setGrantPriv] = useState("SELECT");
  const [ioWizard, setIoWizard] = useState<"import" | "export" | "mask" | null>(
    null,
  );
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteSql, setPasteSql] = useState("");
  const [pasteTableName, setPasteTableName] = useState("");
  const [maintainResult, setMaintainResult] = useState<{
    op: string;
    columns: string[];
    rows: unknown[][];
  } | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const [dangerConfirm, setDangerConfirm] = useState<
    null | "delete" | "empty" | "truncate"
  >(null);

  const openTable = useWorkspaceStore((s) => s.openTable);
  const openConn = useWorkspaceStore((s) => s.openConnection);
  const selectDatabase = useWorkspaceStore((s) => s.selectDatabase);
  const selectTableMeta = useWorkspaceStore((s) => s.selectTableMeta);
  const openTableDesigner = useWorkspaceStore((s) => s.openTableDesigner);
  const openViewDesigner = useWorkspaceStore((s) => s.openViewDesigner);
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
      if (isSaveCancelled(err)) {
        onClose();
        return;
      }
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
    const snap =
      (active && getGridViewSnapshot(active.id)) ||
      active?.openOptions ||
      null;
    const raw = window.prompt(
      "配置名称",
      `配置 ${profiles.length + 1}`,
    );
    if (!raw?.trim()) return;
    const name = raw.trim();
    const next: TableOpenProfile[] = [
      ...profiles,
      {
        id: newTableProfileId(),
        name,
        sortCol: snap?.sortCol,
        sortDir: snap?.sortDir,
        filterCol: snap?.filterCol,
        filterValue: snap?.filterValue,
        pageSize: snap?.pageSize ?? 1000,
      },
    ];
    await saveTableProfiles(conn.id, database, table, next);
    setProfiles(next);
    onMessage(`已保存打开配置「${name}」`);
  }

  async function deleteProfile(id: string) {
    const next = profiles.filter((p) => p.id !== id);
    await saveTableProfiles(conn.id, database, table, next);
    setProfiles(next);
    onMessage("已删除配置");
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

  async function renameGroup(oldName: string) {
    const raw = window.prompt("新组名", oldName);
    if (!raw?.trim() || raw.trim() === oldName) return;
    const nextName = raw.trim();
    const nextMembership = { ...membership };
    for (const [k, v] of Object.entries(nextMembership)) {
      if (v === oldName) nextMembership[k] = nextName;
    }
    const nextGroups = Array.from(
      new Set(groups.map((g) => (g === oldName ? nextName : g))),
    ).sort((a, b) => a.localeCompare(b, "zh"));
    await saveTableGroups(conn.id, database, {
      groups: nextGroups,
      membership: nextMembership,
    });
    setGroups(nextGroups);
    setMembership(nextMembership);
    onMessage(`组已改名为「${nextName}」`);
    onRefresh();
  }

  async function deleteGroup(groupName: string) {
    if (!window.confirm(`删除组「${groupName}」？（表不会被删除）`)) return;
    const nextMembership = { ...membership };
    for (const [k, v] of Object.entries(nextMembership)) {
      if (v === groupName) delete nextMembership[k];
    }
    const nextGroups = groups.filter((g) => g !== groupName);
    await saveTableGroups(conn.id, database, {
      groups: nextGroups,
      membership: nextMembership,
    });
    setGroups(nextGroups);
    setMembership(nextMembership);
    onMessage(`已删除组「${groupName}」`);
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
                <div key={p.id} className="dg-submenu-row">
                  <button
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
                  <button
                    type="button"
                    className="ghost-btn"
                    title="删除配置"
                    onClick={(e) => {
                      e.stopPropagation();
                      void run(() => deleteProfile(p.id));
                    }}
                  >
                    ×
                  </button>
                </div>
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
          disabled={busy}
          onClick={() => {
            ensureContext();
            if (isView) {
              openViewDesigner({
                connection: conn,
                database,
                view: table,
                mode: "alter",
              });
            } else {
              openTableDesigner({
                connection: conn,
                database,
                table,
                mode: "alter",
              });
            }
            onClose();
          }}
        >
          设计{isView ? "视图" : "表"}
          <span className="menu-shortcut">⌘D</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            ensureContext();
            if (isView) {
              openViewDesigner({
                connection: conn,
                database,
                view: "new_view",
                mode: "create",
              });
            } else {
              openTableDesigner({
                connection: conn,
                database,
                table: "new_table",
                mode: "create",
              });
            }
            onClose();
          }}
        >
          新建{isView ? "视图" : "表"}
          <span className="menu-shortcut">⌘N</span>
        </button>

        <div className="dg-menu-sep" />

        <button
          type="button"
          className="is-danger"
          disabled={busy}
          onClick={() => setDangerConfirm("delete")}
        >
          删除{isView ? "视图" : "表"}
        </button>
        {isView ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setCopyName(`${table}_copy`);
              setCopyDialog("structure");
            }}
          >
            复制视图
            <span className="menu-shortcut">⇧⌘D</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDangerConfirm("empty")}
            >
              清空表
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDangerConfirm("truncate")}
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
          <button
            type="button"
            disabled={busy}
            onClick={() => setIoWizard("import")}
          >
            导入向导…
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => setIoWizard("export")}
        >
          导出向导…
        </button>
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
              {!isView && (
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
              )}
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
                      void (async () => {
                        try {
                          setBusy(true);
                          const out = await maintainTable({
                            conn,
                            database,
                            table,
                            op,
                          });
                          if (out.columns.length > 0) {
                            setMaintainResult({
                              op: label,
                              columns: out.columns,
                              rows: out.rows,
                            });
                          } else {
                            onMessage(
                              `已完成：${label}（${out.rowsAffected} 行）`,
                            );
                            onClose();
                          }
                        } catch (err) {
                          onMessage(
                            err instanceof Error ? err.message : String(err),
                          );
                        } finally {
                          setBusy(false);
                        }
                      })();
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
          {isView ? "逆向视图到模型…" : "导出逆向模型…"}
        </button>
        <button
          type="button"
          disabled={busy}
          title="按当前对象生成简易统计图"
          onClick={() => {
            setChartOpen(true);
          }}
        >
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
              <button
                type="button"
                className={!membership[table] ? "is-checked" : ""}
                onClick={() => void run(() => assignGroup(null))}
              >
                无组
              </button>
              {groups.map((g) => (
                <div key={g} className="dg-submenu-row">
                  <button
                    type="button"
                    className={membership[table] === g ? "is-checked" : ""}
                    onClick={() => void run(() => assignGroup(g))}
                  >
                    {g}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    title="改名"
                    onClick={(e) => {
                      e.stopPropagation();
                      void run(() => renameGroup(g));
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    title="删除组"
                    onClick={(e) => {
                      e.stopPropagation();
                      void run(() => deleteGroup(g));
                    }}
                  >
                    ×
                  </button>
                </div>
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
          title="复制 CREATE TABLE/VIEW DDL"
          onClick={() =>
            void run(async () => {
              const ddl = await fetchCreateDdl({
                conn,
                database,
                table,
                isView,
              });
              await navigator.clipboard.writeText(ddl);
              onMessage("已复制表结构 DDL");
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
                const m = text.match(
                  /create\s+(?:table|view)\s+(?:if\s+not\s+exists\s+)?(?:`?[\w]+`?\.)?`?([\w]+)`?/i,
                );
                setPasteTableName(m?.[1] ? `${m[1]}_copy` : `${table}_paste`);
                setPasteOpen(true);
              } catch {
                onMessage("无法读取剪贴板，请粘贴到对话框");
                setPasteSql("");
                setPasteTableName(`${table}_paste`);
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
              const ddl = await fetchCreateDdl({
                conn,
                database,
                table,
                isView,
              });
              const header = [
                `-- Mycat share package`,
                `-- connection: ${conn.name}`,
                `-- engine: ${conn.engine}`,
                `-- database: ${database}`,
                `-- table: ${table}`,
                `-- sharedAt: ${new Date().toISOString()}`,
                `-- Restore: open SQL file or use Paste on table menu`,
                "",
              ].join("\n");
              await downloadTextFile(
                `${table}-share.sql`,
                `${header}${ddl}\n`,
                "application/sql",
              );
              onMessage(
                isView
                  ? "已导出共享包（视图 DDL）"
                  : "已导出共享包（可恢复的结构 SQL）",
              );
            })
          }
        >
          {isView ? "共享…" : "导出共享包…"}
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

      {dangerConfirm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setDangerConfirm(null);
            }
          }}
        >
          <div
            className="modal danger-confirm-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2>
              {dangerConfirm === "delete"
                ? `删除${isView ? "视图" : "表"}`
                : dangerConfirm === "empty"
                  ? "清空表"
                  : "截断表"}
            </h2>
            <p className="danger-confirm-text">
              {dangerConfirm === "delete" ? (
                <>
                  确定删除{isView ? "视图" : "表"}{" "}
                  <strong>
                    {database}.{table}
                  </strong>{" "}
                  吗？此操作不可恢复，相关打开的页签也会关闭。
                </>
              ) : dangerConfirm === "empty" ? (
                <>
                  确定清空表{" "}
                  <strong>
                    {database}.{table}
                  </strong>{" "}
                  的全部数据吗？表结构会保留，自增计数通常不变。
                </>
              ) : (
                <>
                  确定截断表{" "}
                  <strong>
                    {database}.{table}
                  </strong>{" "}
                  吗？全部数据将被删除，自增计数通常会重置。
                </>
              )}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDangerConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={busy}
                autoFocus
                onClick={() => {
                  const op = dangerConfirm;
                  setDangerConfirm(null);
                  if (op === "delete") {
                    const label = isView ? "视图" : "表";
                    void run(async () => {
                      await dropTableOrView({
                        conn,
                        database,
                        table,
                        isView,
                      });
                      closeRelatedTabs(table);
                      onMessage(`已删除${label} ${table}`);
                      onRefresh();
                    });
                    return;
                  }
                  if (op === "empty") {
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
                    return;
                  }
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
                {busy
                  ? "处理中…"
                  : dangerConfirm === "delete"
                    ? "删除"
                    : dangerConfirm === "empty"
                      ? "清空"
                      : "截断"}
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
              const next = renameValue.trim();
              if (!next || next === table) {
                setRenameOpen(false);
                onClose();
                return;
              }
              void run(async () => {
                await renameTable({
                  conn,
                  database,
                  table,
                  next,
                  isView,
                });
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
                onMessage(isView ? "目标视图名非法" : "目标表名非法");
                return;
              }
              void run(async () => {
                if (isView) {
                  await copyView({
                    conn,
                    database,
                    view: table,
                    newName: next,
                  });
                  onMessage(`已复制视图 → ${next}`);
                } else {
                  await copyTable({
                    conn,
                    database,
                    table,
                    newName: next,
                    includeData: copyDialog === "data",
                  });
                  onMessage(`已复制表 → ${next}`);
                }
                onRefresh();
                setCopyDialog(null);
              });
            }}
          >
            <h2>{isView ? "复制视图" : "复制表"}</h2>
            <label>
              {isView ? "新视图名" : "新表名"}
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
                  engine: String(conn.engine),
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
                    await revokeTablePrivilege({
                      connectionId: conn.id,
                      engine: String(conn.engine),
                      database,
                      table,
                      userHost: grantUser,
                      privilege: grantPriv,
                    });
                    onMessage("已执行 REVOKE");
                    setPermOpen(false);
                  })
                }
              >
                撤销
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
                if (!identOk(pasteTableName.trim())) {
                  throw new Error(
                    "新表名仅允许字母、数字、下划线，且不能以数字开头",
                  );
                }
                const name = pasteTableName.trim();
                const sql = pasteSql.replace(
                  /create\s+(table|view)\s+(if\s+not\s+exists\s+)?(?:`?[\w]+`?\.)?`?[\w]+`?/i,
                  (_m, kind: string, ifNot?: string) =>
                    `CREATE ${String(kind).toUpperCase()} ${ifNot || ""}\`${name}\``,
                );
                await openConnection(conn.id);
                if (isMysql) {
                  await executeSql(
                    conn.id,
                    `USE \`${database.replace(/`/g, "``")}\``,
                  );
                }
                await executeSql(conn.id, sql, database);
                onMessage(`已创建 ${name}`);
                onRefresh();
                setPasteOpen(false);
              });
            }}
          >
            <h2>粘贴 DDL</h2>
            <label>
              目标表名
              <input
                value={pasteTableName}
                onChange={(e) => setPasteTableName(e.target.value)}
                autoFocus
              />
            </label>
            <textarea
              rows={8}
              value={pasteSql}
              onChange={(e) => setPasteSql(e.target.value)}
              placeholder="CREATE TABLE ..."
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
                disabled={busy || !pasteSql.trim() || !pasteTableName.trim()}
              >
                执行
              </button>
            </div>
          </form>
        </div>
      )}

      {maintainResult && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" style={{ minWidth: 480 }}>
            <h2>
              维护结果 · {maintainResult.op} · {table}
            </h2>
            <div className="maintain-result-table-wrap">
              <table className="maintain-result-table">
                <thead>
                  <tr>
                    {maintainResult.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {maintainResult.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell == null ? "NULL" : String(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  setMaintainResult(null);
                  onClose();
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {chartOpen && (
        <SimpleChartDialog
          connectionId={conn.id}
          database={database}
          table={table}
          onClose={() => {
            setChartOpen(false);
            onClose();
          }}
          onMessage={onMessage}
        />
      )}

      {ioWizard && (
        <TableIoWizard
          mode={ioWizard}
          connectionId={conn.id}
          database={database}
          table={table}
          engine={String(conn.engine)}
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
