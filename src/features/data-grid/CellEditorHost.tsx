import { useEffect, useRef } from "react";
import type { ColumnExtra, EditorKind } from "./columnEditors";
import { DateTimePicker } from "./DateTimePicker";

type Props = {
  kind: EditorKind;
  value: unknown;
  nullable: boolean;
  enumValues?: string[];
  /** Anchor for inline dropdowns */
  anchorRect?: DOMRect | null;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
};

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function CellEditorHost({
  kind,
  value,
  nullable,
  enumValues = [],
  onCommit,
  onCancel,
}: Props) {
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (kind === "enum" || kind === "bool") {
      selectRef.current?.focus();
    }
  }, [kind]);

  if (kind === "datetime" || kind === "date" || kind === "time") {
    return (
      <DateTimePicker
        mode={kind}
        value={toStr(value)}
        nullable={nullable}
        onConfirm={(v) => onCommit(v)}
        onCancel={onCancel}
      />
    );
  }

  if (kind === "bool") {
    return (
      <div className="cell-pop-editor" role="dialog">
        <select
          ref={selectRef}
          className="cell-pop-select"
          defaultValue={
            value === null || value === undefined
              ? ""
              : value === true || value === 1 || value === "1"
                ? "1"
                : "0"
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") onCommit(null);
            else onCommit(Number(v));
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          onBlur={(e) => {
            // Keep open if clicking inside; blur commit current
            const v = e.currentTarget.value;
            if (v === "") onCommit(null);
            else onCommit(Number(v));
          }}
        >
          {nullable ? <option value="">NULL</option> : null}
          <option value="0">0</option>
          <option value="1">1</option>
        </select>
      </div>
    );
  }

  if (kind === "enum") {
    const options = enumValues.length > 0 ? enumValues : [];
    return (
      <div className="cell-pop-editor" role="dialog">
        <select
          ref={selectRef}
          className="cell-pop-select"
          size={Math.min(8, Math.max(3, options.length + (nullable ? 1 : 0)))}
          defaultValue={toStr(value)}
          onChange={(e) => {
            const v = e.target.value;
            onCommit(v === "" && nullable ? null : v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
        >
          {nullable ? <option value="">NULL</option> : null}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {options.length === 0 ? (
            <option value={toStr(value)} disabled>
              （无枚举元数据，请用文本编辑）
            </option>
          ) : null}
        </select>
        <button type="button" className="ghost-btn" onClick={onCancel}>
          取消
        </button>
      </div>
    );
  }

  return null;
}

export function needsChooser(
  kind: EditorKind,
  extra?: ColumnExtra | null,
): boolean {
  if (kind === "datetime" || kind === "date" || kind === "time" || kind === "bool") {
    return true;
  }
  if (kind === "enum") {
    return (extra?.enumValues?.length ?? 0) > 0;
  }
  return false;
}
