import { invoke } from "../../lib/invoke";

export type RedisKeyMeta = {
  key: string;
  kind: string;
  /** -1 = 永久，-2 = 键不存在 */
  ttl: number;
  size: number | null;
};

export type RedisKeyPage = {
  cursor: number;
  keys: RedisKeyMeta[];
  scanned: number;
};

export type RedisKeyValue = {
  key: string;
  kind: string;
  ttl: number;
  size: number | null;
  truncated: boolean;
  value: unknown;
};

export type RedisReply = {
  /** status | integer | bulk | array | nil | error */
  kind: string;
  text: string;
  value: unknown;
  truncated: boolean;
};

export function redisListDatabases(connectionId: string) {
  return invoke<string[]>("redis_list_databases", { connectionId });
}

export function redisScanKeys(args: {
  connectionId: string;
  db: string;
  pattern: string;
  cursor: number;
  count?: number;
}) {
  return invoke<RedisKeyPage>("redis_scan_keys", {
    connectionId: args.connectionId,
    db: args.db,
    pattern: args.pattern,
    cursor: args.cursor,
    count: args.count ?? 200,
  });
}

export function redisKeyDetail(args: {
  connectionId: string;
  db: string;
  key: string;
}) {
  return invoke<RedisKeyValue>("redis_key_detail", args);
}

export function redisSetString(args: {
  connectionId: string;
  db: string;
  key: string;
  value: string;
  ttl?: number | null;
}) {
  return invoke<void>("redis_set_string", {
    connectionId: args.connectionId,
    db: args.db,
    key: args.key,
    value: args.value,
    ttl: args.ttl ?? null,
  });
}

export function redisHashSet(args: {
  connectionId: string;
  db: string;
  key: string;
  field: string;
  value: string;
}) {
  return invoke<void>("redis_hash_set", args);
}

export function redisHashDelete(args: {
  connectionId: string;
  db: string;
  key: string;
  fields: string[];
}) {
  return invoke<number>("redis_hash_delete", args);
}

export function redisDeleteKeys(args: {
  connectionId: string;
  db: string;
  keys: string[];
}) {
  return invoke<number>("redis_delete_keys", args);
}

export function redisExpire(args: {
  connectionId: string;
  db: string;
  key: string;
  ttlSecs?: number | null;
}) {
  return invoke<boolean>("redis_expire", {
    connectionId: args.connectionId,
    db: args.db,
    key: args.key,
    ttlSecs: args.ttlSecs ?? null,
  });
}

export function redisExecute(args: {
  connectionId: string;
  db: string;
  command: string;
}) {
  return invoke<RedisReply>("redis_execute", args);
}
