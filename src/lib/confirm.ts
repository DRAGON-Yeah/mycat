/**
 * 应用内确认框（替代 window.confirm）。
 *
 * WKWebView 的原生 confirm 会阻塞 JS 线程、在 pointerdown 等手势里容易自动取消，
 * 多个弹窗叠加时还会出现“点了没反应”的假死，因此统一改用 React 弹窗。
 */

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作：确认按钮显示为红色 */
  danger?: boolean;
};

/** 关闭未保存页签时的三选一结果 */
export type CloseChoice = "cancel" | "discard" | "save";

export type CloseConfirmOptions = ConfirmOptions & {
  saveText?: string;
  discardText?: string;
};

export type ConfirmState =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | {
      kind: "close";
      options: CloseConfirmOptions;
      resolve: (choice: CloseChoice) => void;
    }
  | null;

let current: ConfirmState = null;
const listeners = new Set<(state: ConfirmState) => void>();

function emit() {
  for (const fn of listeners) fn(current);
}

export function subscribeConfirm(fn: (state: ConfirmState) => void) {
  listeners.add(fn);
  fn(current);
  return () => {
    listeners.delete(fn);
  };
}

function settle(prev: ConfirmState) {
  if (!prev) return;
  if (prev.kind === "confirm") prev.resolve(false);
  else prev.resolve("cancel");
}

/** 二选一确认 */
export function confirmDialog(
  options: ConfirmOptions | string,
): Promise<boolean> {
  const opts = typeof options === "string" ? { message: options } : options;
  return new Promise<boolean>((resolve) => {
    // 已有待确认弹窗时按“取消”收尾，避免叠加出无法关闭的弹窗
    settle(current);
    current = { kind: "confirm", options: opts, resolve };
    emit();
  });
}

/** 关闭未保存页签：取消 / 不保存并关闭 / 保存并关闭 */
export function confirmCloseDialog(
  options: CloseConfirmOptions | string,
): Promise<CloseChoice> {
  const opts = typeof options === "string" ? { message: options } : options;
  return new Promise<CloseChoice>((resolve) => {
    settle(current);
    current = { kind: "close", options: opts, resolve };
    emit();
  });
}

export function resolveConfirm(ok: boolean) {
  const pending = current;
  if (!pending) return;
  current = null;
  emit();
  if (pending.kind === "confirm") pending.resolve(ok);
  else pending.resolve(ok ? "discard" : "cancel");
}

export function resolveClose(choice: CloseChoice) {
  const pending = current;
  if (!pending) return;
  current = null;
  emit();
  if (pending.kind === "close") pending.resolve(choice);
  else pending.resolve(choice === "cancel" ? false : true);
}
