import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { AppLanguage, ResolvedAppLanguage } from "@/lib/language";
import { normalizeResolvedAppLanguage } from "@/lib/language";
import en from "@/lib/locales/en";
import ko from "@/lib/locales/ko";

const resources = {
  ko: { translation: ko },
  en: { translation: en },
} as const;

const initialLanguage = normalizeResolvedAppLanguage(
  typeof navigator !== "undefined" ? navigator.language : "en",
);

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: "en",
  // 이거 안꺼놓으면 자꾸 Locize 광고 나옴.
  showSupportNotice: false,
  interpolation: {
    escapeValue: false,
  },
});

async function resolveLanguage(
  language: AppLanguage,
): Promise<ResolvedAppLanguage> {
  if (language !== "system") return language;

  try {
    return normalizeResolvedAppLanguage(await window.appInfo.getLocale());
  } catch {
    return normalizeResolvedAppLanguage(
      typeof navigator !== "undefined" ? navigator.language : "en",
    );
  }
}

export async function applyAppLanguagePreference(
  language: AppLanguage,
): Promise<ResolvedAppLanguage> {
  const next = await resolveLanguage(language);
  if (i18n.resolvedLanguage !== next) {
    await i18n.changeLanguage(next);
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
  }
  return next;
}

export default i18n;
