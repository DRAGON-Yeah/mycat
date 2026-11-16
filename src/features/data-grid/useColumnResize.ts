import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

const MIN_W = 48;
const DEFAULT_W = 140;

/**
 * Drag-to-resize column widths keyed by column name.
 * Attach `startResize(colName, event)` on a handle at the right edge of each header.
 */
export function useColumnResize(opts?: {
  defaultWidth?: number;
  minWidth?: number;
  /** Reset when this key changes (e.g. table id / result identity). */
  resetKey?: string;
}) {
  const defaultWidth = opts?.defaultWidth ?? DEFAULT_W;
  const minWidth = opts?.minWidth ?? MIN_W;
  const [widths, setWidths] = useState<Record<string, number>>({});
  const dragRef = useRef<{
    name: string;
    startX: number;
    startW: number;
  } | null>(null);

  useEffect(() => {
    setWidths({});
  }, [opts?.resetKey]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.max(minWidth, Math.round(d.startW + (e.clientX - d.startX)));
      setWidths((prev) => ({ ...prev, [d.name]: next }));
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.classList.remove("is-col-resizing");
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("is-col-resizing");
    };
  }, [minWidth]);

  const widthOf = useCallback(
    (name: string) => widths[name] ?? defaultWidth,
    [widths, defaultWidth],
  );

  const startResize = useCallback(
    (name: string, e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        name,
        startX: e.clientX,
        startW: widths[name] ?? defaultWidth,
      };
      document.body.classList.add("is-col-resizing");
    },
    [widths, defaultWidth],
  );

  const setWidth = useCallback((name: string, w: number) => {
    setWidths((prev) => ({
      ...prev,
      [name]: Math.max(minWidth, Math.round(w)),
    }));
  }, [minWidth]);

  return { widths, widthOf, startResize, setWidth, setWidths, defaultWidth, minWidth };
}
