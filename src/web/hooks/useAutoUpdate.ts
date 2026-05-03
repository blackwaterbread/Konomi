import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function useAutoUpdate(): void {
  const { t } = useTranslation();
  // Dedupe install toasts within a session: getPendingUpdate() and the
  // update-downloaded push event can both fire for the same version (e.g. when
  // a re-check immediately re-emits the event for an already-staged file).
  const notifiedVersionsRef = useRef<Set<string>>(new Set());

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
          toast.info(t("update.available", { version }), {
            duration: Infinity,
          });
        }
      },
    );

    const offDownloaded = window.appInfo.onUpdateDownloaded(({ version }) => {
      showInstallToast(version);
    });

    void window.appInfo.getPendingUpdate().then((pending) => {
      if (pending) showInstallToast(pending.version);
    });

    return () => {
      offAvailable();
      offDownloaded();
    };
  }, [t]);
}
