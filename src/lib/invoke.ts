import { invoke as tauriInvoke } from "@tauri-apps/api/core";

type InvokeArgs = Record<string, unknown> | undefined;

function ensureTauriReady() {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
  if (!internals) {
    throw new Error(
      "当前不在桌面窗口中（缺少 Tauri IPC）。请关闭浏览器里的 localhost:1420，改用 `npm run tauri dev` 弹出的「Mycat」窗口操作。",
    );
  }
}

export async function invoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  ensureTauriReady();
  return tauriInvoke<T>(cmd, args);
}
