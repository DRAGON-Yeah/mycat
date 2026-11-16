import { useCallback, useEffect, useRef } from "react";

type Props = {
  orientation: "vertical" | "horizontal";
  onDrag: (delta: number) => void;
  onDragEnd?: () => void;
  title?: string;
};

/**
 * Thin drag handle between panes.
 * vertical = resize left/right widths
 * horizontal = resize top/bottom heights
 */
export function Splitter({ orientation, onDrag, onDragEnd, title }: Props) {
  const dragging = useRef(false);
  const last = useRef(0);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      const pos = orientation === "vertical" ? e.clientX : e.clientY;
      const delta = pos - last.current;
      last.current = pos;
      if (delta !== 0) onDrag(delta);
    },
    [onDrag, orientation],
  );

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.classList.remove(
      "is-col-resizing",
      "is-row-resizing",
    );
    onDragEnd?.();
  }, [onDragEnd]);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [onPointerMove, endDrag]);

  return (
    <div
      className={`splitter splitter-${orientation === "vertical" ? "v" : "h"}`}
      title={title ?? "拖动调整大小"}
      role="separator"
      aria-orientation={orientation}
      onPointerDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        last.current = orientation === "vertical" ? e.clientX : e.clientY;
        document.body.classList.add(
          orientation === "vertical" ? "is-col-resizing" : "is-row-resizing",
        );
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onDoubleClick={() => {
        // no-op hook for future reset; parent can pass via title hint
      }}
    />
  );
}
