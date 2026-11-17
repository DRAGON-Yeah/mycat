export type DesignerColumn = {
  key: string;
  name: string;
  /** Base type without length, e.g. varchar / bigint */
  typeName: string;
  length: string;
  decimals: string;
  /** NOT NULL when true (UI: 不是 Null) */
  notNull: boolean;
  virtual: boolean;
  isPk: boolean;
  defaultValue: string | null;
  comment: string;
  /** Original name when loaded from DB; null for new columns. */
  originalName: string | null;
  /** Auto increment / on update etc. raw EXTRA */
  extra: string;
};

/** @deprecated use composedType; kept for ddl migration helpers */
export function composedType(c: DesignerColumn): string {
  const t = c.typeName.trim().toLowerCase() || "varchar";
  const len = c.length.trim();
  const dec = c.decimals.trim();
  if (
    ["varchar", "char", "binary", "varbinary"].includes(t) &&
    len
  ) {
    return `${t}(${len})`;
  }
  if (
    ["decimal", "numeric", "float", "double"].includes(t) &&
    len
  ) {
    return dec ? `${t}(${len},${dec})` : `${t}(${len})`;
  }
  if (["bit"].includes(t) && len) return `${t}(${len})`;
  return t;
}

export function parseRawType(raw: string): {
  typeName: string;
  length: string;
  decimals: string;
} {
  const s = raw.trim();
  const m = s.match(/^([a-zA-Z]+)(?:\((\d+)(?:\s*,\s*(\d+))?\))?/);
  if (!m) return { typeName: s || "varchar", length: "", decimals: "" };
  return {
    typeName: (m[1] || "varchar").toLowerCase(),
    length: m[2] || "",
    decimals: m[3] || "",
  };
}

export function newColumn(partial?: Partial<DesignerColumn>): DesignerColumn {
  return {
    key: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "new_col",
    typeName: "varchar",
    length: "255",
    decimals: "",
    notNull: false,
    virtual: false,
    isPk: false,
    defaultValue: null,
    comment: "",
    originalName: null,
    extra: "",
    ...partial,
  };
}

export type DesignerIndex = {
  key: string;
  name: string;
  columns: string;
  unique: boolean;
  indexType: string;
  originalName: string | null;
};

export type DesignerForeignKey = {
  key: string;
  name: string;
  columns: string;
  refTable: string;
  refColumns: string;
  onDelete: string;
  onUpdate: string;
  originalName: string | null;
};

export type DesignerTrigger = {
  key: string;
  name: string;
  timing: string;
  event: string;
  statement: string;
  originalName: string | null;
};

export type DesignerCheck = {
  key: string;
  name: string;
  expression: string;
  originalName: string | null;
};

export type TableOptions = {
  engine: string;
  charset: string;
  collation: string;
  rowFormat: string;
  autoIncrement: string;
  comment: string;
  avgRowLength: string;
};

export type TableInfoStats = {
  tableRows: string;
  dataLength: string;
  indexLength: string;
  createTime: string;
  updateTime: string;
};

export const MYSQL_TYPES = [
  "bigint",
  "int",
  "mediumint",
  "smallint",
  "tinyint",
  "decimal",
  "float",
  "double",
  "bit",
  "varchar",
  "char",
  "text",
  "tinytext",
  "mediumtext",
  "longtext",
  "blob",
  "tinyblob",
  "mediumblob",
  "longblob",
  "json",
  "date",
  "datetime",
  "timestamp",
  "time",
  "year",
  "enum",
  "set",
  "binary",
  "varbinary",
];

/** SQLite storage classes + the common declared types (any name is accepted). */
export const SQLITE_TYPES = [
  "integer",
  "text",
  "real",
  "blob",
  "numeric",
  "varchar",
  "char",
  "boolean",
  "decimal",
  "date",
  "datetime",
];

export function emptyOptions(): TableOptions {
  return {
    engine: "InnoDB",
    charset: "utf8mb4",
    collation: "utf8mb4_unicode_ci",
    rowFormat: "Dynamic",
    autoIncrement: "",
    comment: "",
    avgRowLength: "",
  };
}
