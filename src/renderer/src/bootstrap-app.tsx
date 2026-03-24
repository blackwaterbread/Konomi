import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast, Toaster, useSonner } from "sonner";
import { useTranslation } from "react-i18next";
import App from "./App";
import { AppSplash } from "@/components/app-splash";
import { applyAppLanguagePreference } from "@/lib/i18n";
import { createLogger } from "@/lib/logger";
import type { ThemeId } from "@/lib/themes";
import { readStoredSettings } from "@/hooks/useSettings";

const log = createLogger("renderer/BootstrapApp");
const APP_SPLASH_MIN_VISIBLE_MS = 1900; // 사용자가 최소 1.9초는 Splash를 보기를 원해
const APP_SPLASH_COMPLETION_HOLD_MS = 180;
const APP_SPLASH_FADE_OUT_MS = 240;
const FOLDER_ORDER_STORAGE_KEY = "konomi-folder-order";
const TOASTER_POSITION = "bottom-right";

let initialFolderCountPromise: Promise<number | null> | null = null;
let bootstrapPromise: Promise<number | null> | null = null;
let bootstrappedFolderCount: number | null = null;
let bootstrapCompleted = false;

function readOrderedFolderIds(): number[] | undefined {
  try {
    const raw = localStorage.getItem(FOLDER_ORDER_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const ids = parsed.filter((id): id is number => Number.isInteger(id));
    return ids.length > 0 ? ids : undefined;
  } catch {
    return undefined;
  }
}

function ensureInitialFolderCount(): Promise<number | null> {
  if (!initialFolderCountPromise) {
    initialFolderCountPromise = window.folder
      .list()
      .then((folders) => {
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

      try {
        await window.image.scan({
          detectDuplicates: true,
          orderedFolderIds: readOrderedFolderIds(),
        });
      } catch (error: unknown) {
        log.error("Initial bootstrap scan failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

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
  const [scanProgress, setScanProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [scanningFolderNames, setScanningFolderNames] = useState<
    Map<number, string>
  >(new Map());
  const [mountApp, setMountApp] = useState(bootstrapCompleted);
  const [bootstrapReady, setBootstrapReady] = useState(bootstrapCompleted);
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
      setBootstrapReady(true);
      setProgressPercent(100);
      setRenderSplash(false);
      setSplashFadingOut(false);
      return;
    }

    let cancelled = false;
    const offScanProgress = window.image.onScanProgress((data) => {
      const nextProgress =
        data.total > 0
          ? Math.min(99, Math.round((data.done / data.total) * 100))
          : 0;
      setProgressPercent((prev) => {
        if (prev === null) return nextProgress;
        return Math.max(prev, nextProgress);
      });
      setScanProgress(data.done >= data.total ? null : data);
    });
    const offScanFolder = window.image.onScanFolder(
      ({ folderId, folderName, active }) => {
        setScanningFolderNames((prev) => {
          const next = new Map(prev);
          if (active && folderName) next.set(folderId, folderName);
          else next.delete(folderId);
          return next;
        });
      },
    );

    void ensureInitialFolderCount().then((count) => {
      if (!cancelled) {
        setFolderCount(count);
        if (count === 0) {
          setProgressPercent(100);
        } else if (count !== null) {
          setProgressPercent((prev) => prev ?? 8);
        }
      }
    });

    void ensureBootstrapComplete().then((count) => {
      if (cancelled) return;

      setFolderCount(count);
      setBootstrapReady(true);
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
      offScanProgress();
      offScanFolder();
    };
  }, [clearSplashTimers]);

  const statusText = useMemo(() => {
    if (folderCount === null) {
      return t("app.splash.status.checkingFolders");
    }
    if (folderCount === 0) {
      return t("app.splash.status.preparingOnboarding");
    }
    if (!bootstrapReady) {
      return t("app.splash.status.syncingLibrary");
    }
    return t("app.splash.status.finalizing");
  }, [bootstrapReady, folderCount, t]);

  const detailText = useMemo(() => {
    if (scanProgress && scanProgress.total > 0) {
      const folderNames = Array.from(scanningFolderNames.values());
      const folderLabel =
        folderNames.length <= 1
          ? folderNames[0]
          : t("appStatus.folderSummary", {
              first: folderNames[0],
              count: folderNames.length - 1,
            });
      return folderLabel
        ? t("app.splash.detail.scanFolders", {
            folderLabel,
            done: scanProgress.done,
            total: scanProgress.total,
          })
        : t("app.splash.detail.scanImages", {
            done: scanProgress.done,
            total: scanProgress.total,
          });
    }
    if (folderCount === null) {
      return t("app.splash.detail.loadingFolders");
    }
    if (folderCount === 0) {
      return t("app.splash.detail.preparingOnboarding");
    }
    return t("app.splash.detail.loadingLibraryState");
  }, [folderCount, scanProgress, scanningFolderNames, t]);

  return (
    <>
      <ClickableToaster />
      {mountApp && <App initialFolderCount={folderCount} />}
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
