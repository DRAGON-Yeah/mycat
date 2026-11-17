import {
  loadDesignerColumns,
  loadDesignerForeignKeys,
} from "../table-designer/loadColumns";
import {
  MODEL_TABLE_WIDTH,
  modelTableHeight,
  newModelTable,
  type ModelLink,
  type ModelTable,
} from "./types";

const LAYOUT_COLS = 3;
const GAP_X = 80;
const GAP_Y = 60;

function typeLabel(c: {
  typeName: string;
  length: string;
  decimals: string;
}): string {
  const base = c.typeName || "varchar";
  if (!c.length) return base;
  return c.decimals ? `${base}(${c.length},${c.decimals})` : `${base}(${c.length})`;
}

/**
 * 从数据库读取表结构（列 + 外键），生成模型实体与关系连线。
 * 新表会排布在已有实体下方，避免重叠。
 */
export async function buildModelTables(args: {
  connectionId: string;
  engine: string;
  database: string;
  tableNames: string[];
  existing?: ModelTable[];
  existingLinks?: ModelLink[];
}): Promise<{ tables: ModelTable[]; links: ModelLink[] }> {
  const existing = args.existing ?? [];
  const existingNames = new Set(existing.map((t) => t.name));
  const created: ModelTable[] = [];
  const fkSeeds: {
    table: string;
    column: string;
    refTable: string;
    refColumn: string;
  }[] = [];

  let startY = 40;
  for (const t of existing) {
    startY = Math.max(startY, t.y + modelTableHeight(t) + GAP_Y);
  }

  let idx = 0;
  for (const name of args.tableNames) {
    if (existingNames.has(name)) continue;
    const [cols, fks] = await Promise.all([
      loadDesignerColumns({
        connectionId: args.connectionId,
        engine: args.engine,
        database: args.database,
        table: name,
      }),
      loadDesignerForeignKeys({
        connectionId: args.connectionId,
        engine: args.engine,
        database: args.database,
        table: name,
      }),
    ]);
    created.push(
      newModelTable({
        name,
        columns: cols.map((c) => ({
          name: c.name,
          type: typeLabel(c),
          pk: c.isPk,
          notNull: c.notNull,
          comment: c.comment,
        })),
        x: 40 + (idx % LAYOUT_COLS) * (MODEL_TABLE_WIDTH + GAP_X),
        y: startY + Math.floor(idx / LAYOUT_COLS) * 300,
      }),
    );
    idx += 1;
    for (const fk of fks) {
      const refTable = fk.refTable.split(".").pop() ?? fk.refTable;
      fkSeeds.push({
        table: name,
        column: fk.columns.split(",")[0]?.trim() ?? "",
        refTable,
        refColumn: fk.refColumns.split(",")[0]?.trim() ?? "",
      });
    }
  }

  const allTables = [...existing, ...created];
  const byName = new Map(allTables.map((t) => [t.name, t]));
  const links: ModelLink[] = [...(args.existingLinks ?? [])];
  for (const seed of fkSeeds) {
    const from = byName.get(seed.table);
    const to = byName.get(seed.refTable);
    if (!from || !to || !seed.column || !seed.refColumn) continue;
    const id = `${from.id}:${seed.column}->${to.id}:${seed.refColumn}`;
    if (links.some((l) => l.id === id)) continue;
    links.push({
      id,
      fromTable: from.id,
      fromColumn: seed.column,
      toTable: to.id,
      toColumn: seed.refColumn,
    });
  }

  return { tables: created, links };
}
