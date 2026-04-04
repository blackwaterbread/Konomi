import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Settings,
  Info,
  X,
  Loader2,
  ImagePlus,
  Images,
  Tags,
  SlidersHorizontal,
  Bug,
} from "lucide-react";
import infoImageUrl from "@/assets/images/info.webp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AdvancedSearchModal } from "@/components/advanced-search-modal";
import { AppInfoDialog } from "@/components/app-info-dialog";
import type { AdvancedFilter } from "@/lib/advanced-filter";
import { filterLabel, filterKey } from "@/lib/advanced-filter";
import { useLocaleFormatters } from "@/lib/formatters";
import {
  SEARCH_INPUT_APPEND_TAG_EVENT,
  type SearchInputAppendTagDetail,
} from "@/lib/search-input-event";
import { useTranslation } from "react-i18next";

const SEARCH_TERM_SPLIT_RE = /[,\n\uFF0C|\uFF5C]+/;

function isSearchSeparator(char: string): boolean {
  return (
    char === "," ||
    char === "\n" ||
    char === "|" ||
    char === "\uFF0C" ||
    char === "\uFF5C"
  );
}

function collectSearchTerms(query: string): string[] {
  if (!query) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const part of query.split(SEARCH_TERM_SPLIT_RE)) {
    const term = part.trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(term);
  }
  return normalized;
}

type ActiveSearchToken = {
  start: number;
  end: number;
  raw: string;
  term: string;
  excludeTerms: string[];
};

type TagSuggestion = {
  tag: string;
  count: number;
};

function getActiveSearchToken(
  query: string,
  cursorPosition: number,
): ActiveSearchToken | null {
  if (!query) return null;
  const cursor = Math.max(0, Math.min(cursorPosition, query.length));

  let start = cursor;
  while (start > 0 && !isSearchSeparator(query[start - 1])) {
    start -= 1;
  }

  let end = cursor;
  while (end < query.length && !isSearchSeparator(query[end])) {
    end += 1;
  }

  const raw = query.slice(start, end);
  const term = raw.trim();
  if (!term) return null;
  const withoutActive = query.slice(0, start) + query.slice(end);

  return {
    start,
    end,
    raw,
    term,
    excludeTerms: collectSearchTerms(withoutActive),
  };
}

type ActivePanel = "gallery" | "generator" | "settings" | "tagSearch" | "debug";
interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activePanel: ActivePanel;
  onPanelChange: (panel: ActivePanel) => void;
  scanning?: boolean;
  checkingDuplicates?: boolean;
  isAnalyzing?: boolean;
  onCancelScan?: () => void;
  advancedFilters: AdvancedFilter[];
  onAdvancedFiltersChange: (filters: AdvancedFilter[]) => void;
  availableResolutions: { width: number; height: number }[];
  availableModels: string[];
  onStartTour?: () => void;
  devMode?: boolean;
}

interface HeaderSearchSectionProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  advancedFilters: AdvancedFilter[];
  onAdvancedFiltersChange: (filters: AdvancedFilter[]) => void;
  availableResolutions: { width: number; height: number }[];
  availableModels: string[];
}

