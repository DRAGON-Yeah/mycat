/** Parse MySQL / Postgres EXPLAIN FORMAT=JSON into a simple visual tree. */

export type ExplainNode = {
  id: string;
  label: string;
  kind: "query_block" | "table" | "nested_loop" | "grouping" | "ordering" | "other";
  detail?: string;
  cost?: string;
  rows?: string;
  children: ExplainNode[];
};

export type ExplainStats = {
  queryCost?: string;
  estimatedRows?: string;
  accessType?: string;
  tables: string[];
  notes: string[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  return String(v);
}

let idSeq = 0;
function nid(prefix: string) {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

function tableNode(table: Record<string, unknown>): ExplainNode {
  const name = str(table.table_name) ?? str(table.table) ?? "table";
  const access = str(table.access_type) ?? str(table["Node Type"]);
  const rows =
    str(table.rows_examined_per_scan) ??
    str(table.rows) ??
    str(table["Plan Rows"]);
  const costInfo = asRecord(table.cost_info);
  const cost =
    str(costInfo?.read_cost) ??
    str(costInfo?.eval_cost) ??
    str(table["Total Cost"]);
  const parts = [access ? `type=${access}` : null, rows ? `rows=${rows}` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    id: nid("tbl"),
    label: name,
    kind: "table",
    detail: parts || undefined,
    cost,
    rows,
    children: [],
  };
}

function walkMysql(obj: unknown): ExplainNode | null {
  const root = asRecord(obj);
  if (!root) return null;

  const qb = asRecord(root.query_block) ?? root;
  const costInfo = asRecord(qb.cost_info);
  const node: ExplainNode = {
    id: nid("qb"),
    label: "query_block",
    kind: "query_block",
    cost: str(costInfo?.query_cost),
    children: [],
  };

  const table = asRecord(qb.table);
  if (table) node.children.push(tableNode(table));

  const nested = qb.nested_loop;
  if (Array.isArray(nested)) {
    const loop: ExplainNode = {
      id: nid("nl"),
      label: "nested_loop",
      kind: "nested_loop",
      children: [],
    };
    for (const item of nested) {
      const rec = asRecord(item);
      if (!rec) continue;
      const t = asRecord(rec.table);
      if (t) loop.children.push(tableNode(t));
      else {
        const child = walkMysql(rec);
        if (child) loop.children.push(...child.children, child);
      }
    }
    if (loop.children.length) node.children.push(loop);
  }

  const grouping = asRecord(qb.grouping_operation);
  if (grouping) {
    const g: ExplainNode = {
      id: nid("grp"),
      label: "grouping",
      kind: "grouping",
      children: [],
    };
    const t = asRecord(grouping.table);
    if (t) g.children.push(tableNode(t));
    const nl = grouping.nested_loop;
    if (Array.isArray(nl)) {
      for (const item of nl) {
        const rec = asRecord(item);
        const t2 = rec ? asRecord(rec.table) : null;
        if (t2) g.children.push(tableNode(t2));
      }
    }
    node.children.push(g);
  }

  const ordering = asRecord(qb.ordering_operation);
  if (ordering) {
    const o: ExplainNode = {
      id: nid("ord"),
      label: "ordering",
      kind: "ordering",
      children: [],
    };
    const t = asRecord(ordering.table);
    if (t) o.children.push(tableNode(t));
    node.children.push(o);
  }

  return node;
}

function walkPostgres(plan: Record<string, unknown>): ExplainNode {
  const nodeType = str(plan["Node Type"]) ?? "Plan";
  const rel = str(plan["Relation Name"]);
  const label = rel ?? nodeType;
  const kind: ExplainNode["kind"] =
    rel != null
      ? "table"
      : /Aggregate|Group/i.test(nodeType)
        ? "grouping"
        : /Sort/i.test(nodeType)
          ? "ordering"
          : /Nested Loop|Hash Join|Merge Join/i.test(nodeType)
            ? "nested_loop"
            : "other";
  const node: ExplainNode = {
    id: nid("pg"),
    label,
    kind,
    detail: rel ? nodeType : undefined,
    cost: str(plan["Total Cost"]),
    rows: str(plan["Plan Rows"]),
    children: [],
  };
  const plans = plan.Plans;
  if (Array.isArray(plans)) {
    for (const p of plans) {
      const rec = asRecord(p);
      if (rec) node.children.push(walkPostgres(rec));
    }
  }
  return node;
}

/** Extract first JSON object/array text from a cell or blob. */
export function extractJsonText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const start = trimmed.indexOf("{");
  if (start < 0) return null;
  return trimmed.slice(start);
}

export function parseExplainJson(raw: string): {
  tree: ExplainNode | null;
  pretty: string;
  stats: ExplainStats;
} {
  idSeq = 0;
  const text = extractJsonText(raw);
  if (!text) {
    return {
      tree: null,
      pretty: raw,
      stats: { tables: [], notes: ["无法解析为 JSON"] },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      tree: null,
      pretty: text,
      stats: { tables: [], notes: ["JSON 解析失败"] },
    };
  }

  let tree: ExplainNode | null = null;
  const stats: ExplainStats = { tables: [], notes: [] };

  // Postgres: [ { "Plan": {...} } ]
  if (Array.isArray(parsed) && parsed[0]) {
    const first = asRecord(parsed[0]);
    const plan = first ? asRecord(first.Plan) : null;
    if (plan) {
      tree = {
        id: nid("root"),
        label: "query_block",
        kind: "query_block",
        cost: str(plan["Total Cost"]),
        children: [walkPostgres(plan)],
      };
      stats.queryCost = str(plan["Total Cost"]);
      stats.estimatedRows = str(plan["Plan Rows"]);
    }
  } else {
    const root = asRecord(parsed);
    // Sometimes wrapped: { "EXPLAIN": "..." } already unwrapped by caller
    tree = walkMysql(parsed);
    const qb = root ? asRecord(root.query_block) : null;
    const costInfo = qb ? asRecord(qb.cost_info) : null;
    stats.queryCost = str(costInfo?.query_cost);
    const table = qb ? asRecord(qb.table) : null;
    if (table) {
      stats.accessType = str(table.access_type);
      stats.estimatedRows = str(table.rows_examined_per_scan);
    }
  }

  function collect(n: ExplainNode) {
    if (n.kind === "table") stats.tables.push(n.label);
    for (const c of n.children) collect(c);
  }
  if (tree) collect(tree);

  let pretty = text;
  try {
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    /* keep */
  }

  return { tree, pretty, stats };
}

/** Pull EXPLAIN JSON string from a query result row (MySQL / PG). */
export function jsonFromExplainResult(columns: string[], rows: unknown[][]): string | null {
  if (!rows.length) return null;
  const row = rows[0]!;
  const prefer = ["EXPLAIN", "QUERY PLAN", "QUERY PLAN", "json"];
  for (const name of prefer) {
    const idx = columns.findIndex(
      (c) => c.toUpperCase() === name.toUpperCase(),
    );
    if (idx >= 0 && row[idx] != null) {
      const t = extractJsonText(String(row[idx]));
      if (t) return t;
    }
  }
  // Single-cell fallback
  if (columns.length === 1 && row[0] != null) {
    return extractJsonText(String(row[0]));
  }
  // Any cell that looks like JSON
  for (const cell of row) {
    if (cell == null) continue;
    const t = extractJsonText(String(cell));
    if (t) return t;
  }
  return null;
}

export function wrapExplainSql(
  sql: string,
  engine: string,
  format: "json" | "traditional",
): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (/^\s*EXPLAIN\b/i.test(trimmed)) {
    // Already EXPLAIN — if asking JSON and not already FORMAT=JSON, rewrite lightly
    if (
      format === "json" &&
      !/FORMAT\s*=\s*JSON/i.test(trimmed) &&
      (engine === "mysql" || engine === "postgres")
    ) {
      if (engine === "postgres") {
        return trimmed.replace(/^\s*EXPLAIN\b/i, "EXPLAIN (FORMAT JSON)");
      }
      return trimmed.replace(/^\s*EXPLAIN\b/i, "EXPLAIN FORMAT=JSON");
    }
    return trimmed;
  }
  if (format === "json") {
    if (engine === "postgres") return `EXPLAIN (FORMAT JSON) ${trimmed}`;
    if (engine === "mysql") return `EXPLAIN FORMAT=JSON ${trimmed}`;
  }
  if (engine === "sqlite") return `EXPLAIN QUERY PLAN ${trimmed}`;
  return `EXPLAIN ${trimmed}`;
}
