import { create } from "zustand";
import type { ConnectionDto } from "../features/connections/types";

export type TableTab = {
  id: string;
  connectionId: string;
  connectionName: string;
  connectionEngine: string;
  table: string;
  dirty?: boolean;
};

type WorkspaceState = {
  activeConnectionId: string | null;
  activeConnection: ConnectionDto | null;
  tabs: TableTab[];
  activeTabId: string | null;
  openConnection: (conn: ConnectionDto) => void;
  clearConnection: () => void;
  openTable: (table: string) => void;
  closeTab: (id: string) => boolean;
  setActiveTab: (id: string) => void;
  markTabDirty: (id: string, dirty: boolean) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeConnectionId: null,
  activeConnection: null,
  tabs: [],
  activeTabId: null,
  openConnection: (conn) =>
    set({
      activeConnectionId: conn.id,
      activeConnection: conn,
    }),
  clearConnection: () =>
    set({
      activeConnectionId: null,
      activeConnection: null,
      tabs: [],
      activeTabId: null,
    }),
  openTable: (table) => {
    const { activeConnectionId, activeConnection, tabs } = get();
    if (!activeConnectionId || !activeConnection) return;
    const id = `${activeConnectionId}:${table}`;
    const exists = tabs.find((t) => t.id === id);
    if (exists) {
      set({ activeTabId: id });
      return;
    }
    set({
      tabs: [
        ...tabs,
        {
          id,
          connectionId: activeConnectionId,
          connectionName: activeConnection.name,
          connectionEngine: String(activeConnection.engine),
          table,
          dirty: false,
        },
      ],
      activeTabId: id,
    });
  },
  closeTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (tab?.dirty) {
      const ok = window.confirm(`「${tab.table}」有未保存更改，确定关闭？`);
      if (!ok) return false;
    }
    const tabs = get().tabs.filter((t) => t.id !== id);
    const activeTabId =
      get().activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : get().activeTabId;
    set({ tabs, activeTabId });
    return true;
  },
  setActiveTab: (id) => set({ activeTabId: id }),
  markTabDirty: (id, dirty) =>
    set({
      tabs: get().tabs.map((t) => (t.id === id ? { ...t, dirty } : t)),
    }),
}));
