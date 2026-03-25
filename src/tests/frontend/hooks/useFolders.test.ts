import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFolders } from "@/hooks/useFolders";
import { preloadMocks } from "../helpers/preload-mocks";
import type { Folder } from "@preload/index.d";

function createFolder(id: number, name = `Folder ${id}`): Folder {
  return {
    id,
    name,
    path: `C:\\images\\folder-${id}`,
    createdAt: new Date("2026-03-20T12:00:00.000Z"),
  };
}

describe("useFolders", () => {
  describe("addFolders", () => {
    it("creates multiple folders and reloads list", async () => {
      const f1 = createFolder(10, "alpha");
      const f2 = createFolder(11, "beta");

      preloadMocks.folder.create
        .mockResolvedValueOnce(f1)
        .mockResolvedValueOnce(f2);
      preloadMocks.folder.list.mockResolvedValue([f1, f2]);

      const { result } = renderHook(() => useFolders());

      await waitFor(() => expect(result.current.hasLoaded).toBe(true));

      const res = await result.current.addFolders([
        "C:\\images\\alpha",
        "C:\\images\\beta",
      ]);

      expect(res.added).toEqual([f1, f2]);
      expect(res.errors).toEqual([]);
      expect(preloadMocks.folder.create).toHaveBeenCalledWith(
        "alpha",
        "C:\\images\\alpha",
      );
      expect(preloadMocks.folder.create).toHaveBeenCalledWith(
        "beta",
        "C:\\images\\beta",
      );

      await waitFor(() =>
        expect(result.current.folders.map((f) => f.id)).toEqual([10, 11]),
      );
    });

    it("extracts folder name from path with trailing slashes", async () => {
      const f1 = createFolder(20, "mydir");
      preloadMocks.folder.create.mockResolvedValueOnce(f1);
      preloadMocks.folder.list.mockResolvedValue([f1]);

      const { result } = renderHook(() => useFolders());
      await waitFor(() => expect(result.current.hasLoaded).toBe(true));

      await result.current.addFolders(["C:\\some\\path\\mydir\\"]);

      expect(preloadMocks.folder.create).toHaveBeenCalledWith(
        "mydir",
        "C:\\some\\path\\mydir\\",
      );
    });

    it("collects errors for failed folders and still adds successful ones", async () => {
      const f1 = createFolder(30, "good");
      preloadMocks.folder.create
        .mockResolvedValueOnce(f1)
        .mockRejectedValueOnce(new Error("duplicate path"));
      preloadMocks.folder.list.mockResolvedValue([f1]);

      const { result } = renderHook(() => useFolders());
      await waitFor(() => expect(result.current.hasLoaded).toBe(true));

      const res = await result.current.addFolders([
        "C:\\images\\good",
        "C:\\images\\bad",
      ]);

      expect(res.added).toEqual([f1]);
      expect(res.errors).toEqual([
        { path: "C:\\images\\bad", message: "duplicate path" },
      ]);
    });

    it("skips reload when all folders fail", async () => {
      preloadMocks.folder.create.mockRejectedValue(new Error("fail"));
      const listCallCount = preloadMocks.folder.list.mock.calls.length;

      const { result } = renderHook(() => useFolders());
      await waitFor(() => expect(result.current.hasLoaded).toBe(true));

      const initialListCalls = preloadMocks.folder.list.mock.calls.length;

      const res = await result.current.addFolders(["C:\\images\\bad"]);

      expect(res.added).toEqual([]);
      expect(res.errors).toHaveLength(1);
      // list should NOT have been called again after the failed addFolders
      expect(preloadMocks.folder.list.mock.calls.length).toBe(
        initialListCalls,
      );
    });
  });
});
