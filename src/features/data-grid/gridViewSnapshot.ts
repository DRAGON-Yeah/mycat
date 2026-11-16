import type { TableOpenOptions } from "../../stores/workspaceStore";

const snapshots = new Map<string, TableOpenOptions>();

export function setGridViewSnapshot(tabId: string, opts: TableOpenOptions) {
  snapshots.set(tabId, { ...opts });
}

export function getGridViewSnapshot(tabId: string): TableOpenOptions | null {
  return snapshots.get(tabId) ?? null;
}

export function clearGridViewSnapshot(tabId: string) {
  snapshots.delete(tabId);
}
