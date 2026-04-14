import { useCallback, useState } from "react";
import {
  DEFAULT_KEYBINDINGS,
  KEYBINDINGS_STORAGE_KEY,
  loadKeybindings,
  type KeyBinding,
  type KeyBindingId,
  type Keybindings,
} from "@/lib/keybindings";

export function useKeybindings() {
  const [bindings, setBindings] = useState<Keybindings>(loadKeybindings);

  const updateBinding = useCallback((id: KeyBindingId, binding: KeyBinding) => {
    setBindings((prev) => {
      const next = { ...prev, [id]: binding };
      try {
        localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const resetBinding = useCallback((id: KeyBindingId) => {
    setBindings((prev) => {
      const next = { ...prev, [id]: DEFAULT_KEYBINDINGS[id] };
      try {
        localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const resetAllBindings = useCallback(() => {
    try {
      localStorage.removeItem(KEYBINDINGS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setBindings(DEFAULT_KEYBINDINGS);
  }, []);

  return { bindings, updateBinding, resetBinding, resetAllBindings };
}
