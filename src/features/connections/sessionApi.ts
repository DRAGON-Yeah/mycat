import { invoke } from "../../lib/invoke";

export type DbObject = {
  name: string;
  kind: string;
  tableRows?: number | null;
  dataLength?: number | null;
  engine?: string | null;
  createTime?: string | null;
  updateTime?: string | null;
  collation?: string | null;
  comment?: string | null;
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

export function listDatabases(connectionId: string) {
  return invoke<string[]>("list_databases", { connectionId });
}

export function listTables(connectionId: string, database?: string) {
  return invoke<DbObject[]>("list_tables", {
    connectionId,
    database: database || null,
  });
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
  database?: string;
}) {
  return invoke<RowsPage>("fetch_table_page", args);
}

export function executeSql(
  connectionId: string,
  sql: string,
  database?: string | null,
) {
  return invoke<{
    columns: string[];
    rows: unknown[][];
    rowsAffected: number;
    elapsedMs: number;
  }>("execute_sql", {
    connectionId,
    sql,
    database: database?.trim() || null,
  });
}

export function cancelQuery(connectionId: string) {
  return invoke<void>("cancel_query", { connectionId });
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
  database?: string;
}) {
  return invoke<number>("apply_row_changes", args);
}

/** Engine-native DDL (MySQL SHOW CREATE / PG catalogs / SQLite sqlite_master). */
export function getTableDdl(args: {
  connectionId: string;
  table: string;
  database?: string;
}) {
  return invoke<string>("get_table_ddl", {
    connectionId: args.connectionId,
    table: args.table,
    database: args.database || null,
  });
}

export function dumpTableSql(args: {
  connectionId: string;
  table: string;
  includeData: boolean;
  engine: string;
  database?: string;
}) {
  return invoke<string>("dump_table_sql", args);
}

export function writeLog(level: string, message: string) {
  return invoke<void>("write_log", { level, message });
}
