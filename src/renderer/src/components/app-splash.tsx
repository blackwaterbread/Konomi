import { Images, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface AppSplashProps {
  fadingOut?: boolean;
  statusText: string;
  detailText: string;
  progressPercent?: number | null;
}

export function AppSplash({
  fadingOut = false,
  statusText,
  detailText,
  progressPercent = null,
}: AppSplashProps) {
  const { t } = useTranslation();
  const clampedProgress =
    typeof progressPercent === "number"
      ? Math.max(0, Math.min(100, progressPercent))
      : null;
  const isIndeterminate = clampedProgress === null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-background transition-opacity duration-300",
        fadingOut ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_color-mix(in_oklab,var(--color-primary)_22%,transparent),transparent_48%)]" />
      <div className="absolute left-[10%] top-[12%] h-72 w-72 rounded-full bg-primary/12 blur-3xl" />
      <div className="absolute bottom-[10%] right-[8%] h-64 w-64 rounded-full bg-info/12 blur-3xl" />

      <div
        className={cn(
          "relative w-full max-w-xl px-6 transition duration-300",
          fadingOut ? "translate-y-2 scale-[0.985]" : "translate-y-0 scale-100",
        )}
      >
        <div className="rounded-[28px] border border-border/70 bg-card/80 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-lg shadow-primary/10">
            <Images className="h-8 w-8" />
          </div>

          <div className="space-y-3">
            {/* <p className="text-xs font-medium uppercase tracking-[0.32em] text-primary/70">
              Konomi
            </p> */}
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {t("app.splash.title")}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {statusText}
              </p>
            </div>
          </div>

          <div className="mt-8 space-y-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              {isIndeterminate ? (
                <div className="h-full w-1/3 rounded-full bg-primary/90 animate-pulse" />
              ) : (
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${clampedProgress}%` }}
                />
              )}
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-background/65 px-4 py-3">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <p className="min-w-0 text-sm text-foreground/90">
                  {detailText}
                </p>
                {clampedProgress !== null && (
                  <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {Math.round(clampedProgress)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
