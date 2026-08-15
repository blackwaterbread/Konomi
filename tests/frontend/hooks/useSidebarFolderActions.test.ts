import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useSidebarFolderActions } from "@/hooks/useSidebarFolderActions";

function renderSidebarFolderActions(options?: {
  isAnalyzing?: boolean;
  scanning?: boolean;
  runScanResult?: { ok: boolean; cancelled: boolean };
}) {
  const runScan = vi
    .fn()
    .mockResolvedValue(options?.runScanResult ?? { ok: true, cancelled: false });
  const scanningRef = { current: options?.scanning ?? false };

  const { result } = renderHook(() => {
    const [selectedFolderIds, setSelectedFolderIds] = useState<Set<number>>(
      new Set(),
    );
    const [activeScanFolderIds, setActiveScanFolderIds] = useState<Set<number>>(
      new Set(),
    );
    const [activeScanSubPaths, setActiveScanSubPaths] = useState<Set<string>>(
      new Set(),
    );
    const [rollbackFolderIds, setRollbackFolderIds] = useState<Set<number>>(
      new Set(),
    );

    const addSelectedFolder = useCallback((id: number) => {
      setSelectedFolderIds((prev) => new Set([...prev, id]));
    }, []);

    const removeSelectedFolder = useCallback((id: number) => {
      setSelectedFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, []);

    const actions = useSidebarFolderActions({
      isAnalyzing: options?.isAnalyzing ?? false,
      addSelectedFolder,
      removeSelectedFolder,
      runScan,
      scanningRef,
      setActiveScanFolderIds,
      setActiveScanSubPaths,
      setRollbackFolderIds,
      refreshSubfolders: async () => {},
    });

    return {
      ...actions,
      selectedFolderIds,
      activeScanFolderIds,
      activeScanSubPaths,
      rollbackFolderIds,
    };
  });

  return {
    result,
    runScan,
  };
}

describe("useSidebarFolderActions", () => {
  it("adds a folder into selection and clears rollback state after a successful scan", async () => {
    const { result, runScan } = renderSidebarFolderActions();

    act(() => {
      result.current.handleFolderAdded(7);
    });

    expect(result.current.selectedFolderIds.has(7)).toBe(true);
    expect(result.current.activeScanFolderIds.has(7)).toBe(true);
    expect(result.current.rollbackFolderIds.has(7)).toBe(true);
    expect(runScan).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(result.current.rollbackFolderIds.has(7)).toBe(false),
    );
  });

  it("removes folders from selection and scan state when cancelled or removed", async () => {
    const { result, runScan } = renderSidebarFolderActions();

    act(() => {
      result.current.handleFolderAdded(9);
    });

    await waitFor(() =>
      expect(result.current.selectedFolderIds.has(9)).toBe(true),
    );

    act(() => {
      result.current.handleFolderCancelled(9);
    });

    expect(result.current.selectedFolderIds.has(9)).toBe(false);
    expect(result.current.activeScanFolderIds.has(9)).toBe(false);
    expect(result.current.rollbackFolderIds.has(9)).toBe(false);

    act(() => {
      result.current.handleFolderAdded(11);
    });

    await waitFor(() =>
      expect(result.current.selectedFolderIds.has(11)).toBe(true),
    );

    runScan.mockClear();

    act(() => {
      result.current.handleFolderRemoved(11);
    });

    expect(result.current.selectedFolderIds.has(11)).toBe(false);
    expect(result.current.activeScanFolderIds.has(11)).toBe(false);
    expect(result.current.rollbackFolderIds.has(11)).toBe(false);
    expect(runScan).toHaveBeenCalledTimes(1);
  });

  it("rescans only when neither scanning nor analysis is already running", async () => {
    const idle = renderSidebarFolderActions();

    act(() => {
      idle.result.current.handleFolderRescan(5);
    });

    expect(idle.result.current.activeScanFolderIds.has(5)).toBe(true);
    expect(idle.runScan).toHaveBeenCalledWith({ folderIds: [5] });

    const scanning = renderSidebarFolderActions({ scanning: true });
    act(() => {
      scanning.result.current.handleFolderRescan(6);
    });
    expect(scanning.runScan).not.toHaveBeenCalled();

    const analyzing = renderSidebarFolderActions({ isAnalyzing: true });
    act(() => {
      analyzing.result.current.handleFolderRescan(7);
    });
    expect(analyzing.runScan).not.toHaveBeenCalled();
  });

  it("scopes a subfolder rescan to its subtree and marks it active under a separator-folded key", () => {
    const idle = renderSidebarFolderActions();

    act(() => {
      idle.result.current.handleSubfolderRescan(3, "C:\\Lib\\Alpha");
    });

    expect(idle.runScan).toHaveBeenCalledWith({
      folderIds: [3],
      // The path goes to the backend untouched — it already carries the
      // on-disk spelling `getSubfolderPaths` reported.
      subPaths: ["C:\\Lib\\Alpha"],
    });
    // Only separators are folded: `image:scanFolder` echoes that same
    // spelling, so case must survive or two sibling subfolders that differ
    // only by case would share one spinner.
    expect(idle.result.current.activeScanSubPaths.has("C:/Lib/Alpha")).toBe(
      true,
    );
    expect(idle.result.current.activeScanFolderIds.has(3)).toBe(true);
  });

  it("does not start a subfolder rescan while scanning or analysing", () => {
    const scanning = renderSidebarFolderActions({ scanning: true });
    act(() => {
      scanning.result.current.handleSubfolderRescan(3, "C:\\Lib\\Alpha");
    });
    expect(scanning.runScan).not.toHaveBeenCalled();
    expect(scanning.result.current.activeScanSubPaths.size).toBe(0);

    const analyzing = renderSidebarFolderActions({ isAnalyzing: true });
    act(() => {
      analyzing.result.current.handleSubfolderRescan(3, "C:\\Lib\\Alpha");
    });
    expect(analyzing.runScan).not.toHaveBeenCalled();
    expect(analyzing.result.current.activeScanSubPaths.size).toBe(0);
  });
});
