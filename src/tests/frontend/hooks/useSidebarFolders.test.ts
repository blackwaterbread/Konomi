import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFolderSelection } from "@/hooks/useFolderSelection";
import { useSidebarFolders } from "@/hooks/useSidebarFolders";

function sortedIds(ids: Set<number>): number[] {
  return [...ids].sort((a, b) => a - b);
}

describe("useFolderSelection", () => {
  it("hydrates folder selection from storage and persists toggle/add/remove changes", async () => {
    localStorage.setItem("konomi-selected-folders", JSON.stringify([4, 2]));

    const { result } = renderHook(() => useFolderSelection());

    expect(sortedIds(result.current.selectedFolderIds)).toEqual([2, 4]);

    act(() => {
      result.current.toggleFolder(2);
      result.current.addSelectedFolder(8);
      result.current.removeSelectedFolder(4);
    });

    expect(sortedIds(result.current.selectedFolderIds)).toEqual([8]);
    await waitFor(() =>
      expect(localStorage.getItem("konomi-selected-folders")).toBe("[8]"),
    );
  });
});

describe("useSidebarFolders", () => {
  it("tracks folder count and folder-dialog requests alongside selection state", async () => {
    localStorage.setItem("konomi-selected-folders", JSON.stringify([3]));

    const { result } = renderHook(() => useSidebarFolders(5));

    expect(result.current.folderCount).toBe(5);
    expect(result.current.folderDialogRequest).toBe(0);
    expect(sortedIds(result.current.selectedFolderIds)).toEqual([3]);

    act(() => {
      result.current.requestFolderDialog();
      result.current.requestFolderDialog();
      result.current.setFolderCount(8);
      result.current.toggleFolder(9);
    });

    expect(result.current.folderCount).toBe(8);
    expect(result.current.folderDialogRequest).toBe(2);
    expect(sortedIds(result.current.selectedFolderIds)).toEqual([3, 9]);
    await waitFor(() =>
      expect(localStorage.getItem("konomi-selected-folders")).toBe("[3,9]"),
    );
  });
});
