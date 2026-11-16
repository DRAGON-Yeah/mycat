export type BackupAdvancedOptions = {
  lockTables: boolean;
  singleTransaction: boolean;
  useCustomFileName: boolean;
  fileNameTemplate: string;
};

export type BackupProfile = {
  name: string;
  comment: string;
  /** Keys like `table:name`, `view:name`, `function:name`, `event:name` */
  selectedKeys: string[];
  advanced: BackupAdvancedOptions;
};

const DEFAULT_ADVANCED: BackupAdvancedOptions = {
  lockTables: false,
  singleTransaction: false,
  useCustomFileName: true,
  fileNameTemplate: "备份_%Y%m%d%H%M%S",
};

function storeKey(connectionId: string, database: string) {
  return `backup_profiles:${connectionId}:${database}`;
}

type ProfileStore = {
  currentName: string | null;
  profiles: Record<string, BackupProfile>;
};

function readStore(connectionId: string, database: string): ProfileStore {
  try {
    const raw = localStorage.getItem(storeKey(connectionId, database));
    if (!raw) {
      // migrate legacy single-profile key if present
      const legacy = localStorage.getItem(
        `backup_profile:${connectionId}:${database}`,
      );
      if (legacy) {
        const parsed = JSON.parse(legacy) as Partial<BackupProfile>;
        const name = "默认";
        const profile: BackupProfile = {
          name,
          comment: parsed.comment ?? "",
          selectedKeys: Array.isArray(parsed.selectedKeys)
            ? parsed.selectedKeys
            : [],
          advanced: { ...DEFAULT_ADVANCED, ...(parsed.advanced ?? {}) },
        };
        return { currentName: name, profiles: { [name]: profile } };
      }
      return { currentName: null, profiles: {} };
    }
    const parsed = JSON.parse(raw) as ProfileStore;
    return {
      currentName: parsed.currentName ?? null,
      profiles: parsed.profiles ?? {},
    };
  } catch {
    return { currentName: null, profiles: {} };
  }
}

function writeStore(
  connectionId: string,
  database: string,
  store: ProfileStore,
) {
  localStorage.setItem(storeKey(connectionId, database), JSON.stringify(store));
}

export function defaultBackupProfile(name = ""): BackupProfile {
  return {
    name,
    comment: "",
    selectedKeys: [],
    advanced: { ...DEFAULT_ADVANCED },
  };
}

export function loadBackupProfile(
  connectionId: string,
  database: string,
): BackupProfile {
  const store = readStore(connectionId, database);
  if (store.currentName && store.profiles[store.currentName]) {
    return { ...store.profiles[store.currentName]! };
  }
  const first = Object.values(store.profiles)[0];
  return first ? { ...first } : defaultBackupProfile();
}

export function getCurrentProfileName(
  connectionId: string,
  database: string,
): string | null {
  return readStore(connectionId, database).currentName;
}

/** 保存到当前配置名；若尚无当前名则返回 false，调用方应走另存为。 */
export function saveBackupProfile(
  connectionId: string,
  database: string,
  profile: Omit<BackupProfile, "name"> & { name?: string },
): { ok: true; name: string } | { ok: false; reason: "need-name" } {
  const store = readStore(connectionId, database);
  const name = (profile.name ?? store.currentName)?.trim();
  if (!name) return { ok: false, reason: "need-name" };
  const next: BackupProfile = {
    name,
    comment: profile.comment,
    selectedKeys: profile.selectedKeys,
    advanced: profile.advanced,
  };
  store.profiles[name] = next;
  store.currentName = name;
  writeStore(connectionId, database, store);
  return { ok: true, name };
}

/** 另存为：用新名称写入并设为当前。 */
export function saveBackupProfileAs(
  connectionId: string,
  database: string,
  name: string,
  profile: Omit<BackupProfile, "name">,
): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("配置文件名称不能为空");
  const store = readStore(connectionId, database);
  store.profiles[trimmed] = {
    name: trimmed,
    comment: profile.comment,
    selectedKeys: profile.selectedKeys,
    advanced: profile.advanced,
  };
  store.currentName = trimmed;
  writeStore(connectionId, database, store);
  return trimmed;
}
