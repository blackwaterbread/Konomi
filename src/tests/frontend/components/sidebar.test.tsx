import React, { type ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "@/components/sidebar";
import type { Category, Folder } from "@preload/index.d";

const useFoldersMock = vi.fn();
const useDuplicateResolutionDialogMock = vi.fn();
const useFolderDialogMock = vi.fn();

vi.mock("@/hooks/useFolders", () => ({
  useFolders: () => useFoldersMock(),
}));

vi.mock("@/hooks/useDuplicateResolutionDialog", () => ({
  useDuplicateResolutionDialog: () => useDuplicateResolutionDialogMock(),
}));

vi.mock("@/hooks/useFolderDialog", () => ({
  useFolderDialog: () => useFolderDialogMock(),
}));

vi.mock("@/components/duplicate-resolution-dialog", () => ({
  DuplicateResolutionDialog: ({ open }: { open: boolean }) =>
    open ? <div>Duplicate Resolution Dialog</div> : null,
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuItem: ({
    children,
    disabled,
    onSelect,
    className,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
    className?: string;
  }) => (
    <button
      type="button"
      disabled={disabled}
      className={className}
      onClick={() => onSelect?.()}
    >
      {children}
    </button>
  ),
  ContextMenuSeparator: () => <hr />,
}));

function createFolder(id: number, name = `Folder ${id}`): Folder {
  return {
    id,
    name,
    path: `C:\\images\\folder-${id}`,
    createdAt: new Date("2026-03-20T12:00:00.000Z"),
  };
}

function createCategory(
  id: number,
  name: string,
  overrides: Partial<Category> = {},
): Category {
  return {
    id,
    name,
    isBuiltin: false,
    order: id,
    ...overrides,
  };
}

function createDuplicateDialogModel() {
  return {
    open: false,
    mode: "folderAdd" as const,
    items: [],
    choices: {},
    bulkDecision: "existing" as const,
    resolving: false,
    pageIndex: 0,
    preview: null,
    onOpenChange: vi.fn(),
    onApplyAll: vi.fn(),
    onSelectBulkDecision: vi.fn(),
    onPrevPage: vi.fn(),
    onNextPage: vi.fn(),
    onSetChoice: vi.fn(),
    onResolve: vi.fn().mockResolvedValue(undefined),
    onOpenPreview: vi.fn(),
    onPreviewOpenChange: vi.fn(),
  };
}

function createFolderDialogState() {
  return {
    open: false,
    name: "",
    path: "",
    canSubmit: false,
    isSubmitting: false,
    submitError: null,
    setName: vi.fn(),
    handleBrowse: vi.fn(),
    handleSubmit: vi.fn(),
    handleOpenChange: vi.fn(),
  };
}

function renderSidebar(
  overrides: Partial<ComponentProps<typeof Sidebar>> = {},
) {
  const props: ComponentProps<typeof Sidebar> = {
    activeView: "all",
    onViewChange: vi.fn(),
    selectedFolderIds: new Set(),
    onFolderToggle: vi.fn(),
    onFolderRemoved: vi.fn(),
    onFolderAdded: vi.fn(),
    onFolderCancelled: vi.fn(),
    onFolderRescan: vi.fn(),
    rollbackRequest: null,
    scanningFolderIds: new Set(),
    scanning: false,
    categories: [],
    selectedCategoryId: null,
    onCategorySelect: vi.fn(),
    onCategoryCreate: vi.fn(),
    onCategoryRename: vi.fn(),
    onCategoryDelete: vi.fn(),
    onCategoryReorder: vi.fn(),
    onCategoryAddByPrompt: vi.fn(),
    onRandomRefresh: vi.fn(),
    isAnalyzing: false,
    onFolderCountChange: vi.fn(),
    folderDialogRequest: 0,
    ...overrides,
  };

  return {
    ...render(<Sidebar {...props} />),
    props,
  };
}

describe("Sidebar", () => {
  beforeEach(() => {
    const folders = [createFolder(1), createFolder(2)];

    useFoldersMock.mockReset();
    useFoldersMock.mockReturnValue({
      folders,
      hasLoaded: true,
      addFolder: vi.fn(),
      removeFolder: vi.fn().mockResolvedValue(undefined),
      renameFolder: vi.fn().mockResolvedValue(undefined),
      reorderFolders: vi.fn(),
    });

    useDuplicateResolutionDialogMock.mockReset();
    useDuplicateResolutionDialogMock.mockReturnValue({
      dialog: createDuplicateDialogModel(),
      folderAddResolvedSeq: 0,
      handleFolderAddWithDuplicateCheck: vi.fn().mockResolvedValue(undefined),
      handleFolderRescanWithDuplicateCheck: vi.fn().mockResolvedValue(
        undefined,
      ),
    });

    useFolderDialogMock.mockReset();
    useFolderDialogMock.mockReturnValue(createFolderDialogState());
  });

  it("reports folder count and processes rollback requests once per request id", async () => {
    const removeFolder = vi.fn().mockResolvedValue(undefined);
    const onFolderCountChange = vi.fn();
    const onFolderCancelled = vi.fn();

    useFoldersMock.mockReturnValue({
      folders: [createFolder(1), createFolder(2)],
      hasLoaded: true,
      addFolder: vi.fn(),
      removeFolder,
      renameFolder: vi.fn().mockResolvedValue(undefined),
      reorderFolders: vi.fn(),
    });

    const { rerender, props } = renderSidebar({
      onFolderCountChange,
      onFolderCancelled,
      rollbackRequest: { id: 1, folderIds: [1, 2] },
    });

    await waitFor(() => expect(onFolderCountChange).toHaveBeenCalledWith(2));
    await waitFor(() => expect(removeFolder).toHaveBeenCalledTimes(2));
    expect(onFolderCancelled).toHaveBeenCalledWith(1);
    expect(onFolderCancelled).toHaveBeenCalledWith(2);

    rerender(
      <Sidebar
        {...props}
        onFolderCountChange={onFolderCountChange}
        onFolderCancelled={onFolderCancelled}
        rollbackRequest={{ id: 1, folderIds: [1, 2] }}
      />,
    );

    await waitFor(() => expect(removeFolder).toHaveBeenCalledTimes(2));

    rerender(
      <Sidebar
        {...props}
        onFolderCountChange={onFolderCountChange}
        onFolderCancelled={onFolderCancelled}
        rollbackRequest={{ id: 2, folderIds: [2] }}
      />,
    );

    await waitFor(() => expect(removeFolder).toHaveBeenCalledTimes(3));
    expect(onFolderCancelled).toHaveBeenCalledTimes(3);
  });

  it("switches views and clears the selected category", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    const onCategorySelect = vi.fn();

    renderSidebar({
      activeView: "all",
      selectedCategoryId: 9,
      onViewChange,
      onCategorySelect,
      categories: [createCategory(9, "Portraits")],
    });

    await user.click(screen.getByRole("button", { name: "Recent" }));

    expect(onViewChange).toHaveBeenCalledWith("recent");
    expect(onCategorySelect).toHaveBeenCalledWith(null);
  });

  it("toggles custom category selection and rerolls the random builtin category", async () => {
    const user = userEvent.setup();
    const onCategorySelect = vi.fn();
    const onRandomRefresh = vi.fn();
    const categories = [
      createCategory(1, "Random", { isBuiltin: true, order: 1 }),
      createCategory(2, "Portraits"),
    ];

    const { rerender, props } = renderSidebar({
      categories,
      selectedCategoryId: 1,
      onCategorySelect,
      onRandomRefresh,
    });

    await user.click(screen.getByTitle("Pick Again"));
    expect(onRandomRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <Sidebar
        {...props}
        categories={categories}
        selectedCategoryId={2}
        onCategorySelect={onCategorySelect}
        onRandomRefresh={onRandomRefresh}
      />,
    );

    await user.click(screen.getByText("Portraits"));
    expect(onCategorySelect).toHaveBeenCalledWith(null);
  });

  it("routes folder rescans through the duplicate-resolution guard", async () => {
    const user = userEvent.setup();
    const folder = createFolder(1, "Primary Folder");
    const handleFolderRescanWithDuplicateCheck = vi
      .fn()
      .mockResolvedValue(undefined);

    useFoldersMock.mockReturnValue({
      folders: [folder],
      hasLoaded: true,
      addFolder: vi.fn(),
      removeFolder: vi.fn().mockResolvedValue(undefined),
      renameFolder: vi.fn().mockResolvedValue(undefined),
      reorderFolders: vi.fn(),
    });
    useDuplicateResolutionDialogMock.mockReturnValue({
      dialog: createDuplicateDialogModel(),
      folderAddResolvedSeq: 0,
      handleFolderAddWithDuplicateCheck: vi.fn().mockResolvedValue(undefined),
      handleFolderRescanWithDuplicateCheck,
    });

    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Rescan Folder" }));

    expect(handleFolderRescanWithDuplicateCheck).toHaveBeenCalledWith(folder);
  });

  it("opens the folder dialog when an external folder dialog request arrives", async () => {
    const folderDialogState = createFolderDialogState();
    useFolderDialogMock.mockReturnValue(folderDialogState);

    renderSidebar({
      folderDialogRequest: 1,
    });

    await waitFor(() =>
      expect(folderDialogState.handleOpenChange).toHaveBeenCalledWith(true),
    );
  });
});
