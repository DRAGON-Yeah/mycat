import { useState } from "react";
import type { ConnectionDto } from "../connections/types";
import { executeSql, openConnection } from "../connections/sessionApi";
import { useWorkspaceStore } from "../../stores/workspaceStore";

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

function escapeIdent(name: string) {
  return name.replace(/`/g, "``");
}

function qTable(database: string, table: string) {
  return `\`${escapeIdent(database)}\`.\`${escapeIdent(table)}\``;
}

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
  const openTable = useWorkspaceStore((s) => s.openTable);
  const openQuery = useWorkspaceStore((s) => s.openQuery);
  const openConn = useWorkspaceStore((s) => s.openConnection);
  const selectDatabase = useWorkspaceStore((s) => s.selectDatabase);
  const selectTableMeta = useWorkspaceStore((s) => s.selectTableMeta);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const closeTab = useWorkspaceStore((s) => s.closeTab);

  const isView = kind === "view";

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

  return (
    <>
      <div
        className="dg-context-menu conn-context-menu"
        style={{ left: target.x, top: target.y }}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            openConn(conn);
            selectDatabase(database);
            selectTableMeta(table);
            openTable(table);
            onClose();
          }}
        >
          打开{isView ? "视图" : "表"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            openConn(conn);
            selectDatabase(database);
            openQuery({
              connection: conn,
              database,
              title: `${table} 结构`,
              sql:
                String(conn.engine) === "postgres"
                  ? `SELECT column_name, data_type, is_nullable\nFROM information_schema.columns\nWHERE table_name = '${table.replace(/'/g, "''")}'\nORDER BY ordinal_position;`
                  : isView
                    ? `SHOW CREATE VIEW \`${escapeIdent(table)}\`;`
                    : `SHOW FULL COLUMNS FROM ${qTable(database, table)};\nSHOW CREATE TABLE ${qTable(database, table)};`,
            });
            onClose();
          }}
        >
          设计{isView ? "视图" : "表"}…
        </button>
        <div className="dg-menu-sep" />
        {!isView && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    `清空表「${table}」的所有数据？\n（DELETE FROM，可回滚取决于引擎/事务）`,
                  )
                ) {
                  return;
                }
                void run(async () => {
                  await openConnection(conn.id);
                  await executeSql(
                    conn.id,
                    `DELETE FROM ${qTable(database, table)}`,
                  );
                  onMessage(`已清空表 ${table}`);
                  onRefresh();
                });
              }}
            >
              清空表…
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    `截断表「${table}」？\nTRUNCATE 会清空数据并重置自增（通常不可回滚）。`,
                  )
                ) {
                  return;
                }
                void run(async () => {
                  await openConnection(conn.id);
                  await executeSql(
                    conn.id,
                    `TRUNCATE TABLE ${qTable(database, table)}`,
                  );
                  onMessage(`已截断表 ${table}`);
                  onRefresh();
                });
              }}
            >
              截断表…
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRenameValue(table);
            setRenameOpen(true);
          }}
        >
          重命名…
        </button>
        <button
          type="button"
          className="is-danger"
          disabled={busy}
          onClick={() => {
            const label = isView ? "视图" : "表";
            if (
              !window.confirm(
                `删除${label}「${table}」？此操作不可恢复。`,
              )
            ) {
              return;
            }
            void run(async () => {
              await openConnection(conn.id);
              await executeSql(
                conn.id,
                isView
                  ? `DROP VIEW ${qTable(database, table)}`
                  : `DROP TABLE ${qTable(database, table)}`,
              );
              closeRelatedTabs(table);
              onMessage(`已删除${label} ${table}`);
              onRefresh();
            });
          }}
        >
          删除{isView ? "视图" : "表"}…
        </button>
        <button
          type="button"
          className="menu-cancel"
          onClick={onClose}
        >
          取消
        </button>
      </div>

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
                await openConnection(conn.id);
                if (String(conn.engine) === "postgres") {
                  await executeSql(
                    conn.id,
                    `ALTER TABLE ${qTable(database, table)} RENAME TO "${next.replace(/"/g, '""')}"`,
                  );
                } else {
                  await executeSql(
                    conn.id,
                    `RENAME TABLE ${qTable(database, table)} TO \`${escapeIdent(next)}\``,
                  );
                }
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
    </>
  );
}
