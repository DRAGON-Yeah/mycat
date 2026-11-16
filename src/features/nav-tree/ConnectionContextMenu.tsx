import { useEffect, useMemo, useRef, useState } from "react";
import {
  CONNECTION_COLORS,
  connectionToUpsert,
} from "../connections/connectionHelpers";
import {
  listConnProfiles,
  newProfileId,
  saveConnProfiles,
  type ConnProfile,
} from "../connections/connectionProfiles";
import { upsertConnection } from "../connections/api";
import type { ConnectionDto } from "../connections/types";
import { openConnection } from "../connections/sessionApi";
import { downloadTextFile, isSaveCancelled } from "../import-export/csv";
import { useWorkspaceStore } from "../../stores/workspaceStore";

export type ConnMenuTarget = {
  x: number;
  y: number;
  conn: ConnectionDto;
};

type Props = {
  target: ConnMenuTarget;
  groupNames: string[];
  onClose: () => void;
  onReload: () => Promise<void>;
  onRefreshDatabases: (connId: string) => Promise<void>;
  onRequestCloseConnection: (connId: string) => void;
  onRequestEditConnection: (connId: string) => void;
  onNewConnection: () => void;
  onDuplicateConnection: (conn: ConnectionDto) => void;
  onDeleteConnection: (conn: ConnectionDto) => void;
  onMessage: (msg: string) => void;
  onAskNewDatabase: (conn: ConnectionDto) => void;
};

