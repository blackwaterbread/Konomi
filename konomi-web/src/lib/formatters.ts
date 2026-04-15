import { useTranslation } from "react-i18next";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function useLocaleFormatters() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || "en";

  return {
    locale,
    formatNumber(value: number): string {
      return new Intl.NumberFormat(locale).format(value);
    },
    formatDate(value: Date | string): string {
      return new Intl.DateTimeFormat(locale).format(toDate(value));
    },
    formatDateTime(value: Date | string): string {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(toDate(value));
    },
  };
}
