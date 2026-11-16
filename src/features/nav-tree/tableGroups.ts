import { getSetting, setSetting } from "../../lib/tauri";

export type TableGroupState = {
  groups: string[];
  /** table name -> group name */
  membership: Record<string, string>;
};

function key(connectionId: string, database: string) {
  return `table_groups:${connectionId}:${database}`;
}

export async function loadTableGroups(
  connectionId: string,
  database: string,
): Promise<TableGroupState> {
  const raw = await getSetting(key(connectionId, database));
  if (!raw) return { groups: [], membership: {} };
  try {
    const parsed = JSON.parse(raw) as TableGroupState;
    return {
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      membership:
        parsed.membership && typeof parsed.membership === "object"
          ? parsed.membership
          : {},
    };
  } catch {
    return { groups: [], membership: {} };
  }
}

export async function saveTableGroups(
  connectionId: string,
  database: string,
  state: TableGroupState,
): Promise<void> {
  await setSetting(key(connectionId, database), JSON.stringify(state));
}
