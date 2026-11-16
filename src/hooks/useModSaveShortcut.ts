import { useEffect, useRef } from "react";

/**
 * ⌘/Ctrl+S → onSave. Uses capture so it works even when an input/Monaco has focus.
 * Shift is ignored here (callers that need 另存为 should handle Shift themselves).
 */
export function useModSaveShortcut(
  onSave: () => void,
  enabled = true,
) {
  const ref = useRef(onSave);
  ref.current = onSave;

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      e.stopPropagation();
      ref.current();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}
