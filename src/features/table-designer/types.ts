export type DesignerColumn = {
  key: string;
  name: string;
  rawType: string;
  nullable: boolean;
  isPk: boolean;
  defaultValue: string | null;
  comment?: string;
  /** Original name when loaded from DB; null for new columns. */
  originalName: string | null;
};

export function newColumn(partial?: Partial<DesignerColumn>): DesignerColumn {
  return {
    key: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "new_col",
    rawType: "varchar(255)",
    nullable: true,
    isPk: false,
    defaultValue: null,
    comment: "",
    originalName: null,
    ...partial,
  };
}
