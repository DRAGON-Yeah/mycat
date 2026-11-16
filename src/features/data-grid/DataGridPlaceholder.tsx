import type { TableTab } from "../../stores/workspaceStore";

type Props = {
  tab: TableTab;
};

/** T11 placeholder; T12 will replace with real paginated grid. */
export function DataGridPlaceholder({ tab }: Props) {
  return (
    <div className="workspace-content">
      <h1>
        {tab.connectionName} / {tab.table}
      </h1>
      <p>数据网格将在此加载（分页浏览下一步实现）。</p>
    </div>
  );
}
