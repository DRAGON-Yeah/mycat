import { useEffect, useState } from "react";
import {
  resolveClose,
  resolveConfirm,
  subscribeConfirm,
  type ConfirmState,
} from "../lib/confirm";

/** 全局确认框宿主：挂在 App 根部，替代 window.confirm */
export function ConfirmHost() {
  const [state, setState] = useState<ConfirmState>(null);

  useEffect(() => subscribeConfirm(setState), []);

  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (state!.kind === "close") resolveClose("cancel");
        else resolveConfirm(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (state!.kind === "close") resolveClose("discard");
        else resolveConfirm(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  if (!state) return null;

  const options = state.options;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (state.kind === "close") resolveClose("cancel");
        else resolveConfirm(false);
      }}
    >
      <div
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-label={options.title ?? "确认"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{options.title ?? "确认"}</h2>
        <p className="confirm-text">{options.message}</p>
        <div className="modal-actions">
          <button
            type="button"
            onClick={() =>
              state.kind === "close" ? resolveClose("cancel") : resolveConfirm(false)
            }
          >
            {options.cancelText ?? "取消"}
          </button>
          {state.kind === "close" ? (
            <>
              <button
                type="button"
                className="is-danger"
                onClick={() => resolveClose("discard")}
              >
                {state.options.discardText ?? "不保存并关闭"}
              </button>
              <button
                type="button"
                autoFocus
                className="is-primary"
                onClick={() => resolveClose("save")}
              >
                {state.options.saveText ?? "保存并关闭"}
              </button>
            </>
          ) : (
            <button
              type="button"
              autoFocus
              className={options.danger ? "is-danger" : "is-primary"}
              onClick={() => resolveConfirm(true)}
            >
              {options.confirmText ?? "确定"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
