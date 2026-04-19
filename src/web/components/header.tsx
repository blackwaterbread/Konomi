import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Settings,
  Info,
  X,
  Loader2,
  ImagePlus,
  Images,
  Tags,
  Bug,
  CircleAlert,
  Menu,
} from "lucide-react";
import { toast } from "sonner";
import infoImageUrl from "@/assets/images/info.webp";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AppInfoDialog } from "@/components/app-info-dialog";
import { useTranslation } from "react-i18next";

type ActivePanel = "gallery" | "generator" | "settings" | "tagSearch" | "debug";
interface HeaderProps {
  activePanel: ActivePanel;
  onPanelChange: (panel: ActivePanel) => void;
  scanning?: boolean;
  checkingDuplicates?: boolean;
  isAnalyzing?: boolean;
  onCancelScan?: () => void;
  onStartTour?: () => void;
  devMode?: boolean;
  announcementDeferred?: boolean;
  onAnnouncementReopen?: () => void;
  onToggleSidebar?: () => void;
}

interface HeaderPanelButtonsProps {
  activePanel: ActivePanel;
  onPanelChange: (panel: ActivePanel) => void;
  onStartTour?: () => void;
  devMode?: boolean;
  announcementDeferred?: boolean;
  onAnnouncementReopen?: () => void;
}

const HeaderPanelButtons = memo(function HeaderPanelButtons({
  activePanel,
  onPanelChange,
  onStartTour,
  devMode,
  announcementDeferred,
  onAnnouncementReopen,
}: HeaderPanelButtonsProps) {
  const { t } = useTranslation();
  const [aboutOpen, setAboutOpen] = useState(false);

  const handlePanelClick = (panel: ActivePanel) => {
    onPanelChange(activePanel === panel ? "gallery" : panel);
  };

  return (
    <>
      <TooltipProvider delayDuration={300}>
        <div
          className="flex items-center gap-1 sm:gap-1 max-sm:gap-1.5 shrink-0"
          data-tour="panel-buttons"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "max-sm:h-11 max-sm:w-11 hover:text-foreground",
                  activePanel === "generator"
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
                onClick={() => handlePanelClick("generator")}
              >
                <ImagePlus className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.tooltip.generator")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "max-sm:h-11 max-sm:w-11 hover:text-foreground",
                  activePanel === "gallery"
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
                onClick={() => onPanelChange("gallery")}
              >
                <Images className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.tooltip.gallery")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "max-sm:h-11 max-sm:w-11 hover:text-foreground",
                  activePanel === "tagSearch"
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
                onClick={() => handlePanelClick("tagSearch")}
              >
                <Tags className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.tooltip.tagSearch")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "max-sm:h-11 max-sm:w-11 hover:text-foreground",
                  activePanel === "settings"
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
                onClick={() => handlePanelClick("settings")}
              >
                <Settings className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.tooltip.settings")}</TooltipContent>
          </Tooltip>
          {devMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "hover:text-foreground",
                    activePanel === "debug"
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                  onClick={() => handlePanelClick("debug")}
                >
                  <Bug className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Debug</TooltipContent>
            </Tooltip>
          )}
          {announcementDeferred && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-amber-500 hover:text-amber-400"
                  onClick={onAnnouncementReopen}
                >
                  <CircleAlert className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("header.tooltip.announcement")}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setAboutOpen(true)}
              >
                <Info className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.tooltip.appInfo")}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
      <AppInfoDialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        onStartTour={onStartTour}
      />
    </>
  );
});

type ProgressData = { done: number; total: number };

const ETA_MIN_ELAPSED_MS = 2000;
const ETA_MIN_RATIO = 0.03;

type EtaEntry = { startTime: number; startDone: number };

function computeEtaSeconds(
  entry: EtaEntry,
  progress: ProgressData,
): number | null {
  const elapsed = Date.now() - entry.startTime;
  const processed = progress.done - entry.startDone;
  const ratio = progress.done / progress.total;
  if (elapsed < ETA_MIN_ELAPSED_MS || ratio < ETA_MIN_RATIO || processed <= 0) {
    return null;
  }
  const rate = processed / (elapsed / 1000);
  const remaining = (progress.total - progress.done) / rate;
  return remaining > 0 ? Math.round(remaining) : null;
}

function formatEta(
  sec: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (sec < 5) return "";
  if (sec < 60) return t("header.progress.eta", { time: `${sec}s` });
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return t("header.progress.eta", {
    time: s === 0 ? `${m}m` : `${m}m ${s}s`,
  });
}

