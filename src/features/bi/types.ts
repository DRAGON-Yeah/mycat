import { newId, nowIso } from "../../lib/localDocs";

export type BiChartType = "bar" | "line" | "pie" | "table" | "kpi";

export type BiWidget = {
  id: string;
  title: string;
  type: BiChartType;
  connectionId: string;
  connectionName: string;
  database: string;
  sql: string;
  /** 分类轴列下标 */
  categoryColumn: number;
  /** 数值列下标 */
  valueColumn: number;
  /** 占用的栅格列数：1 或 2 */
  span: 1 | 2;
  /** 图表高度（px） */
  height: number;
};

export type BiDashboard = {
  id: string;
  name: string;
  widgets: BiWidget[];
  createdAt: string;
  updatedAt: string;
};

export const CHART_TYPES: { id: BiChartType; label: string }[] = [
  { id: "bar", label: "柱状图" },
  { id: "line", label: "折线图" },
  { id: "pie", label: "饼图" },
  { id: "table", label: "数据表" },
  { id: "kpi", label: "指标卡" },
];

export const CHART_COLORS = [
  "#4c9aff",
  "#66bb6a",
  "#ffa726",
  "#ef5350",
  "#ab47bc",
  "#26c6da",
  "#8d6e63",
  "#7e57c2",
];

export function chartTypeLabel(type: BiChartType): string {
  return CHART_TYPES.find((t) => t.id === type)?.label ?? type;
}

export function newDashboard(name: string): BiDashboard {
  const at = nowIso();
  return {
    id: newId("dash"),
    name,
    widgets: [],
    createdAt: at,
    updatedAt: at,
  };
}

export function newWidget(args: {
  title: string;
  connectionId: string;
  connectionName: string;
  database: string;
}): BiWidget {
  return {
    id: newId("widget"),
    title: args.title,
    type: "bar",
    connectionId: args.connectionId,
    connectionName: args.connectionName,
    database: args.database,
    sql: "",
    categoryColumn: 0,
    valueColumn: 1,
    span: 1,
    height: 240,
  };
}
