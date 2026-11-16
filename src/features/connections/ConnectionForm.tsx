import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState, type FormEvent } from "react";
import type { ConnectionDto, EngineType, UpsertConnectionInput } from "./types";

type Props = {
  initial?: ConnectionDto | null;
  onCancel: () => void;
  onSaved: (conn: ConnectionDto) => void;
  save: (input: UpsertConnectionInput) => Promise<ConnectionDto>;
};

const defaultPort: Record<EngineType, number> = {
  mysql: 3306,
  postgres: 5432,
  sqlite: 0,
};

export function ConnectionForm({ initial, onCancel, onSaved, save }: Props) {
  const [engine, setEngine] = useState<EngineType>(
    (initial?.engine as EngineType) || "mysql",
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState<number>(
    initial?.port ?? defaultPort[(initial?.engine as EngineType) || "mysql"],
  );
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [user, setUser] = useState(initial?.user ?? "");
  const [password, setPassword] = useState("");
  const [sslMode, setSslMode] = useState(initial?.sslMode ?? "disable");
  const [sslTrust, setSslTrust] = useState(initial?.sslTrust ?? false);
  const [sshEnabled, setSshEnabled] = useState(initial?.sshEnabled ?? false);
  const [sshHost, setSshHost] = useState(initial?.sshHost ?? "");
  const [sshPort, setSshPort] = useState<number>(initial?.sshPort ?? 22);
  const [sshUser, setSshUser] = useState(initial?.sshUser ?? "");
  const [sshPassword, setSshPassword] = useState("");
  const [starred, setStarred] = useState(initial?.starred ?? false);
  const [color, setColor] = useState(initial?.color ?? "#0969da");
  const [groupName, setGroupName] = useState(initial?.groupName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const title = useMemo(
    () => (initial ? "编辑连接" : "新建连接"),
    [initial],
  );

  function buildInput(): UpsertConnectionInput {
    return {
      id: initial?.id,
      name,
      engine,
      host: host || undefined,
      port: engine === "sqlite" ? undefined : port,
      database: database || undefined,
      user: user || undefined,
      password: password || undefined,
      sslMode,
      sslTrust,
      sshEnabled: engine !== "sqlite" && sshEnabled,
      sshHost: sshEnabled ? sshHost || undefined : undefined,
      sshPort: sshEnabled ? sshPort : undefined,
      sshUser: sshEnabled ? sshUser || undefined : undefined,
      sshPassword: sshEnabled ? sshPassword || undefined : undefined,
      starred,
      color: color || undefined,
      groupName: groupName || undefined,
    };
  }

  async function onTest() {
    setError(null);
    setInfo(null);
    setTesting(true);
    try {
      await invoke("test_connection", {
        opts: {
          engine,
          host: host || undefined,
          port: engine === "sqlite" ? undefined : port,
          database: database || undefined,
          user: user || undefined,
          password: password || undefined,
          sslMode,
          sslTrust,
          sshEnabled: engine !== "sqlite" && sshEnabled,
          sshHost: sshEnabled ? sshHost || undefined : undefined,
          sshPort: sshEnabled ? sshPort : undefined,
          sshUser: sshEnabled ? sshUser || undefined : undefined,
          sshPassword: sshEnabled ? sshPassword || undefined : undefined,
        },
      });
      setInfo("连接成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSaving(true);
    try {
      const saved = await save(buildInput());
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={onSubmit}>
        <h2>{title}</h2>
        <label>
          显示名
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          引擎
          <select
            value={engine}
            onChange={(e) => {
              const next = e.target.value as EngineType;
              setEngine(next);
              if (!initial) setPort(defaultPort[next]);
            }}
          >
            <option value="mysql">MySQL</option>
            <option value="postgres">PostgreSQL</option>
            <option value="sqlite">SQLite</option>
          </select>
        </label>
        <label>
          {engine === "sqlite" ? "文件路径" : "主机"}
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={engine === "sqlite" ? "/path/to/file.db" : "127.0.0.1"}
          />
        </label>
        {engine !== "sqlite" && (
          <>
            <label>
              端口
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </label>
            <label>
              数据库
              <input
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
              />
            </label>
            <label>
              用户名
              <input value={user} onChange={(e) => setUser(e.target.value)} />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={initial?.hasPassword ? "留空则保持原密码" : ""}
              />
            </label>
          </>
        )}
        {engine !== "sqlite" && (
          <>
            <label>
              SSL
              <select value={sslMode} onChange={(e) => setSslMode(e.target.value)}>
                <option value="disable">disable</option>
                <option value="require">require</option>
              </select>
            </label>
            {sslMode === "require" && (
              <label className="row-check">
                <input
                  type="checkbox"
                  checked={sslTrust}
                  onChange={(e) => setSslTrust(e.target.checked)}
                />
                信任服务端证书（危险，仅开发）
              </label>
            )}
            <label className="row-check">
              <input
                type="checkbox"
                checked={sshEnabled}
                onChange={(e) => setSshEnabled(e.target.checked)}
              />
              使用 SSH Tunnel
            </label>
            {sshEnabled && (
              <>
                <label>
                  SSH 主机
                  <input
                    value={sshHost}
                    onChange={(e) => setSshHost(e.target.value)}
                    placeholder="跳板机地址"
                  />
                </label>
                <label>
                  SSH 端口
                  <input
                    type="number"
                    value={sshPort}
                    onChange={(e) => setSshPort(Number(e.target.value))}
                  />
                </label>
                <label>
                  SSH 用户
                  <input
                    value={sshUser}
                    onChange={(e) => setSshUser(e.target.value)}
                  />
                </label>
                <label>
                  SSH 密码
                  <input
                    type="password"
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                    placeholder={initial?.sshEnabled ? "留空则保持原密码" : ""}
                  />
                </label>
              </>
            )}
          </>
        )}
        <label className="row-check">
          <input
            type="checkbox"
            checked={starred}
            onChange={(e) => setStarred(e.target.checked)}
          />
          星标
        </label>
        <label>
          颜色
          <input
            type="color"
            value={color || "#0969da"}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          分组
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="例如：开发 / 测试"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        {info && <p className="form-info">{info}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            disabled={testing || saving}
            onClick={() => void onTest()}
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button type="submit" disabled={saving || testing}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
