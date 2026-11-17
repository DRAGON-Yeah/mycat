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

export type ConfirmState = (ConfirmOptions & {
  resolve: (ok: boolean) => void;
}) | null;

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

export function confirmDialog(
  options: ConfirmOptions | string,
): Promise<boolean> {
  const opts = typeof options === "string" ? { message: options } : options;
  return new Promise<boolean>((resolve) => {
    // 已有待确认弹窗时按“取消”收尾，避免叠加出无法关闭的弹窗
    if (current) {
      const prev = current;
      current = null;
      prev.resolve(false);
    }
    current = { ...opts, resolve };
    emit();
  });
}

export function resolveConfirm(ok: boolean) {
  const pending = current;
  if (!pending) return;
  current = null;
  emit();
  pending.resolve(ok);
}
