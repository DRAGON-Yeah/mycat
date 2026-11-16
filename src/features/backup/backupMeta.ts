export type BackupMeta = {
  id: string;
  fileName: string;
  displayName: string;
  comment: string;
  createdAt: string;
  sizeBytes: number;
  connectionId: string;
  database: string;
  /** Absolute path if user extracted/saved to disk. */
  filePath?: string;
};

function indexKey(connectionId: string, database: string) {
  return `mycat_backups:${connectionId}:${database}`;
}

function sqlKey(connectionId: string, database: string, id: string) {
  return `mycat_backup_sql:${connectionId}:${database}:${id}`;
}

function readIndex(connectionId: string, database: string): BackupMeta[] {
  try {
    const raw = localStorage.getItem(indexKey(connectionId, database));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BackupMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(
  connectionId: string,
  database: string,
  items: BackupMeta[],
) {
  localStorage.setItem(indexKey(connectionId, database), JSON.stringify(items));
}

export async function listBackups(args: {
  connectionId: string;
  database: string;
}): Promise<BackupMeta[]> {
  const items = readIndex(args.connectionId, args.database);
  return items
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getBackupSql(args: {
  connectionId: string;
  database: string;
  id: string;
}): Promise<string> {
  return localStorage.getItem(sqlKey(args.connectionId, args.database, args.id)) ?? "";
}

export async function saveBackup(args: {
  connectionId: string;
  database: string;
  fileName: string;
  displayName?: string;
  comment: string;
  sql: string;
  filePath?: string;
}): Promise<BackupMeta> {
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const meta: BackupMeta = {
    id,
    fileName: args.fileName.endsWith(".sql")
      ? args.fileName
      : `${args.fileName}.sql`,
    displayName:
      args.displayName?.trim() ||
      args.fileName.replace(/\.sql$/i, ""),
    comment: args.comment,
    createdAt: new Date().toISOString(),
    sizeBytes: new TextEncoder().encode(args.sql).length,
    connectionId: args.connectionId,
    database: args.database,
    filePath: args.filePath,
  };
  localStorage.setItem(
    sqlKey(args.connectionId, args.database, id),
    args.sql,
  );
  const next = [meta, ...readIndex(args.connectionId, args.database)];
  writeIndex(args.connectionId, args.database, next);
  return meta;
}

export async function deleteBackup(args: {
  connectionId: string;
  database: string;
  id: string;
}): Promise<void> {
  localStorage.removeItem(sqlKey(args.connectionId, args.database, args.id));
  const next = readIndex(args.connectionId, args.database).filter(
    (b) => b.id !== args.id,
  );
  writeIndex(args.connectionId, args.database, next);
}

export async function duplicateBackup(args: {
  connectionId: string;
  database: string;
  id: string;
}): Promise<BackupMeta> {
  const src = readIndex(args.connectionId, args.database).find(
    (b) => b.id === args.id,
  );
  if (!src) throw new Error("备份不存在");
  const sql = await getBackupSql(args);
  const base = src.displayName.replace(/_copy(?:_\d+)?$/, "");
  const displayName = `${base}_copy`;
  const fileName = `${displayName}.sql`;
  return saveBackup({
    connectionId: args.connectionId,
    database: args.database,
    fileName,
    displayName,
    comment: src.comment,
    sql,
  });
}

export async function renameBackup(args: {
  connectionId: string;
  database: string;
  id: string;
  displayName: string;
}): Promise<BackupMeta> {
  const name = args.displayName.trim();
  if (!name) throw new Error("名称不能为空");
  if (/[\\/:*?"<>|]/.test(name)) {
    throw new Error("名称不能包含 \\ / : * ? \" < > |");
  }
  const items = readIndex(args.connectionId, args.database);
  const idx = items.findIndex((b) => b.id === args.id);
  if (idx < 0) throw new Error("备份不存在");
  const cur = items[idx]!;
  const updated: BackupMeta = {
    ...cur,
    displayName: name,
    fileName: name.toLowerCase().endsWith(".sql") ? name : `${name}.sql`,
  };
  items[idx] = updated;
  writeIndex(args.connectionId, args.database, items);
  return updated;
}

export function expandBackupFileName(
  template: string,
  now = new Date(),
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const map: Record<string, string> = {
    "%Y": String(now.getFullYear()),
    "%m": pad(now.getMonth() + 1),
    "%d": pad(now.getDate()),
    "%H": pad(now.getHours()),
    "%M": pad(now.getMinutes()),
    "%S": pad(now.getSeconds()),
  };
  let out = template.trim() || "备份_%Y%m%d%H%M%S";
  for (const [k, v] of Object.entries(map)) {
    out = out.split(k).join(v);
  }
  if (!out.toLowerCase().endsWith(".sql")) out = `${out}.sql`;
  return out;
}

export function formatBackupSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatBackupTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleString();
}
