import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  redisDeleteKeys,
  redisListDatabases,
  redisScanKeys,
  type RedisKeyMeta,
} from "./redisApi";
import { RedisCommandConsole } from "./RedisCommandConsole";
import { RedisKeyList } from "./RedisKeyList";
import { RedisValuePanel } from "./RedisValuePanel";

export function RedisWorkspace() {
  const activeConnection = useWorkspaceStore((s) => s.activeConnection);
  const selectedDatabase = useWorkspaceStore((s) => s.selectedDatabase);
  const openRedis = useWorkspaceStore((s) => s.openRedis);

  const isRedis = String(activeConnection?.engine ?? "").toLowerCase() === "redis";
  const connectionId = activeConnection?.id ?? "";
  const db = selectedDatabase || activeConnection?.database?.trim() || "0";

  const [databases, setDatabases] = useState<string[]>([]);
  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<RedisKeyMeta[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [reloadTick, setReloadTick] = useState(0);

  async function loadPage(reset: boolean) {
    if (!isRedis || !connectionId) return;
    setLoading(true);
    setError(null);
    try {
      const page = await redisScanKeys({
        connectionId,
        db,
        pattern,
        cursor: reset ? 0 : cursor,
        count: 200,
      });
      setKeys((prev) => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map((item) => item.key));
        const merged = [...base];
        for (const item of page.keys) {
          if (seen.has(item.key)) continue;
          seen.add(item.key);
          merged.push(item);
        }
        return merged;
      });
      setCursor(page.cursor);
      if (reset) {
        setSelectedKey(null);
        setChecked(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isRedis || !connectionId) return;
    let cancelled = false;
    void redisListDatabases(connectionId)
      .then((list) => {
        if (!cancelled) setDatabases(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, isRedis]);

  useEffect(() => {
    if (!isRedis || !connectionId) return;
    setKeys([]);
    setCursor(0);
    setSelectedKey(null);
    setChecked(new Set());
    void loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, db, isRedis, reloadTick]);

  function toggleCheck(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) => {
      if (keys.length > 0 && keys.every((item) => prev.has(item.key))) {
        return new Set();
      }
      return new Set(keys.map((item) => item.key));
    });
  }

  async function deleteChecked() {
    if (checked.size === 0) return;
    if (
      !window.confirm(
        `确定删除选中的 ${checked.size} 个键？此操作不可撤销。`,
      )
    ) {
      return;
    }
    try {
      await redisDeleteKeys({
        connectionId,
        db,
        keys: [...checked],
      });
      if (selectedKey && checked.has(selectedKey)) setSelectedKey(null);
      setChecked(new Set());
      await loadPage(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!activeConnection || !isRedis) {
    return (
      <div className="workspace-content">
        <h1>Redis</h1>
        <p>请先在左侧打开一个 Redis 连接，再选择数据库。</p>
      </div>
    );
  }

  const dbOptions = databases.length > 0 ? databases : [db];

  return (
    <div className="redis-workspace">
      <div className="redis-toolbar">
        <label className="redis-db-select">
          DB
          <select
            value={db}
            onChange={(e) =>
              openRedis({ connection: activeConnection, database: e.target.value })
            }
          >
            {dbOptions.map((item) => (
              <option key={item} value={item}>
                db{item}
              </option>
            ))}
          </select>
        </label>
        <input
          className="redis-pattern"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void loadPage(true);
          }}
          placeholder="匹配模式，如 user:*"
          spellCheck={false}
        />
        <button type="button" onClick={() => setReloadTick((tick) => tick + 1)}>
          刷新
        </button>
        <button
          type="button"
          className="redis-danger"
          disabled={checked.size === 0}
          onClick={() => void deleteChecked()}
        >
          删除选中{checked.size > 0 ? ` (${checked.size})` : ""}
        </button>
        <span className="redis-count">{keys.length} 个键</span>
      </div>

      {error && <div className="redis-error">{error}</div>}

      <div className="redis-body">
        <RedisKeyList
          keys={keys}
          selectedKey={selectedKey}
          checked={checked}
          loading={loading}
          cursor={cursor}
          onSelect={setSelectedKey}
          onToggleCheck={toggleCheck}
          onToggleAll={toggleAll}
          onLoadMore={() => void loadPage(false)}
        />
        <div className="redis-detail">
          {selectedKey ? (
            <RedisValuePanel
              connectionId={connectionId}
              db={db}
              redisKey={selectedKey}
              onChanged={() => setReloadTick((tick) => tick + 1)}
            />
          ) : (
            <div className="redis-empty">选择左侧键查看值</div>
          )}
        </div>
      </div>

      <RedisCommandConsole connectionId={connectionId} db={db} />
    </div>
  );
}
