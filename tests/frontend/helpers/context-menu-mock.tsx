/**
 * Inline-rendering mock for `@/components/ui/context-menu`.
 * Radix's real ContextMenu only renders content after a right-click (with a
 * portal), which is fragile under jsdom. This mock renders every item as a
 * plain button so tests can assert visibility directly.
 *
 * Usage (at the top of a test file):
 *   vi.mock("@/components/ui/context-menu", () => contextMenuMock);
 */

import React, { useEffect } from "react";

type Children = { children: React.ReactNode };

export const contextMenuMock = {
  ContextMenu: ({
    children,
    onOpenChange,
  }: Children & { onOpenChange?: (open: boolean) => void }) => {
    useEffect(() => {
      onOpenChange?.(true);
    }, [onOpenChange]);
    return <div>{children}</div>;
  },
  ContextMenuTrigger: ({ children }: Children) => <>{children}</>,
  ContextMenuContent: ({ children }: Children) => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    disabled,
    onSelect,
    className,
  }: Children & {
    disabled?: boolean;
    onSelect?: () => void;
    className?: string;
  }) => (
    <div
      role="menuitem"
      aria-disabled={disabled}
      className={className}
      onClick={() => !disabled && onSelect?.()}
    >
      {children}
    </div>
  ),
  ContextMenuSeparator: () => <hr />,
  ContextMenuSub: ({ children }: Children) => <div>{children}</div>,
  ContextMenuSubTrigger: ({ children }: Children) => <div>{children}</div>,
  ContextMenuSubContent: ({ children }: Children) => <div>{children}</div>,
};
