import { useEffect, useMemo, useState } from "react";
import {
  MODEL_HEADER_HEIGHT,
  MODEL_ROW_HEIGHT,
  MODEL_TABLE_PADDING,
  MODEL_TABLE_WIDTH,
  modelTableHeight,
  type DataModel,
  type ModelTable,
} from "./types";

type Props = {
  model: DataModel;
  selectedTableId: string | null;
  onSelectTable: (id: string | null) => void;
  onMoveTable: (id: string, x: number, y: number) => void;
  onDeleteTable: (id: string) => void;
};

type DragState = {
  id: string;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
};

function linkPath(from: ModelTable, to: ModelTable): string {
  const fw = MODEL_TABLE_WIDTH;
  const fh = modelTableHeight(from);
  const tw = MODEL_TABLE_WIDTH;
  const th = modelTableHeight(to);
  const fcx = from.x + fw / 2;
  const fcy = from.y + fh / 2;
  const tcx = to.x + tw / 2;
  const tcy = to.y + th / 2;
  const dx = tcx - fcx;
  const dy = tcy - fcy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx >= 0 ? from.x + fw : from.x;
    const ex = dx >= 0 ? to.x : to.x + tw;
    const mx = (sx + ex) / 2;
    return `M ${sx} ${fcy} C ${mx} ${fcy}, ${mx} ${tcy}, ${ex} ${tcy}`;
  }
  const sy = dy >= 0 ? from.y + fh : from.y;
  const ey = dy >= 0 ? to.y : to.y + th;
  const my = (sy + ey) / 2;
  return `M ${fcx} ${sy} C ${fcx} ${my}, ${tcx} ${my}, ${tcx} ${ey}`;
}

export function ModelCanvas({
  model,
  selectedTableId,
  onSelectTable,
  onMoveTable,
  onDeleteTable,
}: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      const dx = e.clientX - drag!.startX;
      const dy = e.clientY - drag!.startY;
      onMoveTable(
        drag!.id,
        Math.max(0, drag!.origX + dx),
        Math.max(0, drag!.origY + dy),
      );
    }
    function onUp() {
      setDrag(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, onMoveTable]);

  const size = useMemo(() => {
    let w = 1200;
    let h = 800;
    for (const t of model.tables) {
      w = Math.max(w, t.x + MODEL_TABLE_WIDTH + 200);
      h = Math.max(h, t.y + modelTableHeight(t) + 200);
    }
    return { w, h };
  }, [model.tables]);

  const tableById = useMemo(() => {
    const map = new Map<string, ModelTable>();
    for (const t of model.tables) map.set(t.id, t);
    return map;
  }, [model.tables]);

  return (
    <div
      className="model-canvas"
      onPointerDown={(e) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest?.(".model-table")) onSelectTable(null);
      }}
    >
      <div
        className="model-canvas-inner"
        style={{ width: size.w, height: size.h }}
      >
        <svg className="model-links" width={size.w} height={size.h}>
          <defs>
            <marker
              id="model-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {model.links.map((link) => {
            const from = tableById.get(link.fromTable);
            const to = tableById.get(link.toTable);
            if (!from || !to) return null;
            return (
              <path
                key={link.id}
                className="model-link"
                d={linkPath(from, to)}
                markerEnd="url(#model-arrow)"
              />
            );
          })}
        </svg>

        {model.tables.map((table) => {
          const active = table.id === selectedTableId;
          return (
            <div
              key={table.id}
              className={`model-table ${active ? "is-active" : ""}`}
              style={{
                left: table.x,
                top: table.y,
                width: MODEL_TABLE_WIDTH,
                height: modelTableHeight(table),
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectTable(table.id);
              }}
            >
              <div
                className="model-table-head"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectTable(table.id);
                  setDrag({
                    id: table.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: table.x,
                    origY: table.y,
                  });
                }}
              >
                <span className="model-table-name" title={table.name}>
                  {table.name}
                </span>
                <button
                  type="button"
                  className="model-table-del"
                  title="从模型中移除"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTable(table.id);
                  }}
                >
                  ×
                </button>
              </div>
              <ul
                className="model-table-cols"
                style={{
                  paddingTop: MODEL_TABLE_PADDING / 2,
                  maxHeight:
                    modelTableHeight(table) -
                    MODEL_HEADER_HEIGHT -
                    MODEL_TABLE_PADDING / 2,
                }}
              >
                {table.columns.map((col, colIndex) => (
                  <li
                    key={`${col.name}-${colIndex}`}
                    style={{ height: MODEL_ROW_HEIGHT }}
                    className={col.pk ? "is-pk" : undefined}
                    title={`${col.name} ${col.type}${col.notNull ? " NOT NULL" : ""}`}
                  >
                    <span className="model-col-name">
                      {col.pk && <span className="model-pk">PK</span>}
                      {col.name}
                    </span>
                    <span className="model-col-type">{col.type}</span>
                  </li>
                ))}
                {table.columns.length === 0 && (
                  <li className="model-col-empty">（无列信息）</li>
                )}
              </ul>
            </div>
          );
        })}

        {model.tables.length === 0 && (
          <div className="model-canvas-empty">
            <p>模型还是空的。</p>
            <p>点击工具栏「添加表」从数据库导入表结构。</p>
          </div>
        )}
      </div>
    </div>
  );
}
