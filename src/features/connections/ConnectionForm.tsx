import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useModSaveShortcut } from "../../hooks/useModSaveShortcut";
import { invoke } from "../../lib/invoke";
import { getConnectionSecrets } from "./api";
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
  redis: 6379,
};

/** CJK ideographs / compatibility — blocked on technical fields. */
const CHINESE_RE =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g;

function stripChinese(value: string): string {
  return value.replace(CHINESE_RE, "");
}

function hasChinese(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/.test(
    value,
  );
}

function onNoChineseField(
  setter: (v: string) => void,
): (e: ChangeEvent<HTMLInputElement>) => void {
  return (e) => setter(stripChinese(e.target.value));
}

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
  const [showPassword, setShowPassword] = useState(false);
  const [sslMode, setSslMode] = useState(initial?.sslMode ?? "disable");
  const [sslTrust, setSslTrust] = useState(initial?.sslTrust ?? false);
  const [sshEnabled, setSshEnabled] = useState(initial?.sshEnabled ?? false);
  const [sshHost, setSshHost] = useState(initial?.sshHost ?? "");
  const [sshPort, setSshPort] = useState<number>(initial?.sshPort ?? 22);
  const [sshUser, setSshUser] = useState(initial?.sshUser ?? "");
  const [sshPassword, setSshPassword] = useState("");
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [starred, setStarred] = useState(initial?.starred ?? false);
  const [color, setColor] = useState(initial?.color ?? "#0969da");
  const [groupName, setGroupName] = useState(initial?.groupName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  /** 测试连接遮罩：立即显示，且至少停留 400ms 避免一闪而过 */
  const [busyVisible, setBusyVisible] = useState(false);
  const busyStartRef = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (testing) {
      busyStartRef.current = Date.now();
      setBusyVisible(true);
      return;
    }
    const elapsed = Date.now() - busyStartRef.current;
    const rest = Math.max(0, 400 - elapsed);
    const timer = window.setTimeout(() => setBusyVisible(false), rest);
    return () => window.clearTimeout(timer);
  }, [testing]);

  useModSaveShortcut(() => {
    if (!saving && !testing) formRef.current?.requestSubmit();
  }, !saving && !testing);

  useEffect(() => {
    if (!initial?.id || !initial.hasPassword) return;
    let cancelled = false;
    void getConnectionSecrets(initial.id)
      .then((secrets) => {
        if (cancelled) return;
        if (secrets.password) setPassword(secrets.password);
        if (secrets.sshPassword) setSshPassword(secrets.sshPassword);
      })
      .catch(() => {
        /* keep empty; user can re-enter */
      });
    return () => {
      cancelled = true;
    };
  }, [initial?.id, initial?.hasPassword]);

  const title = useMemo(() => {
    if (!initial?.id) {
      return initial?.name?.includes("副本") ? "复制连接" : "新建连接";
    }
    return "编辑连接";
  }, [initial]);

  function buildInput(): UpsertConnectionInput {
    return {
      id: initial?.id || undefined,
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

  /** Redis 的 database 字段表示 DB 编号，不是库名。 */
  function assertRedisDbIndex(): string | null {
    if (engine !== "redis") return null;
    const raw = database.trim();
    if (!raw) return null;
    if (!/^\d+$/.test(raw) || Number(raw) > 255) {
      return "DB 编号应为 0–255 的整数";
    }
    return null;
  }

  /** 显示名、分组可中文；其余技术字段禁止中文。 */
  function assertNoChineseFields(): string | null {
    const checks: [string, string][] = [
      [engine === "sqlite" ? "文件路径" : "主机", host],
      [engine === "redis" ? "DB 编号" : "数据库", database],
      ["用户名", user],
      ["密码", password],
      ["SSH 主机", sshHost],
      ["SSH 用户", sshUser],
      ["SSH 密码", sshPassword],
    ];
    for (const [label, value] of checks) {
      if (value && hasChinese(value)) {
        return `「${label}」不能包含中文`;
      }
    }
    return null;
  }

  async function onTest() {
    setError(null);
    setInfo(null);
    const redisErr = assertRedisDbIndex();
    if (redisErr) {
      setError(redisErr);
      return;
    }
    const chineseErr = assertNoChineseFields();
    if (chineseErr) {
      setError(chineseErr);
      return;
    }
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
    const redisErr = assertRedisDbIndex();
    if (redisErr) {
      setError(redisErr);
      return;
    }
    const chineseErr = assertNoChineseFields();
    if (chineseErr) {
      setError(chineseErr);
      return;
    }
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
      <form ref={formRef} className="modal modal-wide" onSubmit={onSubmit}>
        <h2>{title}</h2>
        <div className="modal-grid">
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
                if (!initial) {
                  setPort(defaultPort[next]);
                  if (next === "redis" && !database.trim()) setDatabase("0");
                  if (engine === "redis" && next !== "redis" && database.trim() === "0") {
                    setDatabase("");
                  }
                }
              }}
            >
              <option value="mysql">MySQL</option>
              <option value="postgres">PostgreSQL</option>
              <option value="sqlite">SQLite</option>
              <option value="redis">Redis</option>
            </select>
          </label>

          {engine === "sqlite" ? (
            <label className="modal-span-2">
              文件路径
              <input
                value={host}
                onChange={onNoChineseField(setHost)}
                placeholder="/path/to/file.db"
                spellCheck={false}
              />
            </label>
          ) : (
            <>
              <label>
                主机
                <input
                  value={host}
                  onChange={onNoChineseField(setHost)}
                  placeholder="127.0.0.1"
                  spellCheck={false}
                />
              </label>
              <label>
                端口
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </label>
              <label>
                {engine === "redis" ? "DB 编号（0–255）" : "数据库"}
                <input
                  value={database}
                  onChange={onNoChineseField(setDatabase)}
                  placeholder={engine === "redis" ? "0" : undefined}
                  spellCheck={false}
                />
              </label>
              <label>
                {engine === "redis" ? "ACL 用户名（可选）" : "用户名"}
                <input
                  value={user}
                  onChange={onNoChineseField(setUser)}
                  spellCheck={false}
                />
              </label>
              <label>
                密码
                <div className="password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={onNoChineseField(setPassword)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    title={showPassword ? "隐藏密码" : "显示密码"}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </label>
              <label>
                SSL
                <select
                  value={sslMode}
                  onChange={(e) => setSslMode(e.target.value)}
                >
                  <option value="disable">disable</option>
                  <option value="require">require</option>
                </select>
              </label>
            </>
          )}

        </div>

        <div className="modal-opts">
          {engine !== "sqlite" && sslMode === "require" && (
            <label className="modal-check">
              <input
                type="checkbox"
                checked={sslTrust}
                onChange={(e) => setSslTrust(e.target.checked)}
              />
              <span>信任服务端证书（危险，仅开发）</span>
            </label>
          )}
          {engine !== "sqlite" && (
            <label className="modal-check">
              <input
                type="checkbox"
                checked={sshEnabled}
                onChange={(e) => setSshEnabled(e.target.checked)}
              />
              <span>使用 SSH Tunnel</span>
            </label>
          )}
          {engine !== "sqlite" && sshEnabled && (
            <div className="modal-grid modal-ssh-grid">
              <label>
                SSH 主机
                <input
                  value={sshHost}
                  onChange={onNoChineseField(setSshHost)}
                  placeholder="jump.example.com"
                  spellCheck={false}
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
                  onChange={onNoChineseField(setSshUser)}
                  spellCheck={false}
                />
              </label>
              <label>
                SSH 密码
                <div className="password-field">
                  <input
                    type={showSshPassword ? "text" : "password"}
                    value={sshPassword}
                    onChange={onNoChineseField(setSshPassword)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    title={showSshPassword ? "隐藏密码" : "显示密码"}
                    aria-label={showSshPassword ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowSshPassword((v) => !v)}
                  >
                    {showSshPassword ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </label>
            </div>
          )}
          <div className="modal-opts-row">
            <label className="modal-check">
              <input
                type="checkbox"
                checked={starred}
                onChange={(e) => setStarred(e.target.checked)}
              />
              <span>星标</span>
            </label>
            <label className="modal-color">
              <span>颜色</span>
              <input
                type="color"
                value={color || "#0969da"}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
          </div>
          <label className="modal-group">
            <span>分组</span>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例如：开发 / 测试"
            />
          </label>
        </div>
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
          <button
            type="submit"
            disabled={saving || testing}
            title="保存 (⌘/Ctrl+S)"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>

        <div
          className={`modal-busy ${busyVisible ? "is-visible" : ""}`}
          aria-hidden={!busyVisible}
          role="status"
          aria-live="polite"
        >
          <div className="modal-busy-card">
            <span className="modal-busy-spinner" aria-hidden />
            <span className="modal-busy-text">正在测试连接…</span>
          </div>
        </div>
      </form>
    </div>
  );
}

function IconEye() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 13.5 13 2.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
