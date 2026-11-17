import { newId, nowIso } from "../../lib/localDocs";

export type ModelColumn = {
  name: string;
  type: string;
  pk: boolean;
  notNull: boolean;
  comment?: string;
};

export type ModelTable = {
  id: string;
  name: string;
  x: number;
  y: number;
  columns: ModelColumn[];
};

export type ModelLink = {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
};

export type DataModel = {
  id: string;
  name: string;
  connectionId: string;
  connectionName: string;
  database: string;
  tables: ModelTable[];
  links: ModelLink[];
  createdAt: string;
  updatedAt: string;
};

export const MODEL_TABLE_WIDTH = 210;
export const MODEL_HEADER_HEIGHT = 30;
export const MODEL_ROW_HEIGHT = 20;
export const MODEL_TABLE_PADDING = 8;

export function modelTableHeight(table: ModelTable): number {
  return (
    MODEL_HEADER_HEIGHT +
    MODEL_TABLE_PADDING +
    Math.max(1, table.columns.length) * MODEL_ROW_HEIGHT
  );
}

export function newModel(args: {
  name: string;
  connectionId: string;
  connectionName: string;
  database: string;
}): DataModel {
  const at = nowIso();
  return {
    id: newId("model"),
    name: args.name,
    connectionId: args.connectionId,
    connectionName: args.connectionName,
    database: args.database,
    tables: [],
    links: [],
    createdAt: at,
    updatedAt: at,
  };
}

export function newModelTable(args: {
  name: string;
  columns: ModelColumn[];
  x: number;
  y: number;
}): ModelTable {
  return {
    id: newId("mt"),
    name: args.name,
    x: args.x,
    y: args.y,
    columns: args.columns,
  };
}
