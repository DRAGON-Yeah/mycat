import type { ConnectionDto, EngineType, UpsertConnectionInput } from "./types";

export const CONNECTION_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#38bdf8",
  "#a855f7",
  "#9ca3af",
  "#0969da",
] as const;

export function connectionToUpsert(
  conn: ConnectionDto,
  patch: Partial<UpsertConnectionInput> = {},
): UpsertConnectionInput {
  return {
    id: conn.id,
    name: conn.name,
    engine: (conn.engine as EngineType) || "mysql",
    host: conn.host ?? undefined,
    port: conn.port ?? undefined,
    database: conn.database ?? undefined,
    user: conn.user ?? undefined,
    sslMode: conn.sslMode,
    sslTrust: conn.sslTrust,
    sshEnabled: conn.sshEnabled,
    sshHost: conn.sshHost ?? undefined,
    sshPort: conn.sshPort ?? undefined,
    sshUser: conn.sshUser ?? undefined,
    color: conn.color ?? undefined,
    starred: conn.starred,
    groupName: conn.groupName ?? undefined,
    hidden: conn.hidden,
    ...patch,
  };
}

export function duplicateConnectionSeed(conn: ConnectionDto): ConnectionDto {
  return {
    ...conn,
    id: "",
    name: `${conn.name} 副本`,
    hasPassword: false,
    secretRef: undefined,
    createdAt: "",
    updatedAt: "",
  };
}
