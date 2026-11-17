type Props = {
  feature: string;
};

const LABELS: Record<string, string> = {
  view: "视图",
  function: "函数",
  backup: "备份",
};

export function PlaceholderPane({ feature }: Props) {
  const label = LABELS[feature] ?? feature;
  return (
    <div className="placeholder-pane">
      <h2>{label}</h2>
      <p>该入口暂未提供独立面板，请通过左侧导航树或对应工具栏操作。</p>
    </div>
  );
}
