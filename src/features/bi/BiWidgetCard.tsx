import { useEffect, useState } from "react";
import { executeSql, openConnection } from "../connections/sessionApi";
import { ChartView, type ChartData } from "./charts";
import { chartTypeLabel, type BiWidget } from "./types";

type Props = {
  widget: BiWidget;
  refreshToken: number;
  onEdit: () => void;
  onDelete: () => void;
};

type LoadState = {
  loading: boolean;
  data: ChartData | null;
  error: string | null;
  elapsedMs: number;
};

export function BiWidgetCard({
  widget,
  refreshToken,
  onEdit,
  onDelete,
}: Props) {
  const [state, setState] = useState<LoadState>({
    loading: true,
    data: null,
    error: null,
    elapsedMs: 0,
  });
  const [localToken, setLocalToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const sql = widget.sql.trim();
    if (!sql) {
      setState({
        loading: false,
        data: null,
        error: "尚未配置 SQL",
        elapsedMs: 0,
      });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    void (async () => {
      try {
        await openConnection(widget.connectionId);
        const out = await executeSql(
          widget.connectionId,
          sql,
          widget.database || null,
        );
        if (cancelled) return;
        setState({
          loading: false,
          data: { columns: out.columns, rows: out.rows },
          error: null,
          elapsedMs: out.elapsedMs,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          data: null,
          error: err instanceof Error ? err.message : String(err),
          elapsedMs: 0,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    widget.id,
    widget.sql,
    widget.connectionId,
    widget.database,
    refreshToken,
    localToken,
  ]);

  const rows = state.data?.rows.length ?? 0;

  return (
    <section
      className={`bi-widget ${widget.span === 2 ? "is-wide" : ""}`}
      style={{ minHeight: widget.height + 62 }}
    >
      <header className="bi-widget-head">
        <span className="bi-widget-type">{chartTypeLabel(widget.type)}</span>
        <h3 title={widget.title}>{widget.title || "未命名图表"}</h3>
        <div className="bi-widget-actions">
          <button
            type="button"
            title="刷新"
            onClick={() => setLocalToken((v) => v + 1)}
          >
            ↻
          </button>
          <button type="button" title="编辑" onClick={onEdit}>
            编辑
          </button>
          <button
            type="button"
            title="删除"
            className="is-danger-text"
            onClick={onDelete}
          >
            ×
          </button>
        </div>
      </header>

      <div className="bi-widget-body">
        {state.loading && <p className="pane-placeholder">查询中…</p>}
        {!state.loading && state.error && (
          <p className="pane-error bi-widget-error">{state.error}</p>
        )}
        {!state.loading && !state.error && state.data && (
          <ChartView
            type={widget.type}
            data={state.data}
            categoryColumn={widget.categoryColumn}
            valueColumn={widget.valueColumn}
            height={widget.height}
          />
        )}
      </div>

      <footer className="bi-widget-foot">
        <span>
          {widget.database || "默认库"} · {rows} 行
        </span>
        <span>{state.elapsedMs > 0 ? `${state.elapsedMs} ms` : ""}</span>
      </footer>
    </section>
  );
}
