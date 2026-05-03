import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const PROGRESS_TOAST_ID = "konomi-update-progress";

function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond >= 1024) {
    return `${Math.round(bytesPerSecond / 1024)} KB/s`;
  }
  return `${Math.round(bytesPerSecond)} B/s`;
}

export function useAutoUpdate(): void {
  const { t } = useTranslation();
  // Dedupe install toasts within a session: getPendingUpdate() and the
  // update-downloaded push event can both fire for the same version (e.g. when
  // a re-check immediately re-emits the event for an already-staged file).
  const notifiedVersionsRef = useRef<Set<string>>(new Set());
  // Progress events carry no version; remember the one from update-available
  // so the same toast can be updated in place.
  const downloadVersionRef = useRef<string | null>(null);

  useEffect(() => {
    const showInstallToast = (version: string) => {
      if (notifiedVersionsRef.current.has(version)) return;
      notifiedVersionsRef.current.add(version);
      toast.success(t("update.downloaded", { version }), {
        duration: Infinity,
        action: {
          label: t("update.installNow"),
          onClick: () => window.appInfo.installUpdate(),
        },
        cancel: {
          label: t("update.later"),
          onClick: () => {},
        },
      });
    };

    const offAvailable = window.appInfo.onUpdateAvailable(
      ({ version, releaseUrl }) => {
        if (releaseUrl) {
          toast.info(t("update.availableMac", { version }), {
            duration: Infinity,
            action: {
              label: t("update.downloadNow"),
              onClick: () => window.open(releaseUrl),
            },
          });
        } else {
          downloadVersionRef.current = version;
          toast.info(t("update.available", { version }), {
            id: PROGRESS_TOAST_ID,
            duration: Infinity,
          });
        }
      },
    );

    const offProgress = window.appInfo.onUpdateProgress(
      ({ percent, bytesPerSecond }) => {
        const version = downloadVersionRef.current;
        if (!version) return;
        const speed = formatSpeed(bytesPerSecond);
        toast.info(t("update.available", { version }), {
          id: PROGRESS_TOAST_ID,
          duration: Infinity,
          description: speed ? `${percent}% · ${speed}` : `${percent}%`,
        });
      },
    );

    const offDownloaded = window.appInfo.onUpdateDownloaded(({ version }) => {
      toast.dismiss(PROGRESS_TOAST_ID);
      downloadVersionRef.current = null;
      showInstallToast(version);
    });

    void window.appInfo.getPendingUpdate().then((pending) => {
      if (pending) showInstallToast(pending.version);
    });

    return () => {
      offAvailable();
      offProgress();
      offDownloaded();
    };
  }, [t]);
}
