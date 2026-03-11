import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AdvancedFilter } from "@/lib/advanced-filter";
import { filterKey, filtersEqual } from "@/lib/advanced-filter";

interface AdvancedSearchModalProps {
  open: boolean;
  onClose: () => void;
  activeFilters: AdvancedFilter[];
  onFiltersChange: (filters: AdvancedFilter[]) => void;
  availableResolutions: { width: number; height: number }[];
  availableModels: string[];
}

export function AdvancedSearchModal({
  open,
  onClose,
  activeFilters,
  onFiltersChange,
  availableResolutions,
  availableModels,
}: AdvancedSearchModalProps) {
  const [manualWidth, setManualWidth] = useState("");
  const [manualHeight, setManualHeight] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(-1);

  const modelSuggestions = manualModel.trim()
    ? availableModels
        .filter(
          (m) =>
            m.toLowerCase().includes(manualModel.toLowerCase().trim()) &&
            m !== manualModel,
        )
        .slice(0, 8)
    : [];

  const isActive = (f: AdvancedFilter) =>
    activeFilters.some((af) => filtersEqual(af, f));

  const toggleFilter = (f: AdvancedFilter) => {
    if (isActive(f)) {
      onFiltersChange(activeFilters.filter((af) => !filtersEqual(af, f)));
    } else {
      onFiltersChange([...activeFilters, f]);
    }
  };

  const addManualResolution = () => {
    const w = parseInt(manualWidth);
    const h = parseInt(manualHeight);
    if (!w || !h) return;
    const f: AdvancedFilter = { type: "resolution", width: w, height: h };
    if (!isActive(f)) onFiltersChange([...activeFilters, f]);
    setManualWidth("");
    setManualHeight("");
  };

  const addManualModel = (value?: string) => {
    const v = (value ?? manualModel).trim();
    if (!v) return;
    const f: AdvancedFilter = { type: "model", value: v };
    if (!isActive(f)) onFiltersChange([...activeFilters, f]);
    setManualModel("");
    setSuggestionIndex(-1);
  };

  const handleModelKeyDown = (e: React.KeyboardEvent) => {
    if (modelSuggestions.length === 0) {
      if (e.key === "Enter") addManualModel();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestionIndex((i) => Math.min(i + 1, modelSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestionIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestionIndex >= 0) {
        setManualModel(modelSuggestions[suggestionIndex]);
        setSuggestionIndex(-1);
      } else {
        addManualModel();
      }
    } else if (e.key === "Escape") {
      setSuggestionIndex(-1);
      setManualModel("");
    }
  };

  const chipClass = (active: boolean) =>
    cn(
      "px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer",
      active
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-secondary text-secondary-foreground border-border hover:border-primary/50",
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>고급 검색</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">해상도</p>
            {availableResolutions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                {availableResolutions.map((r) => {
                  const f: AdvancedFilter = {
                    type: "resolution",
                    width: r.width,
                    height: r.height,
                  };
                  return (
                    <button
                      key={filterKey(f)}
                      onClick={() => toggleFilter(f)}
                      className={chipClass(isActive(f))}
                    >
                      {r.width}×{r.height}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                placeholder="너비"
                value={manualWidth}
                onChange={(e) => setManualWidth(e.target.value)}
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") addManualResolution();
                }}
              />
              <span className="text-muted-foreground text-xs shrink-0">×</span>
              <Input
                type="number"
                placeholder="높이"
                value={manualHeight}
                onChange={(e) => setManualHeight(e.target.value)}
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") addManualResolution();
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                className="h-8 shrink-0"
                onClick={addManualResolution}
              >
                추가
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">모델</p>
            {availableModels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                {availableModels.map((m) => {
                  const f: AdvancedFilter = { type: "model", value: m };
                  return (
                    <button
                      key={filterKey(f)}
                      onClick={() => toggleFilter(f)}
                      className={chipClass(isActive(f))}
                    >
                      {m || "(모든 모델)"}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  placeholder="모델명 직접 입력"
                  value={manualModel}
                  onChange={(e) => {
                    setManualModel(e.target.value);
                    setSuggestionIndex(-1);
                  }}
                  className="h-8 text-xs"
                  onKeyDown={handleModelKeyDown}
                />
                {modelSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border border-border rounded-md shadow-md overflow-hidden">
                    {modelSuggestions.map((m, i) => (
                      <button
                        key={m}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-xs truncate",
                          i === suggestionIndex
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent hover:text-accent-foreground",
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setManualModel(m);
                          setSuggestionIndex(-1);
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => addManualModel()}
              >
                추가
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
