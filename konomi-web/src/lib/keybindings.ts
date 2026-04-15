export type KeyBinding = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export type KeyBindingId =
  | "panel.generator"
  | "panel.gallery"
  | "panel.tagSearch"
  | "panel.settings"
  | "browse.all"
  | "browse.recent"
  | "browse.favorites"
  | "browse.randomPick"
  | "browse.randomRefresh"
  | "gallery.focusSearch"
  | "gallery.prevPage"
  | "gallery.nextPage"

  | "detail.close"
  | "detail.prev"
  | "detail.next"
  | "detail.favorite"
  | "detail.copyPrompt"
  | "detail.delete"
  | "generator.generate";

export type Keybindings = Record<KeyBindingId, KeyBinding>;

export const DEFAULT_KEYBINDINGS: Keybindings = {
  "panel.generator": { key: "1", ctrl: true },
  "panel.gallery": { key: "2", ctrl: true },
  "panel.tagSearch": { key: "3", ctrl: true },
  "panel.settings": { key: "4", ctrl: true },
  "browse.all": { key: "1", alt: true },
  "browse.recent": { key: "2", alt: true },
  "browse.favorites": { key: "3", alt: true },
  "browse.randomPick": { key: "4", alt: true },
  "browse.randomRefresh": { key: "r" },
  "gallery.focusSearch": { key: "/" },
  "gallery.prevPage": { key: "PageUp" },
  "gallery.nextPage": { key: "PageDown" },

  "detail.close": { key: "Escape" },
  "detail.prev": { key: "ArrowLeft" },
  "detail.next": { key: "ArrowRight" },
  "detail.favorite": { key: "f" },
  "detail.copyPrompt": { key: "c" },
  "detail.delete": { key: "Delete" },
  "generator.generate": { key: "F5" },
};

export const KEYBINDINGS_STORAGE_KEY = "konomi-keybindings";

const KEY_DISPLAY_MAP: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Delete: "Del",
  Backspace: "⌫",
  " ": "Space",
  PageUp: "Page↑",
  PageDown: "Page↓",
  Enter: "Enter",
  Tab: "Tab",
};

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

export function formatKeyBinding(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  const displayKey = KEY_DISPLAY_MAP[binding.key] ?? binding.key;
  parts.push(displayKey);
  return parts.join("+");
}

export function matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
  return (
    normalizeKey(e.key) === normalizeKey(binding.key) &&
    !!e.ctrlKey === !!binding.ctrl &&
    !!e.shiftKey === !!binding.shift &&
    !!e.altKey === !!binding.alt
  );
}

export function bindingsEqual(a: KeyBinding, b: KeyBinding): boolean {
  return (
    normalizeKey(a.key) === normalizeKey(b.key) &&
    !!a.ctrl === !!b.ctrl &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt
  );
}

export function findConflicts(
  id: KeyBindingId,
  binding: KeyBinding,
  bindings: Keybindings,
): KeyBindingId[] {
  return (Object.keys(bindings) as KeyBindingId[]).filter(
    (otherId) => otherId !== id && bindingsEqual(bindings[otherId], binding),
  );
}

export function isModifiedBinding(
  id: KeyBindingId,
  bindings: Keybindings,
): boolean {
  return !bindingsEqual(bindings[id], DEFAULT_KEYBINDINGS[id]);
}

export function loadKeybindings(): Keybindings {
  try {
    const stored = localStorage.getItem(KEYBINDINGS_STORAGE_KEY);
    if (!stored) return DEFAULT_KEYBINDINGS;
    return { ...DEFAULT_KEYBINDINGS, ...JSON.parse(stored) } as Keybindings;
  } catch {
    return DEFAULT_KEYBINDINGS;
  }
}