const HeaderSearchSection = memo(function HeaderSearchSection({
  searchQuery,
  onSearchChange,
  advancedFilters,
  onAdvancedFiltersChange,
  availableResolutions,
  availableModels,
}: HeaderSearchSectionProps) {
  const { t } = useTranslation();
  const { formatNumber } = useLocaleFormatters();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [inputValue, setInputValue] = useState(searchQuery);
  const [caretPosition, setCaretPosition] = useState<number | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [tagSuggestionOpen, setTagSuggestionOpen] = useState(false);
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suppressAutocompleteOnceRef = useRef(false);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestRequestSeqRef = useRef(0);
  const focusInputAt = (position: number) => {
    const focus = () => {
      const node = inputRef.current;
      if (!node) return false;
      node.focus();
      node.setSelectionRange(position, position);
      return true;
    };

    if (!focus()) {
      window.requestAnimationFrame(() => {
        focus();
      });
    }
  };

  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const handleAppendTag = (event: Event) => {
      const detail = (event as CustomEvent<SearchInputAppendTagDetail>).detail;
      const normalizedTag = detail?.tag?.trim() ?? "";
      if (!normalizedTag) return;
      if (detail?.suppressAutocomplete) {
        suppressAutocompleteOnceRef.current = true;
      }

      let nextValue = "";
      setInputValue((prev) => {
        const trimmed = prev.trim();
        nextValue = !trimmed
          ? normalizedTag
          : /[,\n\uFF0C|]\s*$/.test(trimmed)
            ? `${trimmed} ${normalizedTag}`
            : `${trimmed}, ${normalizedTag}`;
        return nextValue;
      });

      setTagSuggestions([]);
      setTagSuggestionOpen(false);
      setTagSuggestionIndex(-1);
      const nextCaret = nextValue.length;
      setCaretPosition(nextCaret);

      if (detail?.focusInput) {
        focusInputAt(nextCaret);
      } else {
        setIsSearchFocused(false);
      }
    };

    window.addEventListener(SEARCH_INPUT_APPEND_TAG_EVENT, handleAppendTag);
    return () => {
      window.removeEventListener(
        SEARCH_INPUT_APPEND_TAG_EVENT,
        handleAppendTag,
      );
    };
  }, []);

  useEffect(
    () => () => {
      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
      }
      if (blurCloseTimerRef.current) {
        clearTimeout(blurCloseTimerRef.current);
      }
    },
    [],
  );

  const activeSearchToken = useMemo(() => {
    const cursor = caretPosition ?? inputValue.length;
    return getActiveSearchToken(inputValue, cursor);
  }, [caretPosition, inputValue]);

  useEffect(() => {
    if (!isSearchFocused || !activeSearchToken) {
      setTagSuggestions([]);
      setTagSuggestionOpen(false);
      setTagSuggestionIndex(-1);
      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
        suggestDebounceRef.current = null;
      }
      return;
    }

    if (suppressAutocompleteOnceRef.current) {
      suppressAutocompleteOnceRef.current = false;
      return;
    }

    if (suggestDebounceRef.current) {
      clearTimeout(suggestDebounceRef.current);
      suggestDebounceRef.current = null;
    }

    suggestDebounceRef.current = setTimeout(() => {
      const requestId = ++suggestRequestSeqRef.current;
      void window.image
        .suggestTags({
          prefix: activeSearchToken.term,
          limit: 8,
          exclude: activeSearchToken.excludeTerms,
        })
        .then((items) => {
          if (requestId !== suggestRequestSeqRef.current) return;
          const next = items.filter((item) => item.tag.trim());
          setTagSuggestions(next);
          setTagSuggestionOpen(next.length > 0);
          setTagSuggestionIndex(-1);
        })
        .catch(() => {
          if (requestId !== suggestRequestSeqRef.current) return;
          setTagSuggestions([]);
          setTagSuggestionOpen(false);
          setTagSuggestionIndex(-1);
        });
    }, 140);

    return () => {
      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
        suggestDebounceRef.current = null;
      }
    };
  }, [activeSearchToken, isSearchFocused]);

  const commitSearch = (query = inputValue) => {
    setTagSuggestionOpen(false);
    setTagSuggestionIndex(-1);
    onSearchChange(query);
  };
  const clearSearch = () => {
    setInputValue("");
    setCaretPosition(0);
    setTagSuggestions([]);
    setTagSuggestionOpen(false);
    setTagSuggestionIndex(-1);
    onSearchChange("");
  };

  const applyTagSuggestion = (suggestion: string): string | null => {
    const cursor =
      inputRef.current?.selectionStart ?? caretPosition ?? inputValue.length;
    const active = getActiveSearchToken(inputValue, cursor);
    if (!active) return null;
    const leading = active.raw.match(/^\s*/)?.[0] ?? "";
    const trailing = active.raw.match(/\s*$/)?.[0] ?? "";
    const replacement = `${leading}${suggestion}${trailing}`;
    const nextValue =
      inputValue.slice(0, active.start) +
      replacement +
      inputValue.slice(active.end);
    const nextCursor = active.start + leading.length + suggestion.length;
    setInputValue(nextValue);
    setCaretPosition(nextCursor);
    setTagSuggestions([]);
    setTagSuggestionOpen(false);
    setTagSuggestionIndex(-1);
    focusInputAt(nextCursor);
    return nextValue;
  };

  const removeFilter = (f: AdvancedFilter) => {
    onAdvancedFiltersChange(
      advancedFilters.filter((af) => filterKey(af) !== filterKey(f)),
    );
  };

  return (
    <>
      <div
        className="flex flex-1 max-w-2xl flex-col gap-1.5"
        data-tour="search"
      >
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              data-search-input
              type="text"
              placeholder={t("header.searchPlaceholder")}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setCaretPosition(e.target.selectionStart);
              }}
              onFocus={(e) => {
                if (blurCloseTimerRef.current) {
                  clearTimeout(blurCloseTimerRef.current);
                  blurCloseTimerRef.current = null;
                }
                setIsSearchFocused(true);
                setCaretPosition(e.target.selectionStart);
              }}
              onBlur={() => {
                blurCloseTimerRef.current = setTimeout(() => {
                  setIsSearchFocused(false);
                  setTagSuggestionOpen(false);
                  setTagSuggestionIndex(-1);
                }, 120);
              }}
              onClick={(e) => setCaretPosition(e.currentTarget.selectionStart)}
              onKeyUp={(e) => setCaretPosition(e.currentTarget.selectionStart)}
              onKeyDown={(e) => {
                if (tagSuggestionOpen && tagSuggestions.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setTagSuggestionIndex((prev) =>
                      prev < 0 ? 0 : (prev + 1) % tagSuggestions.length,
                    );
                    return;
                  }
                  if (e.key === "ArrowUp" && tagSuggestionIndex >= 0) {
                    e.preventDefault();
                    setTagSuggestionIndex((prev) =>
                      prev <= 0 ? tagSuggestions.length - 1 : prev - 1,
                    );
                    return;
                  }
                  if (
                    e.key === "Tab" ||
                    (e.key === "Enter" && tagSuggestionIndex >= 0)
                  ) {
                    const index =
                      tagSuggestionIndex >= 0 ? tagSuggestionIndex : 0;
                    const picked = tagSuggestions[index];
                    if (picked) {
                      e.preventDefault();
                      applyTagSuggestion(picked.tag);
                      return;
                    }
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setTagSuggestionOpen(false);
                    setTagSuggestionIndex(-1);
                    return;
                  }
                }
                if (e.key === "Enter") commitSearch();
              }}
              className="w-full pl-10 pr-8 bg-secondary border-border focus:border-primary"
            />
            {tagSuggestionOpen && tagSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-md">
                {tagSuggestions.map((item, index) => (
                  <button
                    key={`${item.tag}-${index}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyTagSuggestion(item.tag);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs",
                      index === tagSuggestionIndex
                        ? "bg-accent text-accent-foreground"
                        : "text-popover-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <span className="truncate">{item.tag}</span>
                    <span className="shrink-0 font-mono text-[11px] text-foreground">
                      {formatNumber(item.count)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {inputValue && (
              <button
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={clearSearch}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-9 w-9 text-muted-foreground hover:text-foreground"
                  onClick={() => commitSearch()}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("header.tooltip.search")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "shrink-0 h-9 w-9",
                    advancedFilters.length > 0
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setAdvancedOpen(true)}
                >
                  <div className="relative">
                    <SlidersHorizontal className="h-4 w-4" />
                    {advancedFilters.length > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[9px] text-primary-foreground font-bold leading-none">
                        {advancedFilters.length}
                      </span>
                    )}
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("header.tooltip.advancedSearch")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {advancedFilters.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {advancedFilters.map((f) => (
              <span
                key={filterKey(f)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-primary/10 text-primary border border-primary/20 rounded-md"
              >
                {filterLabel(f)}
                <button
                  onClick={() => removeFilter(f)}
                  className="hover:text-primary/60 flex items-center"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <AdvancedSearchModal
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        activeFilters={advancedFilters}
        onFiltersChange={onAdvancedFiltersChange}
        availableResolutions={availableResolutions}
        availableModels={availableModels}
      />
    </>
  );
});

interface HeaderPanelButtonsProps {
  activePanel: ActivePanel;
  onPanelChange: (panel: ActivePanel) => void;
  onStartTour?: () => void;
  devMode?: boolean;
}

const HeaderPanelButtons = memo(function HeaderPanelButtons({
  activePanel,
  onPanelChange,
  onStartTour,
  devMode,
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
          className="flex items-center gap-1 shrink-0"
          data-tour="panel-buttons"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "hover:text-foreground",
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
                  "hover:text-foreground",
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
                  "hover:text-foreground",
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
                  "hover:text-foreground",
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
  if (
    elapsed < ETA_MIN_ELAPSED_MS ||
    ratio < ETA_MIN_RATIO ||
    processed <= 0
  ) {
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
  searchQuery,
  onSearchChange,
  activePanel,
  onPanelChange,
  scanning,
  checkingDuplicates,
  isAnalyzing,
  onCancelScan,
  advancedFilters,
  onAdvancedFiltersChange,
  availableResolutions,
  availableModels,
  onStartTour,
  devMode,
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
  const etaSuffix = (key: string) => {
    const sec = etaMap.get(key);
    return sec != null ? ` ${formatEta(sec, t)}` : "";
  };
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
      <div className="flex min-h-16 items-center justify-between px-6 py-3 gap-4">
        <div className="relative flex items-center gap-3 shrink-0">
          <span className="text-xl font-extrabold text-foreground select-none">
            Konomi
          </span>
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-primary/10">
            <img
              src={infoImageUrl}
              alt="Konomi"
              className="h-full w-full object-cover"
              draggable={false}
            />
          </div>
          {(scanning ||
            checkingDuplicates ||
            isAnalyzing ||
            hasRescanProgress ||
            hasSimilarityProgress ||
            hasSearchStatsProgress) && (
            <div className="absolute left-full ml-3 flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              <span className="tabular-nums select-none">
                {checkingDuplicates
                  ? t("header.progress.checkingDuplicates")
                  : scanProgress && scanProgress.total > 0
                    ? (() => {
                        const names =
                          scanningFolderNames && scanningFolderNames.size > 0
                            ? Array.from(scanningFolderNames.values()).join(
                                ", ",
                              )
                            : null;
                        const eta = etaSuffix("scan");
                        return names
                          ? t("header.progress.scanFolders", {
                              names,
                              done: scanProgress.done,
                              total: scanProgress.total,
                            }) + eta
                          : t("header.progress.scanImages", {
                              done: scanProgress.done,
                              total: scanProgress.total,
                            }) + eta;
                      })()
                    : hasRescanProgress && rescanProgress
                      ? t("header.progress.rescan", {
                          done: rescanProgress.done,
                          total: rescanProgress.total,
                        }) + etaSuffix("rescan")
                      : hashProgress && hashProgress.total > 0
                        ? t("header.progress.hashes", {
                            done: hashProgress.done,
                            total: hashProgress.total,
                          }) + etaSuffix("hash")
                        : hasSimilarityProgress && similarityProgress
                          ? t("header.progress.similarity") +
                            etaSuffix("similarity")
                          : hasSearchStatsProgress && searchStatsProgress
                            ? t("header.progress.searchStats", {
                                done: searchStatsProgress.done,
                                total: searchStatsProgress.total,
                              }) + etaSuffix("searchStats")
                            : scanPhase
                              ? t(`header.progress.phase.${scanPhase}`)
                              : t("header.progress.working")}
              </span>
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

        <HeaderSearchSection
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={onAdvancedFiltersChange}
          availableResolutions={availableResolutions}
          availableModels={availableModels}
        />
        <HeaderPanelButtons
          activePanel={activePanel}
          onPanelChange={onPanelChange}
          onStartTour={onStartTour}
          devMode={devMode}
        />
      </div>
    </header>
  );
});

Header.displayName = "Header";
