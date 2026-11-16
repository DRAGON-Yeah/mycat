import { useEffect, useMemo, useState } from "react";
import { fetchTablePage, openConnection } from "../connections/sessionApi";

type Props = {
  connectionId: string;
  database: string;
  table: string;
  onClose: () => void;
  onMessage: (msg: string) => void;
};

type ChartKind = "bar" | "pie";

function isNumeric(v: unknown): boolean {
  if (typeof v === "number" && Number.isFinite(v)) return true;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return true;
  }
  return false;
}

function toNum(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

export function SimpleChartDialog({
  connectionId,
  database,
  table,
  onClose,
  onMessage,
}: Props) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [labelCol, setLabelCol] = useState("");
  const [valueCol, setValueCol] = useState("");
  const [kind, setKind] = useState<ChartKind>("bar");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await openConnection(connectionId);
        const page = await fetchTablePage({
          connectionId,
          table,
          page: 1,
          pageSize: 200,
          database,
        });
        if (cancelled) return;
        const cols = page.columns.map((c) => c.name);
        setColumns(cols);
        setRows(page.rows);
        const numericIdx = page.columns.findIndex((c) =>
          /int|decimal|numeric|float|double|real|number/i.test(c.dataType),
        );
        const label =
          cols.find((_, i) => i !== numericIdx) ?? cols[0] ?? "";
        const value =
          (numericIdx >= 0 ? cols[numericIdx] : cols[1]) ?? cols[0] ?? "";
        setLabelCol(label);
        setValueCol(value);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, database, table]);

  const series = useMemo(() => {
    const li = columns.indexOf(labelCol);
    const vi = columns.indexOf(valueCol);
    if (li < 0 || vi < 0) return [];
    const agg = new Map<string, number>();
    for (const row of rows) {
      const label = String(row[li] ?? "(空)");
      const raw = row[vi];
      if (!isNumeric(raw)) continue;
      agg.set(label, (agg.get(label) ?? 0) + toNum(raw));
    }
    return [...agg.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 24);
  }, [columns, rows, labelCol, valueCol]);

  const max = Math.max(1, ...series.map((s) => s.value));
  const total = series.reduce((s, x) => s + x.value, 0) || 1;
  const colors = [
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#06b6d4",
    "#84cc16",
    "#f97316",
  ];

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal simple-chart-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>简易图表 · {table}</h2>
        {error && <p className="pane-error">{error}</p>}
        {busy ? (
          <p>加载数据…</p>
        ) : (
          <>
            <div className="simple-chart-controls">
              <label>
                分类列
                <select
                  value={labelCol}
                  onChange={(e) => setLabelCol(e.target.value)}
                >
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                数值列
                <select
                  value={valueCol}
                  onChange={(e) => setValueCol(e.target.value)}
                >
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                类型
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ChartKind)}
                >
                  <option value="bar">柱状图</option>
                  <option value="pie">饼图</option>
                </select>
              </label>
            </div>

            {series.length === 0 ? (
              <p className="table-io-meta">无可用数值数据（最多取前 200 行聚合）</p>
            ) : kind === "bar" ? (
              <div className="simple-chart-bars">
                {series.map((s, i) => (
                  <div key={s.label} className="simple-chart-bar-row">
                    <span className="simple-chart-label" title={s.label}>
                      {s.label}
                    </span>
                    <div className="simple-chart-bar-track">
                      <div
                        className="simple-chart-bar-fill"
                        style={{
                          width: `${(s.value / max) * 100}%`,
                          background: colors[i % colors.length],
                        }}
                      />
                    </div>
                    <span className="simple-chart-val">{s.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="simple-chart-pie-wrap">
                <svg viewBox="0 0 120 120" className="simple-chart-pie">
                  {(() => {
                    let angle = -90;
                    const cx = 60;
                    const cy = 60;
                    const r = 48;
                    return series.map((s, i) => {
                      const sweep = (s.value / total) * 360;
                      const start = angle;
                      angle += sweep;
                      const rad = (d: number) => (d * Math.PI) / 180;
                      const x1 = cx + r * Math.cos(rad(start));
                      const y1 = cy + r * Math.sin(rad(start));
                      const x2 = cx + r * Math.cos(rad(angle));
                      const y2 = cy + r * Math.sin(rad(angle));
                      const large = sweep > 180 ? 1 : 0;
                      if (sweep <= 0) return null;
                      return (
                        <path
                          key={s.label}
                          d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
                          fill={colors[i % colors.length]}
                        >
                          <title>
                            {s.label}: {s.value}
                          </title>
                        </path>
                      );
                    });
                  })()}
                </svg>
                <ul className="simple-chart-legend">
                  {series.map((s, i) => (
                    <li key={s.label}>
                      <i style={{ background: colors[i % colors.length] }} />
                      {s.label}: {s.value} (
                      {((s.value / total) * 100).toFixed(1)}%)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button
            type="button"
            onClick={() => {
              onMessage("已关闭简易图表");
              onClose();
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
