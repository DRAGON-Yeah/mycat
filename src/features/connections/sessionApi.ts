import { invoke } from "@tauri-apps/api/core";

export type DbObject = {
  name: string;
  kind: string;
};

export type RowsPage = {
  columns: { name: string; dataType: string; nullable: boolean }[];
  rows: unknown[][];
  total: number;
  page: number;
  pageSize: number;
};

export function openConnection(connectionId: string) {
  return invoke<void>("open_connection", { connectionId });
}

export function closeConnection(connectionId: string) {
  return invoke<void>("close_connection", { connectionId });
}

export function listTables(connectionId: string) {
  return invoke<DbObject[]>("list_tables", { connectionId });
}

export function fetchTablePage(args: {
  connectionId: string;
  table: string;
  page: number;
  pageSize: number;
  sortCol?: string;
  sortDir?: string;
  filterCol?: string;
  filterValue?: string;
}) {
  return invoke<RowsPage>("fetch_table_page", args);
}

export function executeSql(connectionId: string, sql: string) {
  return invoke<{
    columns: string[];
    rows: unknown[][];
    rowsAffected: number;
    elapsedMs: number;
  }>("execute_sql", { connectionId, sql });
}

export type RowChange = {
  op: "update" | "insert" | "delete" | string;
  pkColumns: string[];
  pkValues: unknown[];
  columns: string[];
  values: unknown[];
};

export function applyRowChanges(args: {
  connectionId: string;
  table: string;
  changes: RowChange[];
}) {
  return invoke<number>("apply_row_changes", args);
}

export function dumpTableSql(args: {
  connectionId: string;
  table: string;
  includeData: boolean;
  engine: string;
}) {
  return invoke<string>("dump_table_sql", args);
}

export function writeLog(level: string, message: string) {
  return invoke<void>("write_log", { level, message });
}
