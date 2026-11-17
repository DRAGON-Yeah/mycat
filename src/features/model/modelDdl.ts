import type { DataModel, ModelTable } from "./types";

function quote(engine: string, name: string): string {
  if (/postgres|pg/i.test(engine)) return `"${name.replace(/"/g, '""')}"`;
  if (/sqlite/i.test(engine)) return `"${name.replace(/"/g, '""')}"`;
  return `\`${name.replace(/`/g, "``")}\``;
}

function columnLine(engine: string, table: ModelTable): string[] {
  const pk = table.columns.filter((c) => c.pk).map((c) => c.name);
  const lines = table.columns.map((c) => {
    const parts = [`  ${quote(engine, c.name)} ${c.type || "varchar(255)"}`];
    if (c.notNull || c.pk) parts.push("NOT NULL");
    return parts.join(" ");
  });
  if (pk.length > 0) {
    lines.push(
      `  PRIMARY KEY (${pk.map((n) => quote(engine, n)).join(", ")})`,
    );
  }
  return lines;
}

/** 依据模型生成建表 SQL（含外键）。 */
export function modelToSql(model: DataModel, engine = "mysql"): string {
  const blocks: string[] = [];
  blocks.push(`-- 模型：${model.name}`);
  blocks.push(`-- 数据库：${model.database || "—"}`);
  blocks.push(`-- 生成时间：${new Date().toLocaleString()}`);
  blocks.push("");

  for (const table of model.tables) {
    const lines = columnLine(engine, table);
    if (lines.length === 0) {
      blocks.push(`-- 表 ${table.name} 无列信息，已跳过`);
      blocks.push("");
      continue;
    }
    blocks.push(
      `CREATE TABLE ${quote(engine, table.name)} (\n${lines.join(",\n")}\n);`,
    );
    blocks.push("");
  }

  for (const link of model.links) {
    const from = model.tables.find((t) => t.id === link.fromTable);
    const to = model.tables.find((t) => t.id === link.toTable);
    if (!from || !to) continue;
    const name = `fk_${from.name}_${link.fromColumn}`.replace(
      /[^\w]/g,
      "_",
    );
    blocks.push(
      `ALTER TABLE ${quote(engine, from.name)} ADD CONSTRAINT ${quote(engine, name)} ` +
        `FOREIGN KEY (${quote(engine, link.fromColumn)}) ` +
        `REFERENCES ${quote(engine, to.name)} (${quote(engine, link.toColumn)});`,
    );
  }

  return blocks.join("\n");
}
