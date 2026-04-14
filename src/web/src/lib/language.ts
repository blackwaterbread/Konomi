export const SUPPORTED_APP_LANGUAGES = ["system", "ko", "en"] as const;

export type AppLanguage = (typeof SUPPORTED_APP_LANGUAGES)[number];
export type ResolvedAppLanguage = Exclude<AppLanguage, "system">;

export function isAppLanguage(value: unknown): value is AppLanguage {
  return (
    typeof value === "string" &&
    SUPPORTED_APP_LANGUAGES.includes(value as AppLanguage)
  );
}

export function normalizeResolvedAppLanguage(
  locale: string | null | undefined,
): ResolvedAppLanguage {
  const normalized = (locale ?? "").toLowerCase();
  return normalized.startsWith("ko") ? "ko" : "en";
}
