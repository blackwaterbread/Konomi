import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { SimilarGroup } from "@preload/index.d";
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
  const [similarGroups, setSimilarGroups] = useState<SimilarGroup[]>([]);

  const analyzingRef = useRef(false);
  const analyzeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analysisPromiseRef = useRef<Promise<boolean> | null>(null);
  const suspendAutoAnalysisRef = useRef(false);
  const visualThresholdRef = useRef(settings.similarityThreshold);
  const promptThresholdRef = useRef<number | undefined>(undefined);
  const pendingSimilarityRecalcRef = useRef(false);

  useEffect(() => {
    visualThresholdRef.current = settings.useAdvancedSimilarityThresholds
      ? settings.visualSimilarityThreshold
      : settings.similarityThreshold;
    promptThresholdRef.current = settings.useAdvancedSimilarityThresholds
      ? settings.promptSimilarityThreshold
      : undefined;
  }, [
    settings.similarityThreshold,
    settings.useAdvancedSimilarityThresholds,
    settings.visualSimilarityThreshold,
    settings.promptSimilarityThreshold,
  ]);

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
          visualThresholdRef.current,
          promptThresholdRef.current,
        );
        setSimilarGroups(groups);
        pendingSimilarityRecalcRef.current = false;
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
  }, [scanningRef]);

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
    similarGroups,
    setSimilarGroups,
    analyzeTimerRef,
    pendingSimilarityRecalcRef,
    visualThresholdRef,
    promptThresholdRef,
    suspendAutoAnalysisRef,
    runAnalysisNow,
    scheduleAnalysis,
  };
}
