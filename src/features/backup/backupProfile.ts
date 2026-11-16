export type BackupAdvancedOptions = {
  lockTables: boolean;
  singleTransaction: boolean;
  useCustomFileName: boolean;
  fileNameTemplate: string;
};

export type BackupProfile = {
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

function profileKey(connectionId: string, database: string) {
  return `backup_profile:${connectionId}:${database}`;
}

export function defaultBackupProfile(): BackupProfile {
  return {
    comment: "",
    selectedKeys: [],
    advanced: { ...DEFAULT_ADVANCED },
  };
}

export function loadBackupProfile(
  connectionId: string,
  database: string,
): BackupProfile {
  try {
    const raw = localStorage.getItem(profileKey(connectionId, database));
    if (!raw) return defaultBackupProfile();
    const parsed = JSON.parse(raw) as Partial<BackupProfile>;
    return {
      comment: parsed.comment ?? "",
      selectedKeys: Array.isArray(parsed.selectedKeys)
        ? parsed.selectedKeys
        : [],
      advanced: {
        ...DEFAULT_ADVANCED,
        ...(parsed.advanced ?? {}),
      },
    };
  } catch {
    return defaultBackupProfile();
  }
}

export function saveBackupProfile(
  connectionId: string,
  database: string,
  profile: BackupProfile,
) {
  localStorage.setItem(profileKey(connectionId, database), JSON.stringify(profile));
}
