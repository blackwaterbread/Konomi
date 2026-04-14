import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFolderSelection } from "@/hooks/useFolderSelection";
import { useFolderController } from "@/hooks/useFolderController";
import { preloadMocks } from "../helpers/preload-mocks";
import type { Folder } from "@preload/index.d";

function sortedIds(ids: Set<number>): number[] {
  return [...ids].sort((a, b) => a - b);
}

function createFolder(id: number, name = `Folder ${id}`): Folder {
  return {
    id,
    name,
    path: `C:\\images\\folder-${id}`,
    createdAt: new Date("2026-03-20T12:00:00.000Z"),
  };
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

describe("useFolderController", () => {
  it("combines folder loading with persisted selection state", async () => {
    localStorage.setItem("konomi-selected-folders", JSON.stringify([3]));
    preloadMocks.folder.list.mockResolvedValue([
      createFolder(1, "Primary"),
      createFolder(2, "Reference"),
    ]);

    const { result } = renderHook(() => useFolderController(5));

    expect(result.current.folderCount).toBe(5);
    expect(sortedIds(result.current.selectedFolderIds)).toEqual([3]);

    await waitFor(() =>
      expect(result.current.folders.map((folder) => folder.id)).toEqual([1, 2]),
    );
    expect(result.current.folderCount).toBe(2);

    act(() => {
      result.current.toggleFolder(9);
    });

    expect(sortedIds(result.current.selectedFolderIds)).toEqual([3, 9]);
    await waitFor(() =>
      expect(localStorage.getItem("konomi-selected-folders")).toBe("[3,9]"),
    );
  });
});