function useHeaderProgress({
  scanning,
  isAnalyzing,
}: {
  scanning?: boolean;
  isAnalyzing?: boolean;
}) {
  const [scanProgress, setScanProgress] = useState<ProgressData | null>(null);
  const [scanPhase, setScanPhase] = useState<string | null>(null);
  const [scanningFolderNames, setScanningFolderNames] = useState<
    Map<number, string>
  >(new Map());
  const [hashProgress, setHashProgress] = useState<ProgressData | null>(null);
  const [similarityProgress, setSimilarityProgress] =
    useState<ProgressData | null>(null);
  const [searchStatsProgress, setSearchStatsProgress] =
    useState<ProgressData | null>(null);
  const [rescanProgress, setRescanProgress] = useState<ProgressData | null>(
    null,
  );
  const [etaSeconds, setEtaSeconds] = useState<Map<string, number>>(new Map());
  const etaEntriesRef = useRef<Map<string, EtaEntry>>(new Map());
  const searchStatsClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scanningRef = useRef(scanning);
  const analyzingRef = useRef(isAnalyzing);

  useEffect(() => {
    scanningRef.current = scanning;
  }, [scanning]);
  useEffect(() => {
    analyzingRef.current = isAnalyzing;
  }, [isAnalyzing]);

  const trackEta = (key: string, data: ProgressData | null) => {
    const entries = etaEntriesRef.current;
    if (!data || data.total <= 0 || data.done >= data.total) {
      if (entries.delete(key)) {
        setEtaSeconds((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      }
      return;
    }
    let entry = entries.get(key);
    if (!entry) {
      entry = { startTime: Date.now(), startDone: data.done };
      entries.set(key, entry);
    }
    const eta = computeEtaSeconds(entry, data);
    setEtaSeconds((prev) => {
      if (eta === null) {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      }
      if (prev.get(key) === eta) return prev;
      const next = new Map(prev);
      next.set(key, eta);
      return next;
    });
  };

  const resetAllEta = () => {
    etaEntriesRef.current.clear();
    setEtaSeconds(new Map());
  };

  useEffect(() => {
    const offScanProgress = window.image.onScanProgress((data) => {
      if (!scanningRef.current) return;
      const finished = data.done >= data.total;
      setScanProgress(finished ? null : data);
      trackEta("scan", finished ? null : data);
    });
    const offScanPhase = window.image.onScanPhase(({ phase }) => {
      if (scanningRef.current) setScanPhase(phase);
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
    const offHashProgress = window.image.onHashProgress((data) => {
      if (!analyzingRef.current) return;
      const finished = data.done >= data.total;
      setHashProgress(finished ? null : data);
      trackEta("hash", finished ? null : data);
    });
    const offSimilarityProgress = window.image.onSimilarityProgress((data) => {
      setSimilarityProgress(data);
      trackEta("similarity", data);
    });
    const offSearchStatsProgress = window.image.onSearchStatsProgress(
      (data) => {
        setSearchStatsProgress(data);
        trackEta("searchStats", data);
        if (searchStatsClearTimerRef.current) {
          clearTimeout(searchStatsClearTimerRef.current);
          searchStatsClearTimerRef.current = null;
        }
        if (data.total > 0 && data.done >= data.total) {
          searchStatsClearTimerRef.current = setTimeout(() => {
            setSearchStatsProgress(null);
            searchStatsClearTimerRef.current = null;
          }, 250);
        }
      },
    );
    const offRescanProgress = window.image.onRescanMetadataProgress((data) => {
      setRescanProgress(data);
      trackEta("rescan", data);
    });
    const offUtilityReset = window.appInfo.onUtilityReset(() => {
      setScanProgress(null);
      setHashProgress(null);
      setSimilarityProgress(null);
      setSearchStatsProgress(null);
      setRescanProgress(null);
      resetAllEta();
    });

    return () => {
      offScanProgress();
      offScanPhase();
      offScanFolder();
      offHashProgress();
      offSimilarityProgress();
      offSearchStatsProgress();
      offRescanProgress();
      offUtilityReset();
      if (searchStatsClearTimerRef.current) {
        clearTimeout(searchStatsClearTimerRef.current);
      }
    };
  }, []);

  // Clean up when scanning/analyzing ends
  useEffect(() => {
    if (!scanning) {
      setScanProgress(null);
      setScanPhase(null);
      setScanningFolderNames(new Map());
      trackEta("scan", null);
    }
  }, [scanning]);

  useEffect(() => {
    if (!isAnalyzing) {
      setHashProgress(null);
      setSimilarityProgress(null);
      trackEta("hash", null);
      trackEta("similarity", null);
    }
  }, [isAnalyzing]);

  return {
    scanProgress,
    scanPhase,
    scanningFolderNames,
    hashProgress,
    similarityProgress,
    searchStatsProgress,
    rescanProgress,
    etaSeconds,
  };
}

export const Header = memo(function Header({
  activePanel,
  onPanelChange,
  scanning,
  checkingDuplicates,
  isAnalyzing,
  onCancelScan,
  onStartTour,
  devMode,
  announcementDeferred,
  onAnnouncementReopen,
  onToggleSidebar,
}: HeaderProps) {
  const { t } = useTranslation();
  const {
    scanProgress,
    scanPhase,
    scanningFolderNames,
    hashProgress,
    similarityProgress,
    searchStatsProgress,
    rescanProgress,
    etaSeconds: etaMap,
  } = useHeaderProgress({ scanning, isAnalyzing });
  const hasSearchStatsProgress =
    !!searchStatsProgress &&
    searchStatsProgress.total > 0 &&
    searchStatsProgress.done < searchStatsProgress.total;
  const hasSimilarityProgress =
    !!similarityProgress &&
    similarityProgress.total > 0 &&
    similarityProgress.done < similarityProgress.total;
  const hasRescanProgress =
    !!rescanProgress &&
    rescanProgress.total > 0 &&
    rescanProgress.done < rescanProgress.total;
  const activeProgress =
    scanProgress ??
    (hasRescanProgress ? rescanProgress : null) ??
    hashProgress ??
    (hasSimilarityProgress ? similarityProgress : null) ??
    (hasSearchStatsProgress ? searchStatsProgress : null);

  const statusActive =
    scanning ||
    checkingDuplicates ||
    isAnalyzing ||
    hasRescanProgress ||
    hasSimilarityProgress ||
    hasSearchStatsProgress;

  const statusText = useMemo(() => {
    if (!statusActive) return "";
    const eta = (key: string) => {
      const sec = etaMap.get(key);
      return sec != null ? ` ${formatEta(sec, t)}` : "";
    };
    if (checkingDuplicates) return t("header.progress.checkingDuplicates");
    if (scanProgress && scanProgress.total > 0) {
      const names =
        scanningFolderNames && scanningFolderNames.size > 0
          ? Array.from(scanningFolderNames.values()).join(", ")
          : null;
      return names
        ? t("header.progress.scanFolders", {
            names,
            done: scanProgress.done,
            total: scanProgress.total,
          }) + eta("scan")
        : t("header.progress.scanImages", {
            done: scanProgress.done,
            total: scanProgress.total,
          }) + eta("scan");
    }
    if (hasRescanProgress && rescanProgress) {
      return (
        t("header.progress.rescan", {
          done: rescanProgress.done,
          total: rescanProgress.total,
        }) + eta("rescan")
      );
    }
    if (hashProgress && hashProgress.total > 0) {
      return (
        t("header.progress.hashes", {
          done: hashProgress.done,
          total: hashProgress.total,
        }) + eta("hash")
      );
    }
    if (hasSimilarityProgress && similarityProgress) {
      return t("header.progress.similarity") + eta("similarity");
    }
    if (hasSearchStatsProgress && searchStatsProgress) {
      return (
        t("header.progress.searchStats", {
          done: searchStatsProgress.done,
          total: searchStatsProgress.total,
        }) + eta("searchStats")
      );
    }
    if (scanPhase) return t(`header.progress.phase.${scanPhase}`);
    return t("header.progress.working");
  }, [
    statusActive,
    checkingDuplicates,
    scanProgress,
    scanningFolderNames,
    hasRescanProgress,
    rescanProgress,
    hashProgress,
    hasSimilarityProgress,
    similarityProgress,
    hasSearchStatsProgress,
    searchStatsProgress,
    scanPhase,
    etaMap,
    t,
  ]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {activeProgress && activeProgress.total > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border z-10">
          <div
            className="h-full bg-primary transition-all duration-150"
            style={{
              width: `${(activeProgress.done / activeProgress.total) * 100}%`,
            }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:min-h-16 sm:gap-4 sm:px-6 sm:justify-between">
        <div className="relative flex items-center gap-2 order-1 sm:shrink-0 sm:gap-3">
          {onToggleSidebar && (
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground sm:hidden"
              onClick={onToggleSidebar}
              aria-label={t("sidebar.label")}
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <span className="hidden sm:inline-block text-xl font-extrabold text-foreground select-none">
            Konomi
          </span>
          <div className="hidden sm:flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-primary/10">
            <img
              src={infoImageUrl}
              alt="Konomi"
              className="h-full w-full object-cover"
              draggable={false}
            />
          </div>
          {statusActive && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground lg:hidden">
              <button
                type="button"
                onClick={() => {
                  if (statusText) toast(statusText);
                }}
                className="flex items-center gap-1"
                aria-label={statusText}
              >
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                {activeProgress && activeProgress.total > 0 && (
                  <span className="tabular-nums select-none">
                    {activeProgress.done}/{activeProgress.total}
                  </span>
                )}
              </button>
              {scanning && onCancelScan && (
                <button
                  type="button"
                  onClick={onCancelScan}
                  className="flex items-center hover:text-foreground"
                  aria-label={t("common.cancel")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {statusActive && (
            <div className="absolute left-full ml-3 hidden items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap lg:flex">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              <span className="tabular-nums select-none">{statusText}</span>
              {scanning && onCancelScan && (
                <button
                  onClick={onCancelScan}
                  className="flex items-center text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="order-2 ml-auto flex shrink-0 items-center sm:order-3 sm:ml-0">
          <HeaderPanelButtons
            activePanel={activePanel}
            onPanelChange={onPanelChange}
            onStartTour={onStartTour}
            devMode={devMode}
            announcementDeferred={announcementDeferred}
            onAnnouncementReopen={onAnnouncementReopen}
          />
        </div>
      </div>
    </header>
  );
});

Header.displayName = "Header";
