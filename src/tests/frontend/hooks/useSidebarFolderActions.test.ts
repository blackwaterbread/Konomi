import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useSidebarFolderActions } from "@/hooks/useSidebarFolderActions";

function renderSidebarFolderActions(options?: {
  isAnalyzing?: boolean;
  scanning?: boolean;
  runScanResult?: boolean;
}) {
  const runScan = vi.fn().mockResolvedValue(options?.runScanResult ?? true);
  const scheduleAnalysis = vi.fn();
  const scanningRef = { current: options?.scanning ?? false };

  const { result } = renderHook(() => {
    const [selectedFolderIds, setSelectedFolderIds] = useState<Set<number>>(
      new Set(),
    );
    const [activeScanFolderIds, setActiveScanFolderIds] = useState<Set<number>>(
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
      scheduleAnalysis,
      setActiveScanFolderIds,
      setRollbackFolderIds,
    });

    return {
      ...actions,
      selectedFolderIds,
      activeScanFolderIds,
      rollbackFolderIds,
    };
  });

  return {
    result,
    runScan,
    scheduleAnalysis,
  };
}

describe("useSidebarFolderActions", () => {
  it("adds a folder into selection and clears rollback state after a successful scan", async () => {
    const { result, runScan, scheduleAnalysis } =
      renderSidebarFolderActions();

    act(() => {
      result.current.handleFolderAdded(7);
    });

    expect(result.current.selectedFolderIds.has(7)).toBe(true);
    expect(result.current.activeScanFolderIds.has(7)).toBe(true);
    expect(result.current.rollbackFolderIds.has(7)).toBe(true);
    expect(runScan).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(scheduleAnalysis).toHaveBeenCalledWith(0));
    expect(result.current.rollbackFolderIds.has(7)).toBe(false);
  });

  it("removes folders from selection and scan state when cancelled or removed", async () => {
    const { result, runScan, scheduleAnalysis } =
      renderSidebarFolderActions();

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
    expect(scheduleAnalysis).toHaveBeenCalledWith(500);

    act(() => {
      result.current.handleFolderAdded(11);
    });

    await waitFor(() =>
      expect(result.current.selectedFolderIds.has(11)).toBe(true),
    );

    runScan.mockClear();
    scheduleAnalysis.mockClear();

    act(() => {
      result.current.handleFolderRemoved(11);
    });

    expect(result.current.selectedFolderIds.has(11)).toBe(false);
    expect(result.current.activeScanFolderIds.has(11)).toBe(false);
    expect(result.current.rollbackFolderIds.has(11)).toBe(false);
    expect(runScan).toHaveBeenCalledTimes(1);
    expect(scheduleAnalysis).toHaveBeenCalledWith(500);
  });

  it("rescans only when neither scanning nor analysis is already running", async () => {
    const idle = renderSidebarFolderActions();

    act(() => {
      idle.result.current.handleFolderRescan(5);
    });

    expect(idle.result.current.activeScanFolderIds.has(5)).toBe(true);
    expect(idle.runScan).toHaveBeenCalledWith({ folderIds: [5] });
    await waitFor(() => expect(idle.scheduleAnalysis).toHaveBeenCalledWith(0));

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
});
