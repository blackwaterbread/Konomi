import { useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function useAutoUpdate(): void {
  const { t } = useTranslation();

  useEffect(() => {
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
    });

    return () => {
      offAvailable();
      offDownloaded();
    };
  }, [t]);
}
