import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  startTransition,
} from "react";
import { Toaster, toast } from "sonner";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { ImageGallery } from "@/components/image-gallery";
import { ImageDetail } from "@/components/image-detail";
import { SettingsView } from "@/components/settings-view";
import { CategoryDialog } from "@/components/category-dialog";
import { GenerationView } from "@/components/generation-view";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { useNaiGenSettings } from "@/hooks/useNaiGenSettings";
import type { ImageData } from "@/components/image-card";
import type { PromptToken } from "@/lib/token";
import type {
  ImageRow,
  Category,
  SimilarGroup,
  ImageListQuery,
} from "@preload/index.d";
import type { AdvancedFilter } from "@/lib/advanced-filter";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/App");
const CATEGORY_ORDER_STORAGE_KEY = "konomi-category-order";

function parseTokens(json: string | undefined): PromptToken[] {
  try {
    const parsed = JSON.parse(json ?? "[]");
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    if (typeof parsed[0] === "string")
      return (parsed as string[]).map((text) => ({ text, weight: 1 }));
    return parsed as PromptToken[];
  } catch {
    return [];
  }
}

function rowToImageData(row: ImageRow): ImageData {
  return {
    id: String(row.id),
    path: row.path,
    src: `konomi://local/${encodeURIComponent(row.path.replace(/\\/g, "/"))}`,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    characterPrompts: (() => {
      try {
        return JSON.parse(row.characterPrompts) as string[];
      } catch {
        return [];
      }
    })(),
    tokens: parseTokens(row.promptTokens),
    negativeTokens: parseTokens(row.negativePromptTokens),
    characterTokens: parseTokens(row.characterPromptTokens),
    category: "",
    tags: [],
    fileModifiedAt: new Date(row.fileModifiedAt).toISOString(),
    isFavorite: row.isFavorite,
    pHash: row.pHash,
    source: row.source,
    folderId: row.folderId,
    model: row.model,
    seed: row.seed,
    width: row.width,
    height: row.height,
    cfgScale: row.cfgScale,
    cfgRescale: row.cfgRescale,
    noiseSchedule: row.noiseSchedule,
    varietyPlus: row.varietyPlus,
    sampler: row.sampler,
    steps: row.steps,
  };
}

function readCategoryOrder(): number[] {
  try {
    const raw = localStorage.getItem(CATEGORY_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => Number.isInteger(id));
  } catch {
    return [];
  }
}

function writeCategoryOrder(ids: number[]): void {
  try {
    localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage errors
  }
}

function applyCategoryOrder(
  inputCategories: Category[],
  preferredOrder?: number[],
): Category[] {
  const builtin = inputCategories
    .filter((cat) => cat.isBuiltin)
    .sort((a, b) => a.order - b.order);
  const custom = inputCategories.filter((cat) => !cat.isBuiltin);
  const order = preferredOrder ?? readCategoryOrder();
  const customMap = new Map(custom.map((cat) => [cat.id, cat]));
  const orderedCustom: Category[] = [];

  for (const id of order) {
    const cat = customMap.get(id);
    if (!cat) continue;
    orderedCustom.push(cat);
    customMap.delete(id);
  }

  const remainingCustom = custom.filter((cat) => customMap.has(cat.id));
  const normalizedCustom = [...orderedCustom, ...remainingCustom];
  writeCategoryOrder(normalizedCustom.map((cat) => cat.id));

  return [...builtin, ...normalizedCustom];
}

function getBuiltinCategoryKind(
  category: Category | undefined,
): "favorites" | "random" | null {
  if (!category?.isBuiltin) return null;
  return category.order === 1 ? "random" : "favorites";
}

