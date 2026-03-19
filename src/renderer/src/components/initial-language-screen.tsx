import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import backgroundImageUrl from "@/assets/images/welcome.webp";
import type { AppLanguage } from "@/lib/language";
import { SUPPORTED_APP_LANGUAGES } from "@/lib/language";
import { cn } from "@/lib/utils";

interface InitialLanguageScreenProps {
  open: boolean;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  onContinue: () => void;
}

export function InitialLanguageScreen({
  open,
  language,
  onLanguageChange,
  onContinue,
}: InitialLanguageScreenProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-140 flex items-center justify-center bg-background/88 px-6 py-10 backdrop-blur-md">
      <div className="w-full max-w-4xl overflow-hidden rounded-4xl border border-border/60 bg-background shadow-2xl">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="relative overflow-hidden bg-primary/8 px-8 py-10 sm:px-10 sm:py-12">
            <div
              className="absolute inset-0 bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${backgroundImageUrl})` }}
            />
            <div className="absolute inset-0 bg-background/40 backdrop-blur-xs" />

            <div className="relative z-10">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/24">
                <Globe className="h-8 w-8 text-primary" />
              </div>
              <div className="mt-6 space-y-1.5">
                {/* <p className="text-sm font-medium uppercase tracking-[0.24em] text-primary/80">
                  Konomi
                </p> */}
                <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl select-none">
                  {t("onboarding.languageStep.title")}
                </h1>
                <p className="ml-1 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base select-none">
                  {t("onboarding.languageStep.description")}
                </p>
              </div>
            </div>
          </div>

          <div className="px-8 py-10 sm:px-10 sm:py-12">
            <div className="space-y-3">
              {SUPPORTED_APP_LANGUAGES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => onLanguageChange(item)}
                  className={cn(
                    "w-full rounded-2xl border px-5 py-4 text-left transition-colors",
                    language === item
                      ? "border-primary bg-primary/10 text-foreground shadow-sm"
                      : "border-border bg-secondary/35 text-muted-foreground hover:border-foreground/15 hover:bg-secondary/55 hover:text-foreground",
                  )}
                >
                  <div className="text-base font-medium">
                    {t(`settings.language.${item}`)}
                  </div>
                  <div className="mt-1 text-sm leading-6 opacity-85">
                    {t(`onboarding.languageStep.options.${item}`)}
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-8 flex justify-end">
              <Button size="lg" className="min-w-36" onClick={onContinue}>
                {t("onboarding.languageStep.continue")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
