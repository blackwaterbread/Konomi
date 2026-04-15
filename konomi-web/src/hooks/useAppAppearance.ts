import { useEffect, useState } from "react";
import type { Settings } from "@/hooks/useSettings";
import { applyAppLanguagePreference } from "@/lib/i18n";

function resolveIsDarkTheme(theme: Settings["theme"] | undefined): boolean {
  const resolvedTheme = theme ?? "dark";
  if (resolvedTheme === "auto") {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  return resolvedTheme === "dark";
}

interface UseAppAppearanceOptions {
  theme: Settings["theme"] | undefined;
  language: Settings["language"];
}

export function useAppAppearance({ theme, language }: UseAppAppearanceOptions) {
  const [isDarkTheme, setIsDarkTheme] = useState(() =>
    resolveIsDarkTheme(theme),
  );

  useEffect(() => {
    void applyAppLanguagePreference(language);
  }, [language]);

  useEffect(() => {
    const resolvedTheme = theme ?? "dark";
    const applyTheme = (isDark: boolean) => {
      document.documentElement.dataset.theme = isDark ? "dark" : "white";
      document.documentElement.classList.toggle("dark", isDark);
      setIsDarkTheme(isDark);
    };
    if (resolvedTheme === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mq.matches);
      const handler = (event: MediaQueryListEvent) => applyTheme(event.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    applyTheme(resolvedTheme === "dark");
    return undefined;
  }, [theme]);

  return {
    isDarkTheme,
  };
}
