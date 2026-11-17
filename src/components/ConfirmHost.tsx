import { useEffect, useState } from "react";
import {
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
        resolveConfirm(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        resolveConfirm(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  if (!state) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) resolveConfirm(false);
      }}
    >
      <div
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-label={state.title ?? "确认"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{state.title ?? "确认"}</h2>
        <p className="confirm-text">{state.message}</p>
        <div className="modal-actions">
          <button type="button" onClick={() => resolveConfirm(false)}>
            {state.cancelText ?? "取消"}
          </button>
          <button
            type="button"
            autoFocus
            className={state.danger ? "is-danger" : "is-primary"}
            onClick={() => resolveConfirm(true)}
          >
            {state.confirmText ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