export function ConnectionContextMenu({
  target,
  groupNames,
  onClose,
  onReload,
  onRefreshDatabases,
  onRequestCloseConnection,
  onRequestEditConnection,
  onNewConnection,
  onDuplicateConnection,
  onDeleteConnection,
  onMessage,
  onAskNewDatabase,
}: Props) {
  const { conn } = target;
  const [busy, setBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [profiles, setProfiles] = useState<ConnProfile[]>([]);
  const [newGroup, setNewGroup] = useState("");
  const sqlFileRef = useRef<HTMLInputElement>(null);

  const openConn = useWorkspaceStore((s) => s.openConnection);
  const openQuery = useWorkspaceStore((s) => s.openQuery);
  const openConsole = useWorkspaceStore((s) => s.openConsole);

  useEffect(() => {
    void listConnProfiles(conn.id).then(setProfiles).catch(() => setProfiles([]));
  }, [conn.id]);

  const otherGroups = useMemo(() => {
    const set = new Set(groupNames.filter(Boolean));
    if (conn.groupName) set.add(conn.groupName);
    return [...set].sort((a, b) => a.localeCompare(b, "zh"));
  }, [groupNames, conn.groupName]);

  async function run(action: () => Promise<void> | void) {
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

  async function patchConn(patch: Parameters<typeof connectionToUpsert>[1]) {
    await upsertConnection(connectionToUpsert(conn, patch));
    await onReload();
  }

  async function switchProfile(p: ConnProfile) {
    await upsertConnection(
      connectionToUpsert(conn, {
        host: p.host ?? undefined,
        port: p.port ?? undefined,
        database: p.database ?? undefined,
        user: p.user ?? undefined,
      }),
    );
    await onReload();
    onMessage(`已切换到配置「${p.name}」`);
  }

  async function saveCurrentAsProfile() {
    const name = `配置 ${profiles.length + 1}`;
    const next: ConnProfile[] = [
      ...profiles,
      {
        id: newProfileId(),
        name,
        host: conn.host,
        port: conn.port,
        database: conn.database,
        user: conn.user,
      },
    ];
    await saveConnProfiles(conn.id, next);
    setProfiles(next);
    onMessage(`已保存配置「${name}」`);
  }

  async function shareConnection() {
    const payload = {
      name: conn.name,
      engine: conn.engine,
      host: conn.host,
      port: conn.port,
      database: conn.database,
      user: conn.user,
      sslMode: conn.sslMode,
      sslTrust: conn.sslTrust,
      sshEnabled: conn.sshEnabled,
      sshHost: conn.sshHost,
      sshPort: conn.sshPort,
      sshUser: conn.sshUser,
      color: conn.color,
      starred: conn.starred,
      groupName: conn.groupName,
      hasPassword: conn.hasPassword,
    };
    await downloadTextFile(
      `${conn.name || "connection"}.json`,
      `${JSON.stringify(payload, null, 2)}\n`,
      "application/json",
    );
    onMessage("已导出连接（不含密码）");
  }

  return (
    <div
      className="dg-context-menu tree-context-menu conn-context-menu"
      style={{ left: target.x, top: target.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onRequestCloseConnection(conn.id);
          onClose();
        }}
      >
        关闭连接
        <span className="menu-shortcut">⇧⌘.</span>
      </button>

      <div
        className={`dg-menu-item has-sub ${profileOpen ? "is-open" : ""}`}
        onMouseEnter={() => setProfileOpen(true)}
        onMouseLeave={() => setProfileOpen(false)}
      >
        <button type="button" className="dg-menu-trigger" disabled={busy}>
          切换连接配置文件
          <span className="dg-menu-arrow">›</span>
        </button>
        {profileOpen && (
          <div className="dg-submenu">
            <button type="button" className="is-muted" disabled>
              当前 · {conn.name}
            </button>
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void run(() => switchProfile(p))}
              >
                {p.name}
              </button>
            ))}
            <div className="dg-menu-sep" />
            <button
              type="button"
              onClick={() => void run(() => saveCurrentAsProfile())}
            >
              另存为配置文件…
            </button>
          </div>
        )}
      </div>

      <div className="dg-menu-sep" />

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onRequestEditConnection(conn.id);
          onClose();
        }}
      >
        编辑连接…
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onNewConnection();
          onClose();
        }}
      >
        新建连接
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onDeleteConnection(conn);
          onClose();
        }}
      >
        删除连接
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onDuplicateConnection(conn);
          onClose();
        }}
      >
        复制连接…
      </button>

      <div className="dg-menu-sep" />

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onAskNewDatabase(conn);
          onClose();
        }}
      >
        新建数据库…
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          openConn(conn);
          openQuery({ connection: conn, database: conn.database ?? undefined });
          onClose();
        }}
      >
        新建查询
        <span className="menu-shortcut">⌘Y</span>
      </button>

      <div className="dg-menu-sep" />

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          openConsole({
            connection: conn,
            database: conn.database?.trim() || null,
          });
          onClose();
        }}
      >
        命令行界面
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => sqlFileRef.current?.click()}
      >
        运行 SQL 文件…
      </button>
      <input
        ref={sqlFileRef}
        type="file"
        accept=".sql,text/plain"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void run(async () => {
            await openConnection(conn.id);
            const text = await file.text();
            const title = file.name.replace(/\.sql$/i, "") || file.name;
            openQuery({
              connection: conn,
              database: conn.database?.trim() || undefined,
              title,
              sql: text,
              autoRun: true,
            });
            onMessage(`已打开并执行 SQL 文件：${file.name}`);
          });
        }}
      />

      <div
        className={`dg-menu-item has-sub ${reloadOpen ? "is-open" : ""}`}
        onMouseEnter={() => setReloadOpen(true)}
        onMouseLeave={() => setReloadOpen(false)}
      >
        <button type="button" className="dg-menu-trigger" disabled={busy}>
          重载
          <span className="dg-menu-arrow">›</span>
        </button>
        {reloadOpen && (
          <div className="dg-submenu">
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await onRefreshDatabases(conn.id);
                  onMessage("已重载数据库");
                })
              }
            >
              重载数据库
            </button>
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await onReload();
                  onMessage("已重载连接列表");
                })
              }
            >
              重载连接列表
            </button>
          </div>
        )}
      </div>

      <div className="dg-menu-sep" />

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await patchConn({ starred: !conn.starred });
            onMessage(conn.starred ? "已取消星标" : "已添加星标");
          })
        }
      >
        {conn.starred ? "取消星标" : "添加星标"}
      </button>

      <div className="conn-color-row">
        <span className="conn-color-label">颜色:</span>
        <div className="conn-color-dots">
          {CONNECTION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`conn-color-dot ${conn.color === c ? "is-active" : ""}`}
              style={{ background: c }}
              title={c}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await patchConn({ color: c });
                })
              }
            />
          ))}
        </div>
      </div>

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
          <div className="dg-submenu conn-group-submenu">
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await patchConn({ groupName: "" });
                  onMessage("已移出分组");
                })
              }
            >
              未分组
            </button>
            {otherGroups.map((g) => (
              <button
                key={g}
                type="button"
                className={conn.groupName === g ? "is-checked" : ""}
                onClick={() =>
                  void run(async () => {
                    await patchConn({ groupName: g });
                    onMessage(`已加入组「${g}」`);
                  })
                }
              >
                {conn.groupName === g ? "✓ " : ""}
                {g}
              </button>
            ))}
            <div className="dg-menu-sep" />
            <div className="conn-group-new">
              <input
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder="新组名"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                disabled={!newGroup.trim()}
                onClick={() =>
                  void run(async () => {
                    const g = newGroup.trim();
                    await patchConn({ groupName: g });
                    onMessage(`已加入组「${g}」`);
                  })
                }
              >
                创建
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void run(() => shareConnection());
          onClose();
        }}
      >
        共享…
      </button>

      <div className="dg-menu-sep" />

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await onRefreshDatabases(conn.id);
            onMessage("已刷新");
          })
        }
      >
        刷新
        <span className="menu-shortcut">⌘R</span>
      </button>
    </div>
  );
}
