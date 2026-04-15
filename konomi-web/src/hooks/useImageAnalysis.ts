import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Settings } from "@/hooks/useSettings";
import i18n from "@/lib/i18n";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useImageAnalysis");

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

  const analyzingRef = useRef(false);
  const analyzeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analysisPromiseRef = useRef<Promise<boolean> | null>(null);
  const suspendAutoAnalysisRef = useRef(false);
  const pendingSimilarityRecalcRef = useRef(false);

  // Getter functions — replace ref sync useEffect.
  // Consumers call these instead of reading .current from refs.
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

  useEffect(() => {
    return () => {
      if (analyzeTimerRef.current) {
        clearTimeout(analyzeTimerRef.current);
        analyzeTimerRef.current = null;
      }
    };
  }, []);

  const runAnalysisNow = useCallback((): Promise<boolean> => {
    if (analysisPromiseRef.current) return analysisPromiseRef.current;

    const run = (async (): Promise<boolean> => {
      if (scanningRef.current) return false;

      const startedAt = Date.now();
      log.info("Analysis started");
      analyzingRef.current = true;
      setIsAnalyzing(true);
      try {
        await window.image.computeHashes();
        const groups = await window.image.similarGroups(
          getVisualThreshold(),
          getPromptThreshold(),
        );
        setSimilarGroupCount(groups.length);
        pendingSimilarityRecalcRef.current = false;
        setHasAnalyzedOnce(true);
        log.info("Analysis completed", {
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
        analyzingRef.current = false;
        setIsAnalyzing(false);
        analysisPromiseRef.current = null;
      }
    })();

    analysisPromiseRef.current = run;
    return run;
  }, [scanningRef, getVisualThreshold, getPromptThreshold]);

  const scheduleAnalysis = useCallback(
    (delay = 3000) => {
      if (suspendAutoAnalysisRef.current) return;
      if (analyzeTimerRef.current) clearTimeout(analyzeTimerRef.current);
      analyzeTimerRef.current = setTimeout(async () => {
        if (suspendAutoAnalysisRef.current) return;
        if (scanningRef.current) {
          log.debug("Analysis delayed because scan is running");
          scheduleAnalysis(1000);
          return;
        }
        await runAnalysisNow();
      }, delay);
    },
    [runAnalysisNow, scanningRef],
  );

  return {
    isAnalyzing,
    hasAnalyzedOnce,
    similarGroupCount,
    analyzeTimerRef,
    pendingSimilarityRecalcRef,
    getVisualThreshold,
    getPromptThreshold,
    suspendAutoAnalysisRef,
    runAnalysisNow,
    scheduleAnalysis,
  };
}
