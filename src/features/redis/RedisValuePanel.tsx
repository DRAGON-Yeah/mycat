import { useEffect, useState } from "react";
import {
  redisDeleteKeys,
  redisExpire,
  redisHashDelete,
  redisHashSet,
  redisKeyDetail,
  redisSetString,
  type RedisKeyValue,
} from "./redisApi";

function formatTtl(ttl: number): string {
  if (ttl === -1) return "永久";
  if (ttl < 0) return "-";
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}h`;
  return `${Math.floor(ttl / 86400)}d`;
}

function formatSize(size: number | null): string {
  if (size == null) return "-";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

type Props = {
  connectionId: string;
  db: string;
  redisKey: string;
  onChanged: () => void;
};

export function RedisValuePanel({
  connectionId,
  db,
  redisKey,
  onChanged,
}: Props) {
  const [detail, setDetail] = useState<RedisKeyValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ttlInput, setTtlInput] = useState("");
  const [newField, setNewField] = useState("");
  const [newValue, setNewValue] = useState("");

  async function loadDetail() {
    setLoading(true);
    setError(null);
    try {
      const value = await redisKeyDetail({ connectionId, db, key: redisKey });
      setDetail(value);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (message.includes("键不存在") || message.includes("类型已变化")) {
        onChanged();
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setDetail(null);
    void loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, db, redisKey]);

  useEffect(() => {
    if (!detail) return;
    setDraft(
      detail.kind === "string"
        ? typeof detail.value === "string"
          ? detail.value
          : JSON.stringify(detail.value, null, 2)
        : "",
    );
    setTtlInput(detail.ttl > 0 ? String(detail.ttl) : "");
  }, [detail]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveString() {
    await run(async () => {
      await redisSetString({
        connectionId,
        db,
        key: redisKey,
        value: draft,
        ttl: null,
      });
    });
  }

  async function setTtl(permanent: boolean) {
    const seconds = Number(ttlInput);
    if (!permanent && (!Number.isFinite(seconds) || seconds <= 0)) {
      setError("TTL 应为正整数秒");
      return;
    }
    await run(async () => {
      await redisExpire({
        connectionId,
        db,
        key: redisKey,
        ttlSecs: permanent ? null : seconds,
      });
    });
  }

  async function deleteKey() {
    if (!window.confirm(`确定删除键「${redisKey}」？此操作不可撤销。`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await redisDeleteKeys({ connectionId, db, keys: [redisKey] });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveHashField(field: string, value: string) {
    await run(async () => {
      await redisHashSet({ connectionId, db, key: redisKey, field, value });
    });
  }

  async function removeHashField(field: string) {
    await run(async () => {
      await redisHashDelete({
        connectionId,
        db,
        key: redisKey,
        fields: [field],
      });
    });
  }

  async function addHashField() {
    const field = newField.trim();
    if (!field) {
      setError("字段名不能为空");
      return;
    }
    await run(async () => {
      await redisHashSet({
        connectionId,
        db,
        key: redisKey,
        field,
        value: newValue,
      });
      setNewField("");
      setNewValue("");
    });
  }

  if (loading && !detail) {
    return <div className="redis-empty">正在读取键值…</div>;
  }
  if (error && !detail) {
    return <div className="redis-error">{error}</div>;
  }
  if (!detail) {
    return <div className="redis-empty">选择左侧键查看值</div>;
  }

  return (
    <div className="redis-value">
      <div className="redis-value-header">
        <div className="redis-value-title">
          <span className={`redis-kind redis-kind-${detail.kind}`}>
            {detail.kind}
          </span>
          <code>{detail.key}</code>
        </div>
        <div className="redis-value-meta">
          <span>TTL: {formatTtl(detail.ttl)}</span>
          <span>大小: {formatSize(detail.size)}</span>
        </div>
      </div>

      <div className="redis-value-toolbar">
        <label className="redis-ttl-editor">
          TTL(秒)
          <input
            value={ttlInput}
            onChange={(e) => setTtlInput(e.target.value)}
            placeholder="留空=永久"
            inputMode="numeric"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void setTtl(false)}
        >
          设置 TTL
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void setTtl(true)}
        >
          永久
        </button>
        <button
          type="button"
          className="redis-danger"
          disabled={busy}
          onClick={() => void deleteKey()}
        >
          删除键
        </button>
      </div>

      {error && <div className="redis-error">{error}</div>}

      {detail.truncated && (
        <div className="redis-truncated">
          内容已截断（最多 1000 个元素或 256KB），完整内容请使用命令控制台。
        </div>
      )}

      <div className="redis-value-body">
        {detail.kind === "string" && (
          <>
            <textarea
              className="redis-value-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
            <div className="redis-value-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveString()}
              >
                保存
              </button>
            </div>
          </>
        )}

        {detail.kind === "hash" && (
          <>
            <table className="redis-value-table">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>值</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(detail.value) ? detail.value : []).map(
                  (item, index) => {
                    const row = item as { field?: unknown; value?: unknown };
                    const field = String(row.field ?? "");
                    const value = String(row.value ?? "");
                    return (
                      <tr key={`${field}-${index}`}>
                        <td>
                          <code>{field}</code>
                        </td>
                        <td>
                          <input
                            key={`${field}:${value}`}
                            className="redis-hash-input"
                            defaultValue={value}
                            disabled={busy}
                            onBlur={(e) => {
                              if (e.target.value !== value) {
                                void saveHashField(field, e.target.value);
                              }
                            }}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeHashField(field)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
            <div className="redis-hash-add">
              <input
                value={newField}
                onChange={(e) => setNewField(e.target.value)}
                placeholder="字段"
                disabled={busy}
              />
              <input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="值"
                disabled={busy}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void addHashField()}
              >
                新增/更新
              </button>
            </div>
          </>
        )}

        {(detail.kind === "list" || detail.kind === "set") && (
          <ol className="redis-value-list">
            {(Array.isArray(detail.value) ? detail.value : []).map(
              (item, index) => (
                <li key={index}>
                  <code>{String(item)}</code>
                </li>
              ),
            )}
          </ol>
        )}

        {detail.kind === "zset" && (
          <table className="redis-value-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(detail.value) ? detail.value : []).map(
                (item, index) => {
                  const row = item as { member?: unknown; score?: unknown };
                  return (
                    <tr key={`${String(row.member)}-${index}`}>
                      <td>
                        <code>{String(row.member ?? "")}</code>
                      </td>
                      <td>{String(row.score ?? "")}</td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        )}

        {detail.kind === "stream" && (
          <pre className="redis-value-text">
            {JSON.stringify(detail.value, null, 2)}
          </pre>
        )}

        {!["string", "hash", "list", "set", "zset", "stream"].includes(
          detail.kind,
        ) && <div className="redis-empty">暂不支持的类型：{detail.kind}</div>}
      </div>

      <div className="redis-value-hint">
        非 UTF-8 内容可能显示为替换字符。
      </div>
    </div>
  );
}
