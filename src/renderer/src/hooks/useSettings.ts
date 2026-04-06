import { useState } from "react";
import type { ThemeId } from "@/lib/themes";
import { isAppLanguage, type AppLanguage } from "@/lib/language";

export interface Settings {
  recentDays: number;
  pageSize: number;
  similarityThreshold: number;
  useAdvancedSimilarityThresholds: boolean;
  visualSimilarityThreshold: number;
  promptSimilarityThreshold: number;
  similarPageSize: number;
  theme: ThemeId;
  language: AppLanguage;
  /** Gallery column count — "auto" uses responsive breakpoints, number overrides to fixed columns (2–8). */
  galleryColumns: "auto" | number;
  /** Gallery virtualization — disabled by default (causes scroll jank from mount/unmount overhead at typical page sizes). Toggle in Debug Panel > Actions. */
  enableVirtualization: boolean;
}

export const DEFAULTS: Settings = {
  recentDays: 7,
  pageSize: 20,
  similarityThreshold: 12,
  useAdvancedSimilarityThresholds: false,
  visualSimilarityThreshold: 12,
  promptSimilarityThreshold: 0.6,
  similarPageSize: 10,
  galleryColumns: "auto",
  theme: "dark",
  language: "system",
  enableVirtualization: false,
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
  if (
    raw.galleryColumns === "auto" ||
    (typeof raw.galleryColumns === "number" &&
      raw.galleryColumns >= 1 &&
      raw.galleryColumns <= 25)
  ) {
    migrated.galleryColumns = raw.galleryColumns;
  }
  if (typeof raw.theme === "string") migrated.theme = raw.theme as ThemeId;
  if (isAppLanguage((raw as { language?: unknown }).language)) {
    migrated.language = raw.language;
  }

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

export function readStoredSettings(): Settings {
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return DEFAULTS;
    const parsed = JSON.parse(stored) as LegacyStoredSettings;
    return { ...DEFAULTS, ...migrateStoredSettings(parsed) };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(readStoredSettings);

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
