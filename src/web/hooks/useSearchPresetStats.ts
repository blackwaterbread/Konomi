import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useSearchPresetStats");

export function useSearchPresetStats() {
  const [availableResolutions, setAvailableResolutions] = useState<
    Array<{ width: number; height: number }>
  >([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const searchStatsRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const loadSearchPresetStats = useCallback(async () => {
    try {
      const stats = await window.image.getSearchPresetStats();
      startTransition(() => {
        setAvailableResolutions(stats.availableResolutions);
        setAvailableModels(stats.availableModels);
      });
    } catch (error: unknown) {
      log.warn("Failed to load search preset stats", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const scheduleSearchStatsRefresh = useCallback(
    (delay = 220) => {
      if (searchStatsRefreshTimerRef.current) {
        clearTimeout(searchStatsRefreshTimerRef.current);
      }
      searchStatsRefreshTimerRef.current = setTimeout(() => {
        searchStatsRefreshTimerRef.current = null;
        void loadSearchPresetStats();
      }, delay);
    },
    [loadSearchPresetStats],
  );

  useEffect(() => {
    return () => {
      if (searchStatsRefreshTimerRef.current) {
        clearTimeout(searchStatsRefreshTimerRef.current);
        searchStatsRefreshTimerRef.current = null;
      }
    };
  }, []);

  return {
    availableResolutions,
    availableModels,
    loadSearchPresetStats,
    scheduleSearchStatsRefresh,
  };
}
