import { useState, useCallback } from "react";

interface PendingState {
  netDelta: number;
  maxBatchId: number;
}

export function usePendingChanges() {
  const [state, setState] = useState<PendingState>({
    netDelta: 0,
    maxBatchId: 0,
  });

  const addPending = useCallback(
    (added: number, removed: number, maxId?: number) => {
      setState((prev) => ({
        netDelta: prev.netDelta + added - removed,
        maxBatchId:
          maxId !== undefined
            ? Math.max(prev.maxBatchId, maxId)
            : prev.maxBatchId,
      }));
    },
    [],
  );

  const clearPending = useCallback(() => {
    setState({ netDelta: 0, maxBatchId: 0 });
  }, []);

  return {
    netDelta: state.netDelta,
    maxBatchId: state.maxBatchId,
    addPending,
    clearPending,
  };
}
