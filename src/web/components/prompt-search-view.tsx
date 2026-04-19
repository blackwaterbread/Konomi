import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  X,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useLocaleFormatters } from "@/lib/formatters";
import { useTranslation } from "react-i18next";

type PromptTagSearchResult = {
  rows: Array<{ tag: string; postCount: number }>;
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type SortBy = "name" | "count";
type Order = "asc" | "desc";

interface PromptSearchViewProps {
  onClose: () => void;
}

export const PromptSearchView = memo(function PromptSearchView({
  onClose,
}: PromptSearchViewProps) {
  const { t } = useTranslation();
  const { formatNumber } = useLocaleFormatters();

  const [nameFilter, setNameFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("count");
  const [order, setOrder] = useState<Order>("desc");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [result, setResult] = useState<PromptTagSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);

  const fetchTags = useCallback(
    (overrides?: { name?: string; sortBy?: SortBy; order?: Order; page?: number }) => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      void window.promptBuilder
        .searchTags({
          name: overrides?.name ?? nameFilter,
          sortBy: overrides?.sortBy ?? sortBy,
          order: overrides?.order ?? order,
          page: overrides?.page ?? page,
          pageSize,
        })
        .then((res) => {
          if (seq !== requestSeqRef.current) return;
          setResult(res);
        })
        .catch(() => {
          if (seq !== requestSeqRef.current) return;
          setResult(null);
        })
        .finally(() => {
          if (seq !== requestSeqRef.current) return;
          setLoading(false);
        });
    },
    [nameFilter, sortBy, order, page, pageSize],
  );

  // Fetch on any parameter change; debounce only nameFilter
  const prevNameRef = useRef(nameFilter);
  useEffect(() => {
    const nameChanged = prevNameRef.current !== nameFilter;
    prevNameRef.current = nameFilter;

    if (nameChanged) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchTags();
      }, 300);
    } else {
      fetchTags();
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [nameFilter, sortBy, order, page]);

  const toggleOrder = () => {
    const next = order === "asc" ? "desc" : "asc";
    setOrder(next);
    setPage(1);
  };

  const handleSortChange = (value: string) => {
    setSortBy(value as SortBy);
    setPage(1);
  };

  const totalPages = result?.totalPages ?? 1;
  const totalCount = result?.totalCount ?? 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        {/* Row 1: search input (full width on mobile, constrained on desktop) */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("promptSearch.namePlaceholder")}
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              className="pl-10 pr-8 bg-secondary border-border"
            />
            {nameFilter && (
              <button
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setNameFilter("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Desktop-only: close button */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:flex shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            {t("common.close")}
          </Button>
        </div>

        {/* Row 2: sort + order + count */}
        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={handleSortChange}>
            <SelectTrigger className="w-35 bg-secondary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">{t("promptSearch.sortName")}</SelectItem>
              <SelectItem value="count">{t("promptSearch.sortCount")}</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-9 w-9 text-muted-foreground hover:text-foreground"
            onClick={toggleOrder}
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>

          <span className="text-xs text-muted-foreground whitespace-nowrap ml-auto select-none tabular-nums">
            {t("promptSearch.totalCount", { total: formatNumber(totalCount) })}
          </span>
        </div>
      </div>

      {/* Tag table */}
      <div className="flex-1 overflow-auto">
        {loading && !result && (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {result && result.rows.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            {t("promptSearch.noResults")}
          </div>
        )}
        {result && result.rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b border-border">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                  {t("promptSearch.column.tag")}
                </th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground w-32">
                  {t("promptSearch.column.count")}
                </th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  key={row.tag}
                  className={cn(
                    "border-b border-border/50 hover:bg-accent/50 transition-colors",
                    loading && "opacity-60",
                  )}
                >
                  <td className="px-4 py-1.5 font-mono text-xs">{row.tag}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground text-xs">
                    {formatNumber(row.postCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 border-t border-border px-4 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={page <= 1}
            onClick={() => setPage(1)}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-3 text-xs text-muted-foreground tabular-nums select-none">
            {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={page >= totalPages}
            onClick={() => setPage(totalPages)}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
});
