import { useState } from "react";
import {
  Search,
  Settings,
  Sparkles,
  Info,
  X,
  Loader2,
  ImagePlus,
  Images,
  SlidersHorizontal,
} from "lucide-react";
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

type ActivePanel = "gallery" | "generator" | "settings";

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activePanel: ActivePanel;
  onPanelChange: (panel: ActivePanel) => void;
  scanning?: boolean;
  isAnalyzing?: boolean;
  hashProgress?: { done: number; total: number } | null;
  scanProgress?: { done: number; total: number } | null;
  searchStatsProgress?: { done: number; total: number } | null;
  scanningFolderNames?: Map<number, string>;
  onCancelScan?: () => void;
  advancedFilters: AdvancedFilter[];
  onAdvancedFiltersChange: (filters: AdvancedFilter[]) => void;
  availableResolutions: { width: number; height: number }[];
  availableModels: string[];
}

export function Header({
  searchQuery,
  onSearchChange,
  activePanel,
  onPanelChange,
  scanning,
  isAnalyzing,
  hashProgress,
  scanProgress,
  searchStatsProgress,
  scanningFolderNames,
  onCancelScan,
  advancedFilters,
  onAdvancedFiltersChange,
  availableResolutions,
  availableModels,
}: HeaderProps) {
  const hasSearchStatsProgress =
    !!searchStatsProgress &&
    searchStatsProgress.total > 0 &&
    searchStatsProgress.done < searchStatsProgress.total;
  const activeProgress =
    scanProgress ??
    hashProgress ??
    (hasSearchStatsProgress ? searchStatsProgress : null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [inputValue, setInputValue] = useState(searchQuery);

  const commitSearch = () => onSearchChange(inputValue);
  const clearSearch = () => {
    setInputValue("");
    onSearchChange("");
  };

  const handlePanelClick = (panel: ActivePanel) => {
    onPanelChange(activePanel === panel ? "gallery" : panel);
  };

  const removeFilter = (f: AdvancedFilter) => {
    onAdvancedFiltersChange(
      advancedFilters.filter((af) => filterKey(af) !== filterKey(f)),
    );
  };

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
      <TooltipProvider delayDuration={300}>
        <div className="flex min-h-16 items-center justify-between px-6 py-3 gap-4">
          <div className="relative flex items-center gap-3 shrink-0">
            <span className="text-xl font-extrabold text-foreground select-none">
              Konomi
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            {(scanning || isAnalyzing || hasSearchStatsProgress) && (
              <div className="absolute left-full ml-3 flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                <span className="tabular-nums select-none">
                  {scanProgress && scanProgress.total > 0
                    ? (() => {
                        const names =
                          scanningFolderNames && scanningFolderNames.size > 0
                            ? Array.from(scanningFolderNames.values()).join(
                                ", ",
                              )
                            : null;
                        return names
                          ? `${names} 폴더 스캔 중 ${scanProgress.done}/${scanProgress.total}`
                          : `이미지 스캔 작업 ${scanProgress.done}/${scanProgress.total}`;
                      })()
                    : hashProgress && hashProgress.total > 0
                      ? `해시 계산 중 ${hashProgress.done}/${hashProgress.total}`
                      : hasSearchStatsProgress && searchStatsProgress
                        ? `검색 통계 집계 중 ${searchStatsProgress.done}/${searchStatsProgress.total}`
                        : "작업 중..."}
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

          <div className="flex flex-1 max-w-2xl flex-col gap-1.5">
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="프롬프트로 이미지 검색..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitSearch();
                  }}
                  className="w-full pl-10 pr-8 bg-secondary border-border focus:border-primary"
                />
                {inputValue && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={clearSearch}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-9 w-9 text-muted-foreground hover:text-foreground"
                    onClick={commitSearch}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>검색</TooltipContent>
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
                <TooltipContent>고급 검색</TooltipContent>
              </Tooltip>
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

          <div className="flex items-center gap-1 shrink-0">
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
              <TooltipContent>이미지 생성</TooltipContent>
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
              <TooltipContent>갤러리</TooltipContent>
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
              <TooltipContent>설정</TooltipContent>
            </Tooltip>
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
              <TooltipContent>프로그램 정보</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      <AdvancedSearchModal
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        activeFilters={advancedFilters}
        onFiltersChange={onAdvancedFiltersChange}
        availableResolutions={availableResolutions}
        availableModels={availableModels}
      />
      <AppInfoDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </header>
  );
}