export default function App() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const { outputFolder, setOutputFolder, resetOutputFolder } =
    useNaiGenSettings();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<number>>(
    () => {
      try {
        const stored = localStorage.getItem("konomi-selected-folders");
        return stored ? new Set<number>(JSON.parse(stored)) : new Set();
      } catch {
        return new Set();
      }
    },
  );
  const [activeView, setActiveView] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "compact" | "list">("grid");
  const [sortBy, setSortBy] = useState<
    "recent" | "oldest" | "favorites" | "name"
  >("recent");
  const [images, setImages] = useState<ImageData[]>([]);
  const [totalImageCount, setTotalImageCount] = useState(0);
  const [galleryPage, setGalleryPage] = useState(1);
  const [galleryTotalPages, setGalleryTotalPages] = useState(1);
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<
    "gallery" | "generator" | "settings"
  >("gallery");
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      return Number(localStorage.getItem("konomi-sidebar-width")) || 288;
    } catch {
      return 288;
    }
  });
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const currentSidebarWidth = useRef(sidebarWidth);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = sidebarWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarWidth],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const next = Math.max(
        180,
        Math.min(480, dragStartWidth.current + e.clientX - dragStartX.current),
      );
      currentSidebarWidth.current = next;
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(
          "konomi-sidebar-width",
          String(currentSidebarWidth.current),
        );
      } catch {
        /* ignore */
      }
    };
    const onUnload = () => {
      try {
        localStorage.setItem(
          "konomi-sidebar-width",
          String(currentSidebarWidth.current),
        );
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
  const [scanning, setScanning] = useState(false);
  const [activeScanFolderIds, setActiveScanFolderIds] = useState<Set<number>>(
    new Set(),
  );
  const [rollbackFolderIds, setRollbackFolderIds] = useState<Set<number>>(
    new Set(),
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hashProgress, setHashProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [scanProgress, setScanProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [similarGroups, setSimilarGroups] = useState<SimilarGroup[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    null,
  );
  const [randomSeed, setRandomSeed] = useState(() =>
    Math.floor(Math.random() * 0x7fffffff),
  );
  const [categoryDialogImage, setCategoryDialogImage] =
    useState<ImageData | null>(null);
  const [bulkCategoryDialogImages, setBulkCategoryDialogImages] = useState<
    ImageData[] | null
  >(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [scanCancelConfirmOpen, setScanCancelConfirmOpen] = useState(false);
  const [folderRollbackRequest, setFolderRollbackRequest] = useState<{
    id: number;
    folderIds: number[];
  } | null>(null);
  const [scanningFolderNames, setScanningFolderNames] = useState<
    Map<number, string>
  >(new Map());
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilter[]>([]);
  const [pendingGeneratorImport, setPendingGeneratorImport] =
    useState<ImageData | null>(null);
  const [similarImages, setSimilarImages] = useState<ImageData[]>([]);

  const pageRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const listRequestSeqRef = useRef(0);
  const loadImagesPageRef = useRef<() => Promise<void>>(async () => {});
  const analyzeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanPromiseRef = useRef<Promise<void> | null>(null);
  const scanningRef = useRef(false);
  const analyzingRef = useRef(false);
  const rollbackRequestSeqRef = useRef(0);
  const similarityThresholdRef = useRef(settings.similarityThreshold);
  const mountedRef = useRef(false);

  useEffect(() => {
    similarityThresholdRef.current = settings.similarityThreshold;
  }, [settings.similarityThreshold]);

  useEffect(() => {
    const theme = settings.theme ?? "dark";
    const applyTheme = (isDark: boolean) => {
      document.documentElement.dataset.theme = isDark ? "dark" : "white";
      document.documentElement.classList.toggle("dark", isDark);
    };
    if (theme === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mq.matches);
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    applyTheme(theme === "dark");
    return undefined;
  }, [settings.theme]);

  const selectedFolderIdList = useMemo(
    () => [...selectedFolderIds].sort((a, b) => a - b),
    [selectedFolderIds],
  );
  const selectedCategory = useMemo(
    () => categories.find((cat) => cat.id === selectedCategoryId),
    [categories, selectedCategoryId],
  );
  const resolutionFilters = useMemo(
    () =>
      advancedFilters
        .filter(
          (f): f is Extract<AdvancedFilter, { type: "resolution" }> =>
            f.type === "resolution",
        )
        .map((f) => ({ width: f.width, height: f.height })),
    [advancedFilters],
  );
  const modelFilters = useMemo(
    () =>
      advancedFilters
        .filter(
          (f): f is Extract<AdvancedFilter, { type: "model" }> =>
            f.type === "model",
        )
        .map((f) => f.value),
    [advancedFilters],
  );
  const listBaseQuery = useMemo<Omit<ImageListQuery, "page">>(
    () => ({
      pageSize: settings.pageSize,
      folderIds: selectedFolderIdList,
      searchQuery,
      sortBy,
      onlyRecent: activeView === "recent",
      recentDays: settings.recentDays,
      customCategoryId:
        selectedCategory && !selectedCategory.isBuiltin
          ? selectedCategory.id
          : null,
      builtinCategory: getBuiltinCategoryKind(selectedCategory),
      randomSeed,
      resolutionFilters,
      modelFilters,
    }),
    [
      settings.pageSize,
      selectedFolderIdList,
      searchQuery,
      sortBy,
      activeView,
      settings.recentDays,
      selectedCategory,
      randomSeed,
      resolutionFilters,
      modelFilters,
    ],
  );

  useEffect(() => {
    setGalleryPage(1);
  }, [listBaseQuery]);

  const loadImagesPage = useCallback(async () => {
    const requestId = ++listRequestSeqRef.current;
    try {
      const result = await window.image.listPage({
        ...listBaseQuery,
        page: galleryPage,
      });
      if (requestId !== listRequestSeqRef.current) return;
      startTransition(() => {
        setImages(result.rows.map(rowToImageData));
        setTotalImageCount(result.totalCount);
        setGalleryTotalPages(result.totalPages);
      });
      if (galleryPage > result.totalPages) {
        setGalleryPage(result.totalPages);
      }
    } catch (e: unknown) {
      if (requestId !== listRequestSeqRef.current) return;
      toast.error(
        `???筌왖 筌뤴뫖以?嚥≪뮆諭???쎈솭: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [galleryPage, listBaseQuery]);

  const schedulePageRefresh = useCallback((delay = 120) => {
    if (pageRefreshTimerRef.current) clearTimeout(pageRefreshTimerRef.current);
    pageRefreshTimerRef.current = setTimeout(() => {
      void loadImagesPageRef.current();
    }, delay);
  }, []);

  useEffect(() => {
    loadImagesPageRef.current = loadImagesPage;
  }, [loadImagesPage]);

  useEffect(() => {
    void loadImagesPage();
  }, [loadImagesPage]);

  const scheduleAnalysis = useCallback((delay = 3000) => {
    if (analyzeTimerRef.current) clearTimeout(analyzeTimerRef.current);
    analyzeTimerRef.current = setTimeout(async () => {
      if (scanningRef.current) {
        log.debug("Analysis delayed because scan is running");
        scheduleAnalysis(1000);
        return;
      }
      const startedAt = Date.now();
      log.info("Analysis started", { delayMs: delay });
      analyzingRef.current = true;
      setIsAnalyzing(true);
      setHashProgress(null);
      try {
        await window.image.computeHashes();
        const groups = await window.image.similarGroups(
          similarityThresholdRef.current,
        );
        setSimilarGroups(groups);
        log.info("Analysis completed", {
          elapsedMs: Date.now() - startedAt,
          groups: groups.length,
        });
      } catch (e: unknown) {
        log.error("Analysis failed", {
          elapsedMs: Date.now() - startedAt,
          error: e instanceof Error ? e.message : String(e),
        });
        toast.error(
          `?대?吏 遺꾩꽍 ?ㅽ뙣: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        analyzingRef.current = false;
        setHashProgress(null);
        setIsAnalyzing(false);
      }
    }, delay);
  }, []);

  const runScan = useCallback(
    (options?: { detectDuplicates?: boolean }) => {
      if (scanPromiseRef.current) {
        log.debug("Scan request deduped");
        return scanPromiseRef.current;
      }
      const startedAt = Date.now();
      log.info("Scan started", { options });
      scanningRef.current = true;
      setScanning(true);
      setScanProgress(null);
      const orderedFolderIds = (() => {
        try {
          const raw = localStorage.getItem("konomi-folder-order");
          if (!raw) return undefined;
          const parsed = JSON.parse(raw) as unknown;
          if (!Array.isArray(parsed)) return undefined;
          const ids = parsed.filter((id): id is number => Number.isInteger(id));
          return ids.length > 0 ? ids : undefined;
        } catch {
          return undefined;
        }
      })();
      const scanPromise = window.image
        .scan({ ...options, orderedFolderIds })
        .then(() => {
          log.info("Scan completed", { elapsedMs: Date.now() - startedAt });
          schedulePageRefresh(0);
        })
        .catch((e: unknown) => {
          log.error("Scan failed", {
            elapsedMs: Date.now() - startedAt,
            error: e instanceof Error ? e.message : String(e),
          });
          toast.error(
            `?ㅼ틪 ?ㅽ뙣: ${e instanceof Error ? e.message : String(e)}`,
          );
        })
        .finally(() => {
          scanningRef.current = false;
          setScanning(false);
          setScanProgress(null);
          setActiveScanFolderIds(new Set());
          setScanningFolderNames(new Map());
          scanPromiseRef.current = null;
        });
      scanPromiseRef.current = scanPromise;
      return scanPromise;
    },
    [schedulePageRefresh],
  );

  // Auto-analyze when threshold changes (skip initial mount)
  useEffect(() => {
    if (!mountedRef.current) return;
    scheduleAnalysis(500);
  }, [settings.similarityThreshold]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    log.info("App mounted: loading initial data and starting watchers");

    const offBatch = window.image.onBatch((rows) => {
      if (rows.length === 0) return;
      schedulePageRefresh(150);
      if (!scanningRef.current) scheduleAnalysis();
    });

    const offHashProgress = window.image.onHashProgress((data) => {
      if (analyzingRef.current) startTransition(() => setHashProgress(data));
    });
    const offScanProgress = window.image.onScanProgress((data) => {
      if (scanningRef.current) startTransition(() => setScanProgress(data));
    });
    const offScanFolder = window.image.onScanFolder(
      ({ folderId, folderName, active }) => {
        setActiveScanFolderIds((prev) => {
          const next = new Set(prev);
          if (active) next.add(folderId);
          else next.delete(folderId);
          return next;
        });
        setScanningFolderNames((prev) => {
          const next = new Map(prev);
          if (active && folderName) next.set(folderId, folderName);
          else next.delete(folderId);
          return next;
        });
      },
    );

    const offRemoved = window.image.onRemoved((ids) => {
      if (ids.length === 0) return;
      schedulePageRefresh(60);
      scheduleAnalysis();
    });

    window.category
      .list()
      .then((loaded) => setCategories(applyCategoryOrder(loaded)))
      .catch((e: unknown) =>
        toast.error(
          `移댄뀒怨좊━ 濡쒕뱶 ?ㅽ뙣: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );

    runScan({ detectDuplicates: true }).then(() => scheduleAnalysis(0));
    try {
      window.image.watch();
    } catch {
      /* 媛먯떆 ?쒖옉 ?ㅽ뙣 ??議곗슜??臾댁떆 */
    }

    return () => {
      log.info("App unmount cleanup");
      if (pageRefreshTimerRef.current) {
        clearTimeout(pageRefreshTimerRef.current);
        pageRefreshTimerRef.current = null;
      }
      offBatch();
      offRemoved();
      offHashProgress();
      offScanProgress();
      offScanFolder();
    };
  }, [runScan, scheduleAnalysis, schedulePageRefresh]);

  useEffect(() => {
    if (selectedImage) {
      const updated = images.find((img) => img.id === selectedImage.id);
      if (updated) setSelectedImage(updated);
    }
  }, [images, selectedImage]);

  const availableResolutions = useMemo(() => {
    const freq = new Map<
      string,
      { width: number; height: number; count: number }
    >();
    for (const img of images) {
      if (img.width && img.height) {
        const key = `${img.width}x${img.height}`;
        const entry = freq.get(key);
        if (entry) entry.count++;
        else freq.set(key, { width: img.width, height: img.height, count: 1 });
      }
    }
    return Array.from(freq.values())
      .sort((a, b) => b.count - a.count)
      .map(({ width, height }) => ({ width, height }));
  }, [images]);

  const availableModels = useMemo(() => {
    const freq = new Map<string, number>();
    for (const img of images) {
      if (img.model != null)
        freq.set(img.model, (freq.get(img.model) ?? 0) + 1);
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => m);
  }, [images]);

  useEffect(() => {
    localStorage.setItem(
      "konomi-selected-folders",
      JSON.stringify([...selectedFolderIds]),
    );
  }, [selectedFolderIds]);

  const handleFolderToggle = useCallback((id: number) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleFolderAdded = useCallback(
    (folderId: number) => {
      log.info("Folder added", { folderId });
      setSelectedFolderIds((prev) => new Set([...prev, folderId]));
      setRollbackFolderIds((prev) => new Set([...prev, folderId]));
      setActiveScanFolderIds((prev) => new Set([...prev, folderId]));
      schedulePageRefresh(0);
      runScan().then(() => {
        setRollbackFolderIds((prev) => {
          const s = new Set(prev);
          s.delete(folderId);
          return s;
        });
        scheduleAnalysis(0);
      });
    },
    [runScan, scheduleAnalysis, schedulePageRefresh],
  );

  const handleFolderCancelled = useCallback(
    (id: number) => {
      log.info("Folder add rollback/cancelled", { folderId: id });
      setSelectedFolderIds((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
      setRollbackFolderIds((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
      setActiveScanFolderIds((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
      schedulePageRefresh(0);
      scheduleAnalysis(500);
    },
    [scheduleAnalysis, schedulePageRefresh],
  );

  const handleFolderRemoved = useCallback(
    (id: number) => {
      log.info("Folder removed", { folderId: id });
      setSelectedFolderIds((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
      setRollbackFolderIds((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
      setActiveScanFolderIds((prev) => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
      schedulePageRefresh(0);
      scheduleAnalysis(500);
      runScan();
    },
    [runScan, scheduleAnalysis, schedulePageRefresh],
  );

  const handleCategorySelect = useCallback((id: number | null) => {
    log.debug("Category selected", { categoryId: id });
    setSelectedCategoryId(id);
  }, []);

  const handleCategoryCreate = useCallback((name: string) => {
    log.info("Creating category", { name });
    window.category
      .create(name)
      .then((cat) =>
        setCategories((prev) => applyCategoryOrder([...prev, cat])),
      )
      .catch((e: unknown) =>
        toast.error(
          `移댄뀒怨좊━ ?앹꽦 ?ㅽ뙣: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  }, []);

  const handleCategoryRename = useCallback((id: number, name: string) => {
    log.info("Renaming category", { categoryId: id, name });
    window.category
      .rename(id, name)
      .then((updated) =>
        setCategories((prev) => prev.map((c) => (c.id === id ? updated : c))),
      )
      .catch((e: unknown) =>
        toast.error(
          `移댄뀒怨좊━ ?대쫫 蹂寃??ㅽ뙣: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  }, []);

  const handleCategoryReorder = useCallback((ids: number[]) => {
    log.info("Reordering categories", { ids });
    setCategories((prev) => applyCategoryOrder(prev, ids));
  }, []);

  const handleCategoryDelete = useCallback(
    (id: number) => {
      log.info("Deleting category", { categoryId: id });
      window.category
        .delete(id)
        .then(() => {
          setCategories((prev) =>
            applyCategoryOrder(prev.filter((c) => c.id !== id)),
          );
          if (selectedCategoryId === id) setSelectedCategoryId(null);
          schedulePageRefresh(0);
        })
        .catch((e: unknown) =>
          toast.error(
            `移댄뀒怨좊━ ??젣 ?ㅽ뙣: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
    },
    [schedulePageRefresh, selectedCategoryId],
  );

  const handleCategoryAddByPrompt = useCallback(
    (id: number, query: string) => {
      log.info("Adding category images by prompt", { categoryId: id, query });
      window.category
        .addByPrompt(id, query)
        .then(() => {
          if (selectedCategoryId === id) schedulePageRefresh(0);
        })
        .catch((e: unknown) =>
          toast.error(
            `?대?吏 異붽? ?ㅽ뙣: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
    },
    [schedulePageRefresh, selectedCategoryId],
  );

  const handleToggleFavorite = useCallback(
    (id: string) => {
      log.debug("Toggling favorite", { imageId: id });
      setImages((prev) => {
        const img = prev.find((i) => i.id === id);
        if (!img) return prev;
        window.image
          .setFavorite(parseInt(id), !img.isFavorite)
          .then(() => schedulePageRefresh(0))
          .catch((e: unknown) => {
            toast.error(
              `利먭꺼李얘린 ?ㅼ젙 ?ㅽ뙣: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
        return prev.map((i) =>
          i.id === id ? { ...i, isFavorite: !i.isFavorite } : i,
        );
      });
      setSelectedImage((prev) =>
        prev?.id === id ? { ...prev, isFavorite: !prev.isFavorite } : prev,
      );
    },
    [schedulePageRefresh],
  );

  const handleCopyPrompt = useCallback((prompt: string) => {
    navigator.clipboard
      .writeText(prompt)
      .catch(() => toast.error("?대┰蹂대뱶 蹂듭궗 ?ㅽ뙣"));
  }, []);

  const handleReveal = useCallback((path: string) => {
    window.image.revealInExplorer(path);
  }, []);

  const handleDeleteImage = useCallback((id: string) => {
    log.info("Deleting image requested", { imageId: id });
    setDeleteConfirmId(id);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    const img = images.find((i) => i.id === deleteConfirmId);
    if (img) {
      window.image.delete(img.path).catch((e: unknown) => {
        toast.error(
          `?대?吏 ??젣 ?ㅽ뙣: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
      if (selectedImage?.id === deleteConfirmId) {
        setSelectedImage(null);
        setIsDetailOpen(false);
      }
      schedulePageRefresh(60);
    }
    setDeleteConfirmId(null);
  }, [deleteConfirmId, images, schedulePageRefresh, selectedImage?.id]);

  const handleCancelScan = useCallback(() => {
    setScanCancelConfirmOpen(true);
  }, []);

  const waitForScanToStop = useCallback(async (timeoutMs = 15000) => {
    const start = Date.now();
    while (scanningRef.current && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }, []);

  const confirmCancelScan = useCallback(async () => {
    log.warn("Scan cancel requested");
    setScanCancelConfirmOpen(false);
    const rollbackTargetFolderIds = Array.from(rollbackFolderIds);
    await window.image.cancelScan().catch(() => {});
    await waitForScanToStop();
    schedulePageRefresh(0);

    if (rollbackTargetFolderIds.length > 0) {
      rollbackRequestSeqRef.current += 1;
      setFolderRollbackRequest({
        id: rollbackRequestSeqRef.current,
        folderIds: rollbackTargetFolderIds,
      });
      setRollbackFolderIds((prev) => {
        const next = new Set(prev);
        rollbackTargetFolderIds.forEach((folderId) => next.delete(folderId));
        return next;
      });
    }
  }, [rollbackFolderIds, schedulePageRefresh, waitForScanToStop]);

  const handleSendToGenerator = useCallback((image: ImageData) => {
    setPendingGeneratorImport(image);
    setActivePanel("generator");
  }, []);

  const handleChangeCategory = useCallback((image: ImageData) => {
    setBulkCategoryDialogImages(null);
    setCategoryDialogImage(image);
  }, []);

  const handleBulkChangeCategory = useCallback((targets: ImageData[]) => {
    if (targets.length === 0) return;
    setCategoryDialogImage(null);
    setBulkCategoryDialogImages(targets);
  }, []);

  const handleRandomRefresh = useCallback(() => {
    log.info("Random pick refreshed");
    setRandomSeed((seed) => seed + 1);
  }, []);

  const handleCategoryDialogClose = useCallback(() => {
    setCategoryDialogImage(null);
    setBulkCategoryDialogImages(null);
    schedulePageRefresh(0);
  }, [schedulePageRefresh]);

  useEffect(() => {
    if (!selectedImage) {
      setSimilarImages([]);
      return;
    }
    const imageId = parseInt(selectedImage.id, 10);
    const group = similarGroups.find((g) => g.imageIds.includes(imageId));
    if (!group || group.imageIds.length === 0) {
      setSimilarImages([]);
      return;
    }
    let cancelled = false;
    window.image
      .listByIds(group.imageIds)
      .then((rows) => {
        if (cancelled) return;
        setSimilarImages(rows.map(rowToImageData));
      })
      .catch(() => {
        if (!cancelled) setSimilarImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedImage, similarGroups]);

  const selectedIndex = useMemo(
    () =>
      selectedImage
        ? images.findIndex((img) => img.id === selectedImage.id)
        : -1,
    [images, selectedImage],
  );

  const handlePrev = useCallback(() => {
    if (selectedIndex > 0) setSelectedImage(images[selectedIndex - 1]);
  }, [images, selectedIndex]);

  const handleNext = useCallback(() => {
    if (selectedIndex < images.length - 1)
      setSelectedImage(images[selectedIndex + 1]);
  }, [images, selectedIndex]);

  const handleImageClick = useCallback((image: ImageData) => {
    setSelectedImage(image);
    setIsDetailOpen(true);
  }, []);

  return (
    <div className="h-screen bg-background flex flex-col">
      <Toaster richColors position="bottom-right" />
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activePanel={activePanel}
        onPanelChange={setActivePanel}
        scanning={scanning}
        isAnalyzing={isAnalyzing}
        hashProgress={hashProgress}
        scanProgress={scanProgress}
        scanningFolderNames={scanningFolderNames}
        onCancelScan={handleCancelScan}
        advancedFilters={advancedFilters}
        onAdvancedFiltersChange={setAdvancedFilters}
        availableResolutions={availableResolutions}
        availableModels={availableModels}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* GenerationView - ??긽 留덉슫?? CSS濡쒕쭔 ?④? */}
        <div
          className={
            activePanel === "generator"
              ? "flex flex-1 overflow-hidden"
              : "hidden"
          }
        >
          <GenerationView
            pendingImport={pendingGeneratorImport}
            onClearPendingImport={() => setPendingGeneratorImport(null)}
            outputFolder={outputFolder}
          />
        </div>

        {/* 媛ㅻ윭由??곸뿭 - ??긽 留덉슫?? CSS濡쒕쭔 ?④? */}
        <div
          className={
            activePanel !== "generator"
              ? "flex flex-1 overflow-hidden"
              : "hidden"
          }
        >
          <div
            className="relative flex-none h-full"
            style={{ width: sidebarWidth }}
          >
            <Sidebar
              rollbackRequest={folderRollbackRequest}
              activeView={activeView}
              onViewChange={setActiveView}
              selectedFolderIds={selectedFolderIds}
              onFolderToggle={handleFolderToggle}
              onFolderRemoved={handleFolderRemoved}
              onFolderAdded={handleFolderAdded}
              onFolderCancelled={handleFolderCancelled}
              scanningFolderIds={activeScanFolderIds}
              scanning={scanning}
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              onCategorySelect={handleCategorySelect}
              onCategoryCreate={handleCategoryCreate}
              onCategoryRename={handleCategoryRename}
              onCategoryDelete={handleCategoryDelete}
              onCategoryReorder={handleCategoryReorder}
              onCategoryAddByPrompt={handleCategoryAddByPrompt}
              onRandomRefresh={handleRandomRefresh}
              isAnalyzing={isAnalyzing}
            />
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10"
              onMouseDown={handleResizeStart}
            />
          </div>
          {activePanel === "settings" && (
            <SettingsView
              settings={settings}
              onUpdate={updateSettings}
              onReset={resetSettings}
              onClose={() => setActivePanel("gallery")}
              outputFolder={outputFolder}
              onOutputFolderChange={setOutputFolder}
              onResetOutputFolder={resetOutputFolder}
              onResetHashes={async () => {
                try {
                  await window.image.resetHashes();
                  scheduleAnalysis(0);
                } catch (e: unknown) {
                  toast.error(
                    `?댁떆 珥덇린???ㅽ뙣: ${e instanceof Error ? e.message : String(e)}`,
                  );
                }
              }}
              isAnalyzing={isAnalyzing}
            />
          )}
          {/* ImageGallery - ??긽 留덉슫?? ?ㅼ젙 ?붾㈃???뚮쭔 ?④? */}
          <div
            className={
              activePanel === "settings"
                ? "hidden"
                : "flex flex-1 overflow-hidden"
            }
          >
            <ImageGallery
              images={images}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              sortBy={sortBy}
              onSortChange={setSortBy}
              onToggleFavorite={handleToggleFavorite}
              onCopyPrompt={handleCopyPrompt}
              onImageClick={handleImageClick}
              onReveal={handleReveal}
              onDelete={handleDeleteImage}
              onChangeCategory={handleChangeCategory}
              onBulkChangeCategory={handleBulkChangeCategory}
              onSendToGenerator={handleSendToGenerator}
              totalCount={totalImageCount}
              pageSize={settings.pageSize}
              page={galleryPage}
              totalPages={galleryTotalPages}
              onPageChange={setGalleryPage}
            />
          </div>
        </div>
      </div>

      <CategoryDialog
        image={categoryDialogImage}
        images={bulkCategoryDialogImages}
        categories={categories}
        onClose={handleCategoryDialogClose}
      />

      <Dialog
        open={scanCancelConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setScanCancelConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>?ㅼ틪 痍⑥냼</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            吏꾪뻾 以묒씤 ?대뜑 ?ㅼ틪??痍⑥냼?좉퉴??
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">怨꾩냽 ?ㅼ틪</Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmCancelScan}>
              痍⑥냼
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>?대?吏 ??젣</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            ?뺣쭚濡????대?吏瑜???젣?좉퉴?? ?뚯씪???댁??듭쑝濡??대룞?⑸땲??
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">痍⑥냼</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              ??젣
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageDetail
        image={selectedImage}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onToggleFavorite={handleToggleFavorite}
        onCopyPrompt={handleCopyPrompt}
        prevImage={selectedIndex > 0 ? images[selectedIndex - 1] : null}
        nextImage={
          selectedIndex < images.length - 1 ? images[selectedIndex + 1] : null
        }
        onPrev={handlePrev}
        onNext={handleNext}
        similarImages={similarImages}
        onSimilarImageClick={setSelectedImage}
        similarPageSize={settings.similarPageSize}
      />
    </div>
  );
}
