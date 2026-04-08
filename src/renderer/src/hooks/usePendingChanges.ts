import { useState, useCallback } from "react";

export interface PendingChanges {
  added: number;
  removed: number;
}

export function usePendingChanges() {
  const [pending, setPending] = useState<PendingChanges>({
    added: 0,
    removed: 0,
  });

  const addPending = useCallback((added: number, removed: number) => {
    setPending((prev) => ({
      added: prev.added + added,
      removed: prev.removed + removed,
    }));
  }, []);

  const clearPending = useCallback(() => {
    setPending({ added: 0, removed: 0 });
  }, []);

  return { pending, addPending, clearPending };
}
