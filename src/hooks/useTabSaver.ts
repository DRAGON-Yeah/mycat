import { useEffect, useRef } from "react";
import { registerTabSaver } from "../lib/tabSavers";

/** 把组件的保存动作注册到页签，供「保存并关闭」调用 */
export function useTabSaver(id: string, save: () => void | Promise<void>) {
  const ref = useRef(save);
  ref.current = save;

  useEffect(() => registerTabSaver(id, () => ref.current()), [id]);
}
