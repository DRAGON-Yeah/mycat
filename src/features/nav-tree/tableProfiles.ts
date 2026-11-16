import { getSetting, setSetting } from "../../lib/tauri";

export type TableOpenProfile = {
  id: string;
  name: string;
  sortCol?: string;
  sortDir?: "ASC" | "DESC";
  filterCol?: string;
  filterValue?: string;
  pageSize?: number;
};

function key(connectionId: string, database: string, table: string) {
  return `table_profiles:${connectionId}:${database}:${table}`;
}

export async function listTableProfiles(
  connectionId: string,
  database: string,
  table: string,
): Promise<TableOpenProfile[]> {
  const raw = await getSetting(key(connectionId, database, table));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as TableOpenProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveTableProfiles(
  connectionId: string,
  database: string,
  table: string,
  profiles: TableOpenProfile[],
): Promise<void> {
  await setSetting(
    key(connectionId, database, table),
    JSON.stringify(profiles),
  );
}

export function newTableProfileId() {
  return `tp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
