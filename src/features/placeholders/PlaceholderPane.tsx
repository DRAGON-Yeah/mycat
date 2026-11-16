type Props = {
  feature: string;
};

const LABELS: Record<string, string> = {
  view: "视图",
  function: "函数",
  backup: "备份",
  automation: "自动化",
  model: "模型",
  bi: "BI",
};

export function PlaceholderPane({ feature }: Props) {
  const label = LABELS[feature] ?? feature;
  return (
    <div className="placeholder-pane">
      <h2>{label}</h2>
      <p>此功能尚未在 Phase 0 实现，入口仅作 Navicat 风格菜单占位。</p>
    </div>
  );
}
