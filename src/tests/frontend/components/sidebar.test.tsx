import React, { type ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar, type SidebarHandle } from "@/components/sidebar";
import type { Category, Folder } from "@preload/index.d";

const useDuplicateResolutionDialogMock = vi.fn();
const useFolderDialogMock = vi.fn();

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

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <>{asChild ? children : <button type="button">{children}</button>}</>,
  DropdownMenuContent: ({
    children,
  }: {
    children: React.ReactNode;
    align?: string;
    onCloseAutoFocus?: (e: Event) => void;
  }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
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

type SidebarOverrides = Partial<
  Omit<
    ComponentProps<typeof Sidebar>,
    | "view"
    | "folderState"
    | "folderActions"
    | "categoryState"
    | "categoryActions"
  >
> & {
  view?: Partial<ComponentProps<typeof Sidebar>["view"]>;
  folderState?: Partial<ComponentProps<typeof Sidebar>["folderState"]>;
  folderActions?: Partial<ComponentProps<typeof Sidebar>["folderActions"]>;
  categoryState?: Partial<ComponentProps<typeof Sidebar>["categoryState"]>;
  categoryActions?: Partial<ComponentProps<typeof Sidebar>["categoryActions"]>;
};

function renderSidebar(overrides: SidebarOverrides = {}) {
  const ref = React.createRef<SidebarHandle>();
  const baseProps: ComponentProps<typeof Sidebar> = {
    view: {
      activeView: "all",
      onViewChange: vi.fn(),
    },
    folderState: {
      folders: [createFolder(1), createFolder(2)],
      selectedFolderIds: new Set(),
      rollbackRequest: null,
      scanningFolderIds: new Set(),
      scanning: false,
    },
    folderActions: {
      createFolder: vi.fn(),
      addFolders: vi.fn().mockResolvedValue({ added: [], errors: [] }),
      deleteFolder: vi.fn().mockResolvedValue(undefined),
      renameFolder: vi.fn().mockResolvedValue(undefined),
      reorderFolders: vi.fn(),
      onFolderToggle: vi.fn(),
      onFolderRemoved: vi.fn(),
      onFolderAdded: vi.fn(),
      onFolderCancelled: vi.fn(),
      onFolderRescan: vi.fn(),
    },
    categoryState: {
      categories: [],
      selectedCategoryId: null,
    },
    categoryActions: {
      onCategorySelect: vi.fn(),
      onCategoryCreate: vi.fn(),
      onCategoryRename: vi.fn(),
      onCategoryDelete: vi.fn(),
      onCategoryReorder: vi.fn(),
      onCategoryAddByPrompt: vi.fn(),
      onRandomRefresh: vi.fn(),
    },
    isAnalyzing: false,
  };
  const props: ComponentProps<typeof Sidebar> = {
    ...baseProps,
    ...overrides,
    view: {
      ...baseProps.view,
      ...overrides.view,
    },
    folderState: {
      ...baseProps.folderState,
      ...overrides.folderState,
    },
    folderActions: {
      ...baseProps.folderActions,
      ...overrides.folderActions,
    },
    categoryState: {
      ...baseProps.categoryState,
      ...overrides.categoryState,
    },
    categoryActions: {
      ...baseProps.categoryActions,
      ...overrides.categoryActions,
    },
  };

  return {
    ...render(<Sidebar ref={ref} {...props} />),
    props,
    ref,
  };
}

describe("Sidebar", () => {
  beforeEach(() => {
    useDuplicateResolutionDialogMock.mockReset();
    useDuplicateResolutionDialogMock.mockReturnValue({
      dialog: createDuplicateDialogModel(),
      folderAddResolvedSeq: 0,
      handleFolderAddWithDuplicateCheck: vi.fn().mockResolvedValue(undefined),
      handleFolderRescanWithDuplicateCheck: vi
        .fn()
        .mockResolvedValue(undefined),
    });

    useFolderDialogMock.mockReset();
    useFolderDialogMock.mockReturnValue(createFolderDialogState());
  });

  it("processes rollback requests once per request id", async () => {
    const deleteFolder = vi.fn().mockResolvedValue(undefined);
    const onFolderCancelled = vi.fn();

    const { rerender, props } = renderSidebar({
      folderActions: {
        deleteFolder,
        onFolderCancelled,
      },
      folderState: {
        rollbackRequest: { id: 1, folderIds: [1, 2] },
      },
    });

    await waitFor(() => expect(deleteFolder).toHaveBeenCalledTimes(2));
    expect(onFolderCancelled).toHaveBeenCalledWith(1);
    expect(onFolderCancelled).toHaveBeenCalledWith(2);

    rerender(
      <Sidebar
        {...props}
        folderActions={{
          ...props.folderActions,
          onFolderCancelled,
        }}
        folderState={{
          ...props.folderState,
          rollbackRequest: { id: 1, folderIds: [1, 2] },
        }}
      />,
    );

    await waitFor(() => expect(deleteFolder).toHaveBeenCalledTimes(2));

    rerender(
      <Sidebar
        {...props}
        folderActions={{
          ...props.folderActions,
          onFolderCancelled,
        }}
        folderState={{
          ...props.folderState,
          rollbackRequest: { id: 2, folderIds: [2] },
        }}
      />,
    );

    await waitFor(() => expect(deleteFolder).toHaveBeenCalledTimes(3));
    expect(onFolderCancelled).toHaveBeenCalledTimes(3);
  });

  it("switches views through the provided handler", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();

    renderSidebar({
      view: {
        activeView: "all",
        onViewChange,
      },
      categoryState: {
        selectedCategoryId: 9,
        categories: [createCategory(9, "Portraits")],
      },
    });

    await user.click(screen.getByRole("button", { name: "Recent" }));

    expect(onViewChange).toHaveBeenCalledWith("recent");
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
      categoryState: {
        categories,
        selectedCategoryId: 1,
      },
      categoryActions: {
        onCategorySelect,
        onRandomRefresh,
      },
    });

    await user.click(screen.getByTitle("Pick Again"));
    expect(onRandomRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <Sidebar
        {...props}
        categoryState={{
          ...props.categoryState,
          categories,
          selectedCategoryId: 2,
        }}
        categoryActions={{
          ...props.categoryActions,
          onCategorySelect,
          onRandomRefresh,
        }}
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

    useDuplicateResolutionDialogMock.mockReturnValue({
      dialog: createDuplicateDialogModel(),
      folderAddResolvedSeq: 0,
      handleFolderAddWithDuplicateCheck: vi.fn().mockResolvedValue(undefined),
      handleFolderRescanWithDuplicateCheck,
    });

    renderSidebar({
      folderState: {
        folders: [folder],
      },
    });

    await user.click(screen.getByRole("button", { name: "Rescan Folder" }));

    expect(handleFolderRescanWithDuplicateCheck).toHaveBeenCalledWith(folder);
  });

  it("opens the folder dialog through the imperative handle", async () => {
    const folderDialogState = createFolderDialogState();
    useFolderDialogMock.mockReturnValue(folderDialogState);

    const { ref } = renderSidebar();

    ref.current?.openFolderDialog();

    await waitFor(() =>
      expect(folderDialogState.handleOpenChange).toHaveBeenCalledWith(true),
    );
  });

  it("opens single folder dialog via dropdown menu", async () => {
    const user = userEvent.setup();
    const folderDialogState = createFolderDialogState();
    useFolderDialogMock.mockReturnValue(folderDialogState);

    renderSidebar();

    await user.click(screen.getByText("Add Folder"));

    await waitFor(() =>
      expect(folderDialogState.handleOpenChange).toHaveBeenCalledWith(true),
    );
  });

  it("opens multi-folder dialog via dropdown menu", async () => {
    const user = userEvent.setup();

    renderSidebar();

    await user.click(screen.getByText("Add Multiple Folders"));

    await waitFor(() =>
      expect(
        screen.getByText("Select folders to add"),
      ).toBeInTheDocument(),
    );
  });

  it("adds multiple folders through the multi-folder dialog", async () => {
    const user = userEvent.setup();
    const addFolders = vi.fn().mockResolvedValue({
      added: [createFolder(10, "alpha"), createFolder(11, "beta")],
      errors: [],
    });
    const onFolderAdded = vi.fn();

    window.dialog.selectDirectories = vi
      .fn()
      .mockResolvedValue(["C:\\alpha", "C:\\beta"]);

    renderSidebar({
      folderActions: { addFolders, onFolderAdded },
    });

    // Open multi-folder dialog
    await user.click(screen.getByText("Add Multiple Folders"));

    // Click browse button to select folders
    await user.click(screen.getByText("Select Folders"));

    // Entries should appear
    await waitFor(() => {
      expect(screen.getByText("alpha")).toBeInTheDocument();
      expect(screen.getByText("beta")).toBeInTheDocument();
    });

    // Submit
    await user.click(screen.getByText("Add 2"));

    await waitFor(() => {
      expect(addFolders).toHaveBeenCalledWith([
        "C:\\alpha",
        "C:\\beta",
      ]);
      expect(onFolderAdded).toHaveBeenCalledWith(10);
      expect(onFolderAdded).toHaveBeenCalledWith(11);
    });
  });

  it("removes individual entries from multi-folder dialog", async () => {
    const user = userEvent.setup();

    window.dialog.selectDirectories = vi
      .fn()
      .mockResolvedValue(["C:\\alpha", "C:\\beta"]);

    renderSidebar();

    await user.click(screen.getByText("Add Multiple Folders"));
    await user.click(screen.getByText("Select Folders"));

    await waitFor(() => {
      expect(screen.getByText("alpha")).toBeInTheDocument();
    });

    // Remove first entry via X button
    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector(".lucide-x") !== null,
    );
    if (removeButtons.length > 0) {
      await user.click(removeButtons[0]);
    }

    await waitFor(() => {
      expect(screen.queryByText("alpha")).not.toBeInTheDocument();
      expect(screen.getByText("beta")).toBeInTheDocument();
    });
  });

  it("deduplicates paths when browsing multiple times in multi-folder dialog", async () => {
    const user = userEvent.setup();
    const selectDirectories = vi.fn();
    window.dialog.selectDirectories = selectDirectories;

    selectDirectories.mockResolvedValueOnce(["C:\\alpha"]);

    renderSidebar();

    await user.click(screen.getByText("Add Multiple Folders"));
    await user.click(screen.getByText("Select Folders"));

    await waitFor(() => {
      expect(screen.getByText("alpha")).toBeInTheDocument();
    });

    // Browse again with overlapping path
    selectDirectories.mockResolvedValueOnce(["C:\\alpha", "C:\\gamma"]);
    await user.click(screen.getByText("Select Folders"));

    await waitFor(() => {
      expect(screen.getByText("gamma")).toBeInTheDocument();
    });

    // "alpha" should appear only once
    const alphaElements = screen.getAllByText("alpha");
    expect(alphaElements).toHaveLength(1);
  });
});
