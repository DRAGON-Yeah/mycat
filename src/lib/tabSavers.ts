/**
 * 页签保存器注册表。
 *
 * 表格数据 / 表设计器 / 视图 / 函数 / 事件等编辑器把各自的保存动作注册进来，
 * 关闭页签时「保存并关闭」才能直接调用它们（组件未挂载时视为不可保存）。
 */

type Saver = () => void | Promise<void>;

const savers = new Map<string, Saver>();

export function registerTabSaver(id: string, saver: Saver) {
  savers.set(id, saver);
  return () => {
    if (savers.get(id) === saver) savers.delete(id);
  };
}

export function hasTabSaver(id: string) {
  return savers.has(id);
}

/** 调用页签自己的保存动作；未注册返回 false */
export async function runTabSaver(id: string): Promise<boolean> {
  const fn = savers.get(id);
  if (!fn) return false;
  await fn();
  return true;
}
