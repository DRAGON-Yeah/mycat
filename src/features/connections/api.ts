import { invoke } from "../../lib/invoke";
import type { ConnectionDto, UpsertConnectionInput } from "./types";

export function listConnections() {
  return invoke<ConnectionDto[]>("list_connections");
}

export function upsertConnection(input: UpsertConnectionInput) {
  return invoke<ConnectionDto>("upsert_connection", { input });
}

export function deleteConnection(id: string) {
  return invoke<void>("delete_connection", { id });
}

export type ConnectionSecretsDto = {
  password?: string | null;
  sshPassword?: string | null;
};

export function getConnectionSecrets(id: string) {
  return invoke<ConnectionSecretsDto>("get_connection_secrets", { id });
}

export type ConnectionExportItem = {
  name: string;
  engine: string;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  user?: string | null;
  sslMode: string;
  sshEnabled: boolean;
  sshHost?: string | null;
  sshPort?: number | null;
  sshUser?: string | null;
  color?: string | null;
  starred: boolean;
  groupName?: string | null;
  hidden: boolean;
  password?: string | null;
};

export function exportConnections() {
  return invoke<ConnectionExportItem[]>("export_connections");
}

export function importConnections(items: ConnectionExportItem[]) {
  return invoke<number>("import_connections", { items });
}
