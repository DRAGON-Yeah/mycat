import { invoke } from "../../lib/invoke";

export type SavedQueryDto = {
  id: string;
  connectionId: string;
  database?: string | null;
  name: string;
  sql: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertSavedQueryInput = {
  id?: string;
  connectionId: string;
  database?: string | null;
  name: string;
  sql: string;
};

export function listSavedQueries(connectionId: string, database?: string | null) {
  return invoke<SavedQueryDto[]>("list_saved_queries", {
    connectionId,
    database: database?.trim() || null,
  });
}

export function upsertSavedQuery(input: UpsertSavedQueryInput) {
  return invoke<SavedQueryDto>("upsert_saved_query", { input });
}

export function deleteSavedQuery(id: string) {
  return invoke<void>("delete_saved_query", { id });
}

export function getSavedQuery(id: string) {
  return invoke<SavedQueryDto | null>("get_saved_query", { id });
}
