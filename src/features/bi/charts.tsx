import { CHART_COLORS, type BiChartType } from "./types";

export type ChartData = {
  columns: string[];
  rows: unknown[][];
};

export type ChartProps = {
  data: ChartData;
  categoryColumn: number;
  valueColumn: number;
  height: number;
};

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

function toLabel(v: unknown): string {
  if (v == null) return "—";
  if (v instanceof Date) return v.toLocaleDateString();
  return String(v);
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function series(data: ChartData, cat: number, val: number) {
  return data.rows.map((row) => ({
    label: toLabel(row[cat]),
    value: toNumber(row[val]),
  }));
}

export function BarChart({
  data,
  categoryColumn,
  valueColumn,
  height,
}: ChartProps) {
  const items = series(data, categoryColumn, valueColumn);
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="bi-chart bi-bar" style={{ height }}>
      <div className="bi-bar-plot">
        {items.map((item, i) => (
          <div
            key={`${item.label}-${i}`}
            className="bi-bar-col"
            title={`${item.label}: ${formatNumber(item.value)}`}
          >
            <span className="bi-bar-value">{formatNumber(item.value)}</span>
            <div
              className="bi-bar-fill"
              style={{
                height: `${Math.max(2, (Math.abs(item.value) / max) * 100)}%`,
                background: CHART_COLORS[i % CHART_COLORS.length],
              }}
            />
          </div>
        ))}
      </div>
      <div className="bi-axis">
        {items.map((item, i) => (
          <span key={`${item.label}-${i}`} className="bi-axis-label" title={item.label}>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function LineChart({
  data,
  categoryColumn,
  valueColumn,
  height,
}: ChartProps) {
  const items = series(data, categoryColumn, valueColumn);
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const n = items.length;
  const points = items
    .map((item, i) => {
      const x = n <= 1 ? 50 : (i / (n - 1)) * 100;
      const y = 100 - (Math.abs(item.value) / max) * 92 - 4;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <div className="bi-chart bi-line" style={{ height }}>
      <svg
        className="bi-line-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
      >
        {[0, 25, 50, 75, 100].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            className="bi-grid-line"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {n > 1 && (
          <polyline
            points={points}
            className="bi-line-path"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="bi-axis">
        {items.map((item, i) => (
          <span key={`${item.label}-${i}`} className="bi-axis-label" title={item.label}>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PieChart({
  data,
  categoryColumn,
  valueColumn,
  height,
}: ChartProps) {
  const items = series(data, categoryColumn, valueColumn).filter(
    (i) => i.value > 0,
  );
  const total = items.reduce((sum, i) => sum + i.value, 0) || 1;
  let acc = 0;
  return (
    <div className="bi-chart bi-pie" style={{ height }}>
      <svg viewBox="0 0 42 42" className="bi-pie-svg" role="img">
        <circle
          cx="21"
          cy="21"
          r="15.9155"
          fill="none"
          className="bi-pie-track"
          strokeWidth="8"
        />
        {items.map((item, i) => {
          const pct = (item.value / total) * 100;
          const dash = `${pct} ${100 - pct}`;
          const offset = 25 - acc;
          acc += pct;
          return (
            <circle
              key={`${item.label}-${i}`}
              cx="21"
              cy="21"
              r="15.9155"
              fill="none"
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth="8"
              strokeDasharray={dash}
              strokeDashoffset={offset}
            >
              <title>{`${item.label}: ${formatNumber(item.value)}`}</title>
            </circle>
          );
        })}
      </svg>
      <ul className="bi-legend">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`}>
            <span
              className="bi-legend-dot"
              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
            />
            <span className="bi-legend-label" title={item.label}>
              {item.label}
            </span>
            <span className="bi-legend-value">
              {formatNumber(item.value)} ·{" "}
              {((item.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="pane-placeholder">无数值数据</li>}
      </ul>
    </div>
  );
}

export function TableChart({ data, height }: ChartProps) {
  return (
    <div className="bi-chart bi-table" style={{ height }}>
      <table className="object-list-table">
        <thead>
          <tr>
            {data.columns.map((c, i) => (
              <th key={`${c}-${i}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.slice(0, 200).map((row, i) => (
            <tr key={i}>
              {data.columns.map((c, j) => (
                <td key={`${c}-${j}`}>{toLabel(row[j])}</td>
              ))}
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={Math.max(1, data.columns.length)}>无数据</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function KpiChart({
  data,
  categoryColumn,
  valueColumn,
  height,
}: ChartProps) {
  const first = data.rows[0];
  const value = first ? toNumber(first[valueColumn]) : 0;
  const caption = first
    ? toLabel(first[categoryColumn])
    : data.columns[valueColumn] ?? "";
  return (
    <div className="bi-chart bi-kpi" style={{ height }}>
      <strong className="bi-kpi-value">{formatNumber(value)}</strong>
      <span className="bi-kpi-caption">{caption}</span>
      <span className="bi-kpi-meta">
        {data.columns[valueColumn] ?? ""} · 共 {data.rows.length} 行
      </span>
    </div>
  );
}

export function ChartView({
  type,
  ...props
}: ChartProps & { type: BiChartType }) {
  if (type === "line") return <LineChart {...props} />;
  if (type === "pie") return <PieChart {...props} />;
  if (type === "table") return <TableChart {...props} />;
  if (type === "kpi") return <KpiChart {...props} />;
  return <BarChart {...props} />;
}
