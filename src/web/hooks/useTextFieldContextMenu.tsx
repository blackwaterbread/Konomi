import {
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

type TextFieldElement = HTMLInputElement | HTMLTextAreaElement;

type MenuState = {
  x: number;
  y: number;
  hasSelection: boolean;
  hasValue: boolean;
  isReadOnly: boolean;
};

export interface UseTextFieldContextMenuResult<T extends TextFieldElement> {
  onContextMenu: (e: ReactMouseEvent<T>) => void;
  contextMenu: ReactNode;
}

function setReactValue(el: TextFieldElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function useTextFieldContextMenu<
  T extends TextFieldElement = TextFieldElement,
>(): UseTextFieldContextMenuResult<T> {
  const { t } = useTranslation();
  const elementRef = useRef<T | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const close = useCallback(() => setMenu(null), []);

  const replaceSelection = (text: string) => {
    const el = elementRef.current;
    if (!el || el.readOnly || el.disabled) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setReactValue(el, next);
    const cursor = start + text.length;
    el.setSelectionRange(cursor, cursor);
    el.focus();
  };

  const handleCut = () => {
    const el = elementRef.current;
    if (!el || el.readOnly || el.disabled) return close();
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    if (start === end) return close();
    void navigator.clipboard.writeText(el.value.slice(start, end));
    replaceSelection("");
    close();
  };

  const handleCopy = () => {
    const el = elementRef.current;
    if (!el) return close();
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    if (start === end) return close();
    void navigator.clipboard.writeText(el.value.slice(start, end));
    close();
  };

  const handlePaste = () => {
    void navigator.clipboard.readText().then((text) => {
      if (text) replaceSelection(text);
    });
    close();
  };

  const handleDelete = () => {
    replaceSelection("");
    close();
  };

  const handleSelectAll = () => {
    const el = elementRef.current;
    if (!el || el.value.length === 0) return close();
    el.focus();
    el.setSelectionRange(0, el.value.length);
    close();
  };

  const onContextMenu = useCallback((e: ReactMouseEvent<T>) => {
    const el = e.currentTarget;
    if (el.disabled) return;
    e.preventDefault();
    elementRef.current = el;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      hasSelection: start !== end,
      hasValue: el.value.length > 0,
      isReadOnly: el.readOnly,
    });
  }, []);

  const contextMenu = menu
    ? createPortal(
        <>
          <div
            role="presentation"
            className="fixed inset-0 z-3100"
            onPointerDown={(e) => {
              e.stopPropagation();
              close();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              close();
            }}
          />
          <div
            className="fixed z-3200 min-w-40 rounded-md border border-border bg-popover py-1 shadow-lg"
            style={{ top: menu.y, left: menu.x }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button
              type="button"
              disabled={!menu.hasSelection || menu.isReadOnly}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCut}
              className="flex w-full px-3 py-1.5 text-xs text-foreground/80 hover:bg-secondary disabled:opacity-40"
            >
              {t("common.textFieldContext.cut")}
            </button>
            <button
              type="button"
              disabled={!menu.hasSelection}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCopy}
              className="flex w-full px-3 py-1.5 text-xs text-foreground/80 hover:bg-secondary disabled:opacity-40"
            >
              {t("common.textFieldContext.copy")}
            </button>
            <button
              type="button"
              disabled={menu.isReadOnly}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handlePaste}
              className="flex w-full px-3 py-1.5 text-xs text-foreground/80 hover:bg-secondary disabled:opacity-40"
            >
              {t("common.textFieldContext.paste")}
            </button>
            <button
              type="button"
              disabled={!menu.hasSelection || menu.isReadOnly}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleDelete}
              className="flex w-full px-3 py-1.5 text-xs text-foreground/80 hover:bg-secondary disabled:opacity-40"
            >
              {t("common.textFieldContext.delete")}
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              disabled={!menu.hasValue}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleSelectAll}
              className="flex w-full px-3 py-1.5 text-xs text-foreground/80 hover:bg-secondary disabled:opacity-40"
            >
              {t("common.textFieldContext.selectAll")}
            </button>
          </div>
        </>,
        document.body,
      )
    : null;

  return { onContextMenu, contextMenu };
}
