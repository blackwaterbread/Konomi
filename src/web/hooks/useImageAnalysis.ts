import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Settings } from "@/hooks/useSettings";
import i18n from "@/lib/i18n";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useImageAnalysis");

/**
 * UI state hook for the maintenance/analysis run.
 *
 * Auto-trigger logic now lives in the core maintenance service, which runs
 * inside the Electron utility process or the Fastify server. This hook is a
 * thin subscriber: it tracks whether a run is active (via the
 * `image:analysisActive` push event) and exposes a manual trigger
 * (`runAnalysisNow`) for explicit user actions like the settings panel
 * "지금 분석" button.
 *
 * Threshold settings still live here because `getSimilarGroups` is a
 * threshold-aware DB query — that part is intentionally kept on the client.
 */
export function useImageAnalysis({
  scanningRef,
  settings,
}: {
  scanningRef: React.MutableRefObject<boolean>;
  settings: Settings;
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalyzedOnce, setHasAnalyzedOnce] = useState(false);
  const [similarGroupCount, setSimilarGroupCount] = useState(0);

  const analysisPromiseRef = useRef<Promise<boolean> | null>(null);
  const pendingSimilarityRecalcRef = useRef(false);

  const getVisualThreshold = useCallback(
    () =>
      settings.useAdvancedSimilarityThresholds
        ? settings.visualSimilarityThreshold
        : settings.similarityThreshold,
    [
      settings.similarityThreshold,
      settings.useAdvancedSimilarityThresholds,
      settings.visualSimilarityThreshold,
    ],
  );

  const getPromptThreshold = useCallback(
    () =>
      settings.useAdvancedSimilarityThresholds
        ? settings.promptSimilarityThreshold
        : undefined,
    [
      settings.useAdvancedSimilarityThresholds,
      settings.promptSimilarityThreshold,
    ],
  );

  // Subscribe to maintenance run lifecycle from core. Auto-triggered runs
  // (after scan, after watcher batch events) only surface to the UI through
  // these events.
  useEffect(() => {
    const off = window.image.onAnalysisActive(({ active }) => {
      setIsAnalyzing(active);
      if (!active) setHasAnalyzedOnce(true);
    });
    return () => {
      off();
    };
  }, []);

  const runAnalysisNow = useCallback((): Promise<boolean> => {
    if (analysisPromiseRef.current) return analysisPromiseRef.current;

    const run = (async (): Promise<boolean> => {
      if (scanningRef.current) return false;

      const startedAt = Date.now();
      log.info("Analysis triggered manually");
      try {
        await window.image.computeHashes();
        const groups = await window.image.similarGroups(
          getVisualThreshold(),
          getPromptThreshold(),
        );
        setSimilarGroupCount(groups.length);
        pendingSimilarityRecalcRef.current = false;
        log.info("Manual analysis completed", {
          elapsedMs: Date.now() - startedAt,
          groups: groups.length,
        });
        return true;
      } catch (e: unknown) {
        log.error("Analysis failed", {
          elapsedMs: Date.now() - startedAt,
          error: e instanceof Error ? e.message : String(e),
        });
        toast.error(
          i18n.t("error.analysisFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
        return false;
      } finally {
        analysisPromiseRef.current = null;
      }
    })();

    analysisPromiseRef.current = run;
    return run;
  }, [scanningRef, getVisualThreshold, getPromptThreshold]);

  return {
    isAnalyzing,
    hasAnalyzedOnce,
    similarGroupCount,
    pendingSimilarityRecalcRef,
    getVisualThreshold,
    getPromptThreshold,
    runAnalysisNow,
  };
}
