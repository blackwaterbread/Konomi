import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast, Toaster, useSonner } from "sonner";
import { useTranslation } from "react-i18next";
import App from "./App";
import { AppSplash } from "@/components/app-splash";
import { applyAppLanguagePreference } from "@/lib/i18n";
import { createLogger } from "@/lib/logger";
import type { ThemeId } from "@/lib/themes";
import { readStoredSettings } from "@/hooks/useSettings";
import type { Folder } from "@preload/index.d";

const log = createLogger("renderer/BootstrapApp");
const APP_SPLASH_MIN_VISIBLE_MS = 1900; // 사용자가 최소 1.9초는 Splash를 보기를 원해
const APP_SPLASH_COMPLETION_HOLD_MS = 180;
const APP_SPLASH_FADE_OUT_MS = 240;
const TOASTER_POSITION = "bottom-right";

let migrationPromise: Promise<void> | null = null;
let initialFolderCountPromise: Promise<number | null> | null = null;
let bootstrapPromise: Promise<number | null> | null = null;
let bootstrappedFolderCount: number | null = null;
let bootstrappedFolders: Folder[] | null = null;
let bootstrapCompleted = false;

function ensureMigrationsRun(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = window.db.runMigrations().catch((error: unknown) => {
      log.error("Database migration failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return migrationPromise;
}

function ensureInitialFolderCount(): Promise<number | null> {
  if (!initialFolderCountPromise) {
    initialFolderCountPromise = ensureMigrationsRun()
      .then(() => window.folder.list())
      .then((folders) => {
        bootstrappedFolders = folders;
        bootstrappedFolderCount = folders.length;
        return bootstrappedFolderCount;
      })
      .catch((error: unknown) => {
        log.warn("Failed to load initial folder count during bootstrap", {
          error: error instanceof Error ? error.message : String(error),
        });
        bootstrappedFolderCount = null;
        return null;
      });
  }

  return initialFolderCountPromise;
}

function ensureBootstrapComplete(): Promise<number | null> {
  if (bootstrapCompleted) {
    return Promise.resolve(bootstrappedFolderCount);
  }

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const folderCount = await ensureInitialFolderCount();
      bootstrapCompleted = true;
      return folderCount;
    })();
  }

  return bootstrapPromise;
}

function bindThemePreference(theme: ThemeId): () => void {
  const applyTheme = (isDark: boolean) => {
    document.documentElement.dataset.theme = isDark ? "dark" : "white";
    document.documentElement.classList.toggle("dark", isDark);
  };

  if (theme === "auto") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(mq.matches);
    const handler = (event: MediaQueryListEvent) => applyTheme(event.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }

  applyTheme(theme === "dark");
  return () => undefined;
}

function ClickableToaster() {
  const { toasts } = useSonner();
  const toasterRef = useRef<HTMLElement | null>(null);
  const toastIdByElementRef = useRef(
    new WeakMap<HTMLElement, string | number>(),
  );

  useEffect(() => {
    const toaster = toasterRef.current;
    if (!toaster) return;

    toastIdByElementRef.current = new WeakMap();
    const [defaultYPosition, defaultXPosition] = TOASTER_POSITION.split("-");
    const toasterLists = Array.from(
      toaster.querySelectorAll<HTMLOListElement>("ol[data-sonner-toaster]"),
    );

    toasterLists.forEach((list) => {
      const yPosition = list.dataset.yPosition ?? defaultYPosition;
      const xPosition = list.dataset.xPosition ?? defaultXPosition;
      const position = `${yPosition}-${xPosition}`;
      const positionedToasts = toasts.filter(
        (toastItem) => (toastItem.position ?? TOASTER_POSITION) === position,
      );
      const toastElements = Array.from(
        list.querySelectorAll<HTMLElement>(":scope > [data-sonner-toast]"),
      );

      toastElements.forEach((element, index) => {
        const toastItem = positionedToasts[index];
        if (toastItem) {
          toastIdByElementRef.current.set(element, toastItem.id);
        }
      });
    });
  }, [toasts]);

  useEffect(() => {
    const toaster = toasterRef.current;
    if (!toaster) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.closest(
          "button, a, input, textarea, select, label, [role='button']",
        )
      ) {
        return;
      }

      const toastElement = target.closest<HTMLElement>("[data-sonner-toast]");
      if (!toastElement || !toaster.contains(toastElement)) return;
      if (toastElement.dataset.dismissible === "false") return;

      const toastId = toastIdByElementRef.current.get(toastElement);
      if (toastId == null) return;
      toast.dismiss(toastId);
    };

    toaster.addEventListener("click", handleClick);
    return () => toaster.removeEventListener("click", handleClick);
  }, []);

  return <Toaster ref={toasterRef} richColors position={TOASTER_POSITION} />;
}

