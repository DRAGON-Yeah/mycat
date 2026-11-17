import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type TabKind = "query" | "table" | "designer";

export type TabMenuTarget = {
  x: number;
  y: number;
  kind: TabKind;
  id: string;
  /** More than one closable document tab exists. */
  hasOthers: boolean;
  /** At least one closable document tab sits to the right of this one. */
  hasRight: boolean;
  /** The tab maps to an object that the nav tree can highlight. */
  canReveal: boolean;
};

type Props = {
  target: TabMenuTarget;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onCloseAll: () => void;
  onReveal: () => void;
};

export function TabContextMenu({
  target,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseRight,
  onCloseAll,
  onReveal,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(target.x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - rect.height - 8)),
    });
  }, [target.x, target.y]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div
      ref={ref}
      className="dg-context-menu ws-tab-context-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      aria-label="页签操作"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => run(onCloseTab)}>
        关闭
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!target.hasOthers}
        onClick={() => run(onCloseOthers)}
      >
        关闭其他选项卡
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!target.hasRight}
        onClick={() => run(onCloseRight)}
      >
        关闭右侧的选项卡
      </button>
      <button type="button" role="menuitem" onClick={() => run(onCloseAll)}>
        全部关闭
      </button>

      <div className="dg-menu-sep" />

      <button type="button" role="menuitem" disabled title="暂不支持在新窗口中打开">
        将选项卡移动到新窗口
      </button>

      <div className="dg-menu-sep" />

      <button type="button" role="menuitem" disabled title="暂不支持收藏夹">
        添加到收藏夹
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!target.canReveal}
        onClick={() => run(onReveal)}
      >
        在导航窗格中显示
      </button>
    </div>
  );
}
