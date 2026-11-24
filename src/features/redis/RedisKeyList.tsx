import type { RedisKeyMeta } from "./redisApi";

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
  keys: RedisKeyMeta[];
  selectedKey: string | null;
  checked: Set<string>;
  loading: boolean;
  cursor: number;
  onSelect: (key: string) => void;
  onToggleCheck: (key: string) => void;
  onToggleAll: () => void;
  onLoadMore: () => void;
};

export function RedisKeyList({
  keys,
  selectedKey,
  checked,
  loading,
  cursor,
  onSelect,
  onToggleCheck,
  onToggleAll,
  onLoadMore,
}: Props) {
  const allChecked = keys.length > 0 && keys.every((item) => checked.has(item.key));

  return (
    <div className="redis-key-list">
      <div className="redis-key-head">
        <label className="redis-check">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={onToggleAll}
            aria-label="全选"
          />
        </label>
        <span>键</span>
        <span>类型</span>
        <span>TTL</span>
        <span>大小</span>
      </div>

      <div className="redis-key-rows">
        {keys.map((item) => (
          <div
            key={item.key}
            className={`redis-key-row ${selectedKey === item.key ? "is-active" : ""}`}
            onClick={() => onSelect(item.key)}
            title={item.key}
          >
            <label className="redis-check" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={checked.has(item.key)}
                onChange={() => onToggleCheck(item.key)}
                aria-label={`选择 ${item.key}`}
              />
            </label>
            <span className="redis-key-name">{item.key}</span>
            <span className={`redis-kind redis-kind-${item.kind}`}>
              {item.kind}
            </span>
            <span className="redis-key-meta">{formatTtl(item.ttl)}</span>
            <span className="redis-key-meta">{formatSize(item.size)}</span>
          </div>
        ))}
        {keys.length === 0 && !loading && (
          <div className="redis-empty">没有匹配的键</div>
        )}
        {loading && <div className="redis-empty">加载中…</div>}
      </div>

      <div className="redis-key-foot">
        <span>已加载 {keys.length} 个</span>
        {cursor !== 0 && (
          <button type="button" onClick={onLoadMore} disabled={loading}>
            加载更多
          </button>
        )}
      </div>
    </div>
  );
}
