import { useState } from "react";
import type { ThemeId } from "@/lib/themes";

export interface Settings {
  recentDays: number;
  pageSize: number;
  similarityThreshold: number;
  useAdvancedSimilarityThresholds: boolean;
  visualSimilarityThreshold: number;
  promptSimilarityThreshold: number;
  similarPageSize: number;
  theme: ThemeId;
}

export const DEFAULTS: Settings = {
  recentDays: 7,
  pageSize: 20,
  similarityThreshold: 12,
  useAdvancedSimilarityThresholds: false,
  visualSimilarityThreshold: 12,
  promptSimilarityThreshold: 0.6,
  similarPageSize: 10,
  theme: "auto",
};

const KEY = "konomi-settings";

type LegacyStoredSettings = Partial<Settings> & {
  jaccardThreshold?: number;
};

function migrateStoredSettings(raw: LegacyStoredSettings): Partial<Settings> {
  const migrated: Partial<Settings> = {};

  if (typeof raw.recentDays === "number") migrated.recentDays = raw.recentDays;
  if (typeof raw.pageSize === "number") migrated.pageSize = raw.pageSize;
  if (typeof raw.similarityThreshold === "number") {
    migrated.similarityThreshold = raw.similarityThreshold;
  }
  if (typeof raw.similarPageSize === "number") {
    migrated.similarPageSize = raw.similarPageSize;
  }
  if (typeof raw.theme === "string") migrated.theme = raw.theme as ThemeId;

  if (
    typeof raw.promptSimilarityThreshold !== "number" &&
    typeof raw.jaccardThreshold === "number"
  ) {
    migrated.promptSimilarityThreshold = raw.jaccardThreshold;
  }

  if (
    typeof raw.visualSimilarityThreshold !== "number" &&
    typeof raw.similarityThreshold === "number"
  ) {
    migrated.visualSimilarityThreshold = raw.similarityThreshold;
  } else if (typeof raw.visualSimilarityThreshold === "number") {
    migrated.visualSimilarityThreshold = raw.visualSimilarityThreshold;
  }

  if (typeof raw.promptSimilarityThreshold === "number") {
    migrated.promptSimilarityThreshold = raw.promptSimilarityThreshold;
  }

  if (typeof raw.useAdvancedSimilarityThresholds !== "boolean") {
    migrated.useAdvancedSimilarityThresholds =
      typeof raw.jaccardThreshold === "number" &&
      raw.jaccardThreshold !== DEFAULTS.promptSimilarityThreshold;
  }

  return migrated;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (!stored) return DEFAULTS;
      const parsed = JSON.parse(stored) as LegacyStoredSettings;
      return { ...DEFAULTS, ...migrateStoredSettings(parsed) };
    } catch {
      return DEFAULTS;
    }
  });

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  };

  const resetSettings = (keys?: (keyof Settings)[]) => {
    setSettings((prev) => {
      const next = keys
        ? { ...prev, ...Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]])) }
        : { ...DEFAULTS };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next as Settings;
    });
  };

  return { settings, updateSettings, resetSettings };
}
