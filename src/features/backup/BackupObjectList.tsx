import { useEffect, useMemo, useRef, useState } from "react";
import { useColumnResize } from "../data-grid/useColumnResize";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  BackupsFolderContextMenu,
  type BackupsFolderMenuTarget,
} from "../nav-tree/BackupsFolderContextMenu";
import {
  BackupItemContextMenu,
  type BackupItemMenuTarget,
} from "../nav-tree/BackupItemContextMenu";
import {
  deleteBackup,
  duplicateBackup,
  formatBackupSize,
  formatBackupTime,
  getBackupSql,
  listBackups,
  renameBackup,
  type BackupMeta,
} from "./backupMeta";
import { BackupWizard } from "./BackupWizard";
import { downloadTextFile, isSaveCancelled } from "../import-export/csv";
import { executeSqlFile } from "./backupDump";

const BACKUP_COLS = [
  { key: "name", label: "名称", defaultWidth: 220 },
  { key: "createdAt", label: "创建时间", defaultWidth: 170 },
  { key: "size", label: "大小", defaultWidth: 100 },
  { key: "comment", label: "注释", defaultWidth: 240 },
] as const;

export function BackupObjectList() {
  const connection = useWorkspaceStore((s) => s.activeConnection);
  const database = useWorkspaceStore((s) => s.selectedDatabase);
  const selectTableMeta = useWorkspaceStore((s) => s.selectTableMeta);
  const selectedTable = useWorkspaceStore((s) => s.selectedTable);
  const objectListFilter = useWorkspaceStore((s) => s.objectListFilter);
  const focusObjectListFilter = useWorkspaceStore(
    (s) => s.focusObjectListFilter,
  );
  const setObjectListFilter = useWorkspaceStore((s) => s.setObjectListFilter);
  const consumeObjectListFilterFocus = useWorkspaceStore(
    (s) => s.consumeObjectListFilterFocus,
  );

  const [items, setItems] = useState<BackupMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [folderMenu, setFolderMenu] = useState<BackupsFolderMenuTarget | null>(
    null,
  );
  const [itemMenu, setItemMenu] = useState<BackupItemMenuTarget | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<BackupMeta | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<BackupMeta | null>(null);
  const [renameTarget, setRenameTarget] = useState<BackupMeta | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const listResetKey = useMemo(
    () => `${connection?.id ?? ""}:${database ?? ""}:backups`,
    [connection?.id, database],
  );
  const { widths: colWidths, startResize } = useColumnResize({
    defaultWidth: 120,
    minWidth: 48,
    resetKey: listResetKey,
  });
  function colW(key: string, fallback: number) {
    return colWidths[key] ?? fallback;
  }

  useEffect(() => {
    setFilter(objectListFilter);
  }, [objectListFilter]);

  useEffect(() => {
    if (!focusObjectListFilter) return;
    filterRef.current?.focus();
    filterRef.current?.select();
    consumeObjectListFilterFocus();
  }, [focusObjectListFilter, consumeObjectListFilterFocus]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".dg-context-menu, .modal, .modal-backdrop")) return;
      setFolderMenu(null);
      setItemMenu(null);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  useEffect(() => {
    function onRefresh() {
      setTick((x) => x + 1);
    }
    window.addEventListener("mycat:object-list-refresh", onRefresh);
    return () =>
      window.removeEventListener("mycat:object-list-refresh", onRefresh);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!connection || !database) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "r") {
        e.preventDefault();
        setTick((x) => x + 1);
        return;
      }
      if (key === "n") {
        e.preventDefault();
        setWizardOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connection, database]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!connection || !database) {
        setItems([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const list = await listBackups({
          connectionId: connection.id,
          database,
        });
        if (!cancelled) setItems(list);
      } catch (err) {
        if (!cancelled) {
          setItems([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [connection, database, tick]);

  const filtered = items.filter((b) =>
    b.displayName.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const selected = selectedTable
    ? items.find((b) => b.id === selectedTable || b.displayName === selectedTable)
    : undefined;

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }

  function refresh() {
    setTick((x) => x + 1);
  }

  if (!connection) {
    return <p className="pane-placeholder">请先打开一个连接。</p>;
  }
  if (!database) {
    return (
      <p className="pane-placeholder">
        请在左侧展开连接，点击数据库下的「备份」查看对象列表。
      </p>
    );
  }

  return (
    <div
      className="object-list-grid"
      onContextMenu={(e) => {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("tr, .dg-context-menu, .modal")) return;
        e.preventDefault();
        setItemMenu(null);
        setFolderMenu({
          x: e.clientX,
          y: e.clientY,
          conn: connection,
          database,
          selectedBackupId: selected?.id ?? null,
        });
      }}
    >
      <div className="object-list-toolbar navicat-obj-toolbar">
        <div className="obj-toolbar-left">
          <button
            type="button"
            className="obj-tool-btn"
            title="刷新"
            onClick={() => refresh()}
          >
            ↻
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            title="还原备份"
            disabled={!selected || busy}
            onClick={() => selected && setRestoreConfirm(selected)}
          >
            还原
          </button>
          <button
            type="button"
            className="obj-tool-btn"
            title="新建备份 (⌘N)"
            onClick={() => setWizardOpen(true)}
          >
            新建
          </button>
          <button
            type="button"
            className="obj-tool-btn is-danger-text"
            title="删除备份"
            disabled={!selected || busy}
            onClick={() => selected && setDeleteConfirm(selected)}
          >
            删除
          </button>
          <span className="obj-tool-sep" />
          <span className="object-list-title">
            对象 · 备份
            <span className="object-list-count">{filtered.length}</span>
          </span>
        </div>
        <input
          ref={filterRef}
          className="object-list-filter"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setObjectListFilter(e.target.value);
          }}
          placeholder="搜索"
        />
      </div>
      {toast && <p className="obj-toast">{toast}</p>}
      {error && <p className="pane-error">{error}</p>}
      {loading && items.length === 0 && (
        <p className="pane-placeholder">加载中…</p>
      )}

      {(items.length > 0 || (!loading && !error)) && (
        <div className={`object-list-table-wrap ${loading ? "is-loading" : ""}`}>
          <table className="object-list-table">
            <thead>
              <tr>
                {BACKUP_COLS.map((c) => {
                  const w = colW(c.key, c.defaultWidth);
                  return (
                    <th
                      key={c.key}
                      style={{ width: w, minWidth: w, maxWidth: w }}
                    >
                      {c.label}
                      <span
                        className="col-resize-handle"
                        onMouseDown={(e) => startResize(c.key, e)}
                        title="拖拽调整列宽"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr
                  key={b.id}
                  className={
                    selected?.id === b.id ? "is-selected" : undefined
                  }
                  onClick={() => selectTableMeta(b.id)}
                  onDoubleClick={() => setRestoreConfirm(b)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectTableMeta(b.id);
                    setFolderMenu(null);
                    setItemMenu({
                      x: e.clientX,
                      y: e.clientY,
                      conn: connection,
                      database,
                      backup: b,
                    });
                  }}
                >
                  <td
                    style={{
                      width: colW("name", 220),
                      maxWidth: colW("name", 220),
                    }}
                  >
                    <span className="object-kind is-backup">Bk</span>
                    {b.displayName}
                  </td>
                  <td>{formatBackupTime(b.createdAt)}</td>
                  <td>{formatBackupSize(b.sizeBytes)}</td>
                  <td className="comment-cell">{b.comment || "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={BACKUP_COLS.length} className="pane-placeholder">
                    {loading ? "加载中…" : "无匹配备份"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {folderMenu && (
        <BackupsFolderContextMenu
          target={folderMenu}
          onClose={() => setFolderMenu(null)}
          onRefresh={refresh}
          onMessage={showToast}
          onNewBackup={() => setWizardOpen(true)}
          onRestoreSelected={() => selected && setRestoreConfirm(selected)}
          onDeleteSelected={() => selected && setDeleteConfirm(selected)}
          onDuplicateSelected={() => {
            if (!selected) return;
            void (async () => {
              try {
                setBusy(true);
                await duplicateBackup({
                  connectionId: connection.id,
                  database,
                  id: selected.id,
                });
                showToast("已复制备份");
                refresh();
              } catch (err) {
                showToast(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            })();
          }}
          onExtractSelected={() => {
            if (!selected) return;
            void (async () => {
              try {
                setBusy(true);
                const sql = await getBackupSql({
                  connectionId: connection.id,
                  database,
                  id: selected.id,
                });
                await downloadTextFile(
                  selected.fileName,
                  sql,
                  "application/sql",
                );
                showToast("已提取 SQL");
              } catch (err) {
                if (!isSaveCancelled(err)) {
                  showToast(err instanceof Error ? err.message : String(err));
                }
              } finally {
                setBusy(false);
              }
            })();
          }}
          onRenameSelected={() => {
            if (!selected) return;
            setRenameValue(selected.displayName);
            setRenameTarget(selected);
          }}
        />
      )}

      {itemMenu && (
        <BackupItemContextMenu
          target={itemMenu}
          onClose={() => setItemMenu(null)}
          onRefresh={refresh}
          onMessage={showToast}
          onNewBackup={() => setWizardOpen(true)}
        />
      )}

      {wizardOpen && (
        <BackupWizard
          conn={connection}
          database={database}
          onClose={() => setWizardOpen(false)}
          onCompleted={() => {
            refresh();
          }}
          onMessage={showToast}
        />
      )}

      {deleteConfirm && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal danger-confirm-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2>删除备份</h2>
            <p className="danger-confirm-text">
              确定删除备份 <strong>{deleteConfirm.displayName}</strong>{" "}
              吗？此操作不可恢复。
            </p>
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={busy}
                autoFocus
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      await deleteBackup({
                        connectionId: connection.id,
                        database,
                        id: deleteConfirm.id,
                      });
                      selectTableMeta(null);
                      setDeleteConfirm(null);
                      showToast(`已删除备份 ${deleteConfirm.displayName}`);
                      refresh();
                    } catch (err) {
                      showToast(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                {busy ? "删除中…" : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreConfirm && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal danger-confirm-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2>还原备份</h2>
            <p className="danger-confirm-text">
              将在当前库 <strong>{database}</strong> 执行备份{" "}
              <strong>{restoreConfirm.displayName}</strong>{" "}
              的 SQL。是否继续？
            </p>
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setRestoreConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={busy}
                autoFocus
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      const sql = await getBackupSql({
                        connectionId: connection.id,
                        database,
                        id: restoreConfirm.id,
                      });
                      const result = await executeSqlFile({
                        connectionId: connection.id,
                        database,
                        sql,
                      });
                      setRestoreConfirm(null);
                      showToast(
                        `还原完成：执行 ${result.done}/${result.total} 条语句`,
                      );
                      refresh();
                    } catch (err) {
                      showToast(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                {busy ? "还原中…" : "还原"}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameTarget && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setBusy(true);
                try {
                  await renameBackup({
                    connectionId: connection.id,
                    database,
                    id: renameTarget.id,
                    displayName: renameValue,
                  });
                  setRenameTarget(null);
                  showToast("已重命名");
                  refresh();
                } catch (err) {
                  showToast(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              })();
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
              <button type="button" onClick={() => setRenameTarget(null)}>
                取消
              </button>
              <button type="submit" disabled={busy || !renameValue.trim()}>
                确定
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
