import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { MutableRefObject } from "react";
import type { Settings } from "@/hooks/useSettings";

const SIMILARITY_SETTING_KEYS = new Set<keyof Settings>([
  "similarityThreshold",
  "useAdvancedSimilarityThresholds",
  "visualSimilarityThreshold",
  "promptSimilarityThreshold",
]);

function isSimilaritySettingsPatch(patch: Partial<Settings>): boolean {
  return (Object.keys(patch) as Array<keyof Settings>).some((key) =>
    SIMILARITY_SETTING_KEYS.has(key),
  );
}

function includesSimilaritySettingsReset(keys?: (keyof Settings)[]): boolean {
  if (!keys || keys.length === 0) return true;
  return keys.some((key) => SIMILARITY_SETTING_KEYS.has(key));
}

interface UseSettingsAnalysisControllerOptions {
  updateSettings: (patch: Partial<Settings>) => void;
  resetSettings: (keys?: (keyof Settings)[]) => void;
  scanningRef: MutableRefObject<boolean>;
  analyzeTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  pendingSimilarityRecalcRef: MutableRefObject<boolean>;
  suspendAutoAnalysisRef: MutableRefObject<boolean>;
  runAnalysisNow: () => Promise<boolean>;
}

export function useSettingsAnalysisController({
  updateSettings,
  resetSettings,
  scanningRef,
  analyzeTimerRef,
  pendingSimilarityRecalcRef,
  suspendAutoAnalysisRef,
  runAnalysisNow,
}: UseSettingsAnalysisControllerOptions) {
  const { t } = useTranslation();

  const handleSettingsUpdate = useCallback(
    (patch: Partial<Settings>) => {
      updateSettings(patch);
      if (isSimilaritySettingsPatch(patch)) {
        pendingSimilarityRecalcRef.current = true;
      }
    },
    [pendingSimilarityRecalcRef, updateSettings],
  );

  const handleSettingsReset = useCallback(
    (keys?: (keyof Settings)[]) => {
      resetSettings(keys);
      if (includesSimilaritySettingsReset(keys)) {
        pendingSimilarityRecalcRef.current = true;
      }
    },
    [pendingSimilarityRecalcRef, resetSettings],
  );

  const handleResetHashes = useCallback(async () => {
    try {
      if (scanningRef.current) {
        toast.error(t("error.scanInProgressForHashReset"));
        return;
      }

      suspendAutoAnalysisRef.current = true;
      pendingSimilarityRecalcRef.current = false;
      if (analyzeTimerRef.current) {
        clearTimeout(analyzeTimerRef.current);
        analyzeTimerRef.current = null;
      }
      await window.image.resetHashes();
      await runAnalysisNow();
    } catch (error: unknown) {
      toast.error(
        t("error.hashResetFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      suspendAutoAnalysisRef.current = false;
    }
  }, [
    analyzeTimerRef,
    pendingSimilarityRecalcRef,
    runAnalysisNow,
    scanningRef,
    suspendAutoAnalysisRef,
    t,
  ]);

  return {
    handleSettingsUpdate,
    handleSettingsReset,
    handleResetHashes,
  };
}
