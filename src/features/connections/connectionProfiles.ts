import { getSetting, setSetting } from "../../lib/tauri";

export type ConnProfile = {
  id: string;
  name: string;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  user?: string | null;
};

function key(connectionId: string) {
  return `conn_profiles:${connectionId}`;
}

export async function listConnProfiles(
  connectionId: string,
): Promise<ConnProfile[]> {
  const raw = await getSetting(key(connectionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ConnProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveConnProfiles(
  connectionId: string,
  profiles: ConnProfile[],
): Promise<void> {
  await setSetting(key(connectionId), JSON.stringify(profiles));
}

export function newProfileId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
