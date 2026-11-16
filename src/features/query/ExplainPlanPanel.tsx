import { useEffect, useMemo, useState } from "react";
import {
  parseExplainJson,
  type ExplainNode,
  type ExplainStats,
} from "./explainPlan";
import { QueryResultGrid, type QueryResultData } from "./QueryResultGrid";

type SubTab = "visual" | "json" | "grid" | "stats" | "info";

type Props = {
  /** Pretty / raw EXPLAIN JSON text when available. */
  explainJson?: string | null;
  /** Traditional EXPLAIN tabular result. */
  gridResult?: QueryResultData | null;
  sql: string;
  elapsedMs?: number;
  tableHint?: string;
};

function PlanNodeView({
  node,
  depth,
}: {
  node: ExplainNode;
  depth: number;
}) {
  return (
    <div className={`exp-node-wrap depth-${Math.min(depth, 4)}`}>
      <div className={`exp-node exp-node-${node.kind}`}>
        <div className="exp-node-icon" aria-hidden>
          {node.kind === "table" ? "▤" : "▣"}
        </div>
        <div className="exp-node-body">
          <div
            className={`exp-node-label ${node.kind === "table" ? "is-table" : ""}`}
          >
            {node.label}
          </div>
          {node.detail && <div className="exp-node-detail">{node.detail}</div>}
          {(node.cost || node.rows) && (
            <div className="exp-node-meta">
              {node.cost ? `cost ${node.cost}` : ""}
              {node.cost && node.rows ? " · " : ""}
              {node.rows ? `rows ${node.rows}` : ""}
            </div>
          )}
        </div>
      </div>
      {node.children.length > 0 && (
        <div className="exp-children">
          {node.children.map((c) => (
            <div key={c.id} className="exp-edge">
              <div className="exp-arrow" aria-hidden />
              <PlanNodeView node={c} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatsView({ stats, elapsedMs }: { stats: ExplainStats; elapsedMs?: number }) {
  return (
    <div className="exp-stats">
      <dl>
        <div>
          <dt>估算代价</dt>
          <dd>{stats.queryCost ?? "—"}</dd>
        </div>
        <div>
          <dt>估算行数</dt>
          <dd>{stats.estimatedRows ?? "—"}</dd>
        </div>
        <div>
          <dt>访问类型</dt>
          <dd>{stats.accessType ?? "—"}</dd>
        </div>
        <div>
          <dt>涉及表</dt>
          <dd>{stats.tables.length ? stats.tables.join(", ") : "—"}</dd>
        </div>
        <div>
          <dt>实际耗时</dt>
          <dd>{elapsedMs != null ? `${elapsedMs} ms` : "—"}</dd>
        </div>
      </dl>
      {stats.notes.length > 0 && (
        <ul className="exp-notes">
          {stats.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ExplainPlanPanel({
  explainJson,
  gridResult,
  sql,
  elapsedMs,
  tableHint,
}: Props) {
  const parsed = useMemo(
    () => (explainJson ? parseExplainJson(explainJson) : null),
    [explainJson],
  );

  const hasJson = Boolean(parsed?.pretty);
  const hasGrid = Boolean(gridResult && gridResult.columns.length > 0);
  const hasVisual = Boolean(parsed?.tree);

  const [sub, setSub] = useState<SubTab>("visual");

  useEffect(() => {
    if (hasVisual) setSub("visual");
    else if (hasJson) setSub("json");
    else if (hasGrid) setSub("grid");
    else setSub("info");
  }, [hasVisual, hasJson, hasGrid, explainJson, gridResult]);

  return (
    <div className="exp-panel">
      <div className="exp-subtabs" role="tablist">
        <button
          type="button"
          className={sub === "visual" ? "is-active" : ""}
          onClick={() => setSub("visual")}
          disabled={!hasVisual}
        >
          可视化
        </button>
        <button
          type="button"
          className={sub === "json" ? "is-active" : ""}
          onClick={() => setSub("json")}
          disabled={!hasJson}
        >
          JSON
        </button>
        <button
          type="button"
          className={sub === "grid" ? "is-active" : ""}
          onClick={() => setSub("grid")}
          disabled={!hasGrid}
        >
          网格
        </button>
        <button
          type="button"
          className={sub === "stats" ? "is-active" : ""}
          onClick={() => setSub("stats")}
        >
          统计信息
        </button>
        <button
          type="button"
          className={sub === "info" ? "is-active" : ""}
          onClick={() => setSub("info")}
        >
          信息
        </button>
      </div>

      <div className="exp-body">
        {sub === "visual" && (
          <div className="exp-visual">
            {parsed?.tree ? (
              <PlanNodeView node={parsed.tree} depth={0} />
            ) : (
              <p className="is-muted">当前引擎未返回可可视化的计划树。</p>
            )}
          </div>
        )}

        {sub === "json" && (
          <pre className="exp-json">{parsed?.pretty ?? "（无 JSON）"}</pre>
        )}

        {sub === "grid" && gridResult && (
          <QueryResultGrid
            result={gridResult}
            tableHint={tableHint}
            embedded
          />
        )}

        {sub === "stats" && (
          <StatsView
            stats={
              parsed?.stats ?? {
                tables: [],
                notes: hasGrid ? ["见「网格」页查看传统 EXPLAIN 行"] : [],
              }
            }
            elapsedMs={elapsedMs}
          />
        )}

        {sub === "info" && (
          <div className="exp-info">
            <dl>
              <div>
                <dt>语句</dt>
                <dd>
                  <code>{sql}</code>
                </dd>
              </div>
              <div>
                <dt>耗时</dt>
                <dd>{elapsedMs != null ? `${elapsedMs} ms` : "—"}</dd>
              </div>
              <div>
                <dt>JSON</dt>
                <dd>{hasJson ? "已获取" : "无"}</dd>
              </div>
              <div>
                <dt>表格计划</dt>
                <dd>
                  {hasGrid
                    ? `${gridResult!.rows.length} 行 · ${gridResult!.columns.length} 列`
                    : "无"}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