export function BootstrapApp() {
  const { t } = useTranslation();
  const storedSettings = useMemo(() => readStoredSettings(), []);
  const [folderCount, setFolderCount] = useState<number | null>(
    bootstrappedFolderCount,
  );
  const [migrating, setMigrating] = useState(false);
  const [mountApp, setMountApp] = useState(bootstrapCompleted);
  const [renderSplash, setRenderSplash] = useState(!bootstrapCompleted);
  const [splashFadingOut, setSplashFadingOut] = useState(false);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const splashShownAtRef = useRef<number | null>(null);
  const splashMinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splashFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSplashTimers = useCallback(() => {
    if (splashMinTimerRef.current) {
      clearTimeout(splashMinTimerRef.current);
      splashMinTimerRef.current = null;
    }
    if (splashFadeTimerRef.current) {
      clearTimeout(splashFadeTimerRef.current);
      splashFadeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    void applyAppLanguagePreference(storedSettings.language);
  }, [storedSettings.language]);

  useEffect(() => {
    if (mountApp) return;
    return bindThemePreference(storedSettings.theme);
  }, [mountApp, storedSettings.theme]);

  useEffect(() => {
    if (renderSplash && splashShownAtRef.current === null) {
      splashShownAtRef.current = Date.now();
    }
  }, [renderSplash]);

  useEffect(() => {
    if (bootstrapCompleted) {
      setFolderCount(bootstrappedFolderCount);
      setMountApp(true);

      setProgressPercent(100);
      setRenderSplash(false);
      setSplashFadingOut(false);
      return;
    }

    let cancelled = false;
    const offMigrationProgress = window.db.onMigrationProgress((data) => {
      if (data.total > 0 && data.done < data.total) {
        setMigrating(true);
        const migrationPercent = Math.min(
          50,
          Math.round((data.done / data.total) * 50),
        );
        setProgressPercent(migrationPercent);
      } else {
        setMigrating(false);
      }
    });

    void ensureInitialFolderCount().then((count) => {
      if (!cancelled) {
        setFolderCount(count);
        setProgressPercent((prev) => prev ?? 60);
      }
    });

    void ensureBootstrapComplete().then((count) => {
      if (cancelled) return;

      setFolderCount(count);

      setProgressPercent(100);
      const shownAt = splashShownAtRef.current ?? Date.now();
      const elapsedMs = Date.now() - shownAt;
      const waitMs = Math.max(
        APP_SPLASH_COMPLETION_HOLD_MS,
        APP_SPLASH_MIN_VISIBLE_MS - elapsedMs,
      );

      splashMinTimerRef.current = setTimeout(() => {
        setMountApp(true);
        setSplashFadingOut(true);
        splashFadeTimerRef.current = setTimeout(() => {
          setRenderSplash(false);
        }, APP_SPLASH_FADE_OUT_MS);
      }, waitMs);
    });

    return () => {
      cancelled = true;
      clearSplashTimers();
      offMigrationProgress();
    };
  }, [clearSplashTimers]);

  const statusText = useMemo(() => {
    if (migrating) {
      return t("app.splash.status.updatingDatabase");
    }
    if (folderCount === null) {
      return t("app.splash.status.checkingFolders");
    }
    if (folderCount === 0) {
      return t("app.splash.status.preparingOnboarding");
    }
    return t("app.splash.status.finalizing");
  }, [folderCount, migrating, t]);

  const detailText = useMemo(() => {
    if (migrating) {
      return t("app.splash.detail.updatingDatabase");
    }
    if (folderCount === null) {
      return t("app.splash.detail.loadingFolders");
    }
    if (folderCount === 0) {
      return t("app.splash.detail.preparingOnboarding");
    }
    return t("app.splash.detail.loadingLibraryState");
  }, [folderCount, migrating, t]);

  return (
    <>
      <ClickableToaster />
      {mountApp && <App initialFolderCount={folderCount} initialFolders={bootstrappedFolders} />}
      {renderSplash && (
        <AppSplash
          fadingOut={splashFadingOut}
          statusText={statusText}
          detailText={detailText}
          progressPercent={progressPercent}
        />
      )}
    </>
  );
}
