import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  SetStateAction,
} from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export type ActivePanel = "gallery" | "generator" | "settings" | "tagSearch";

const TOUR_COMPLETED_KEY = "konomi-tour-completed";
const INITIAL_LANGUAGE_SCREEN_COMPLETED_KEY =
  "konomi-initial-language-selection-completed";
const SIDEBAR_WIDTH_KEY = "konomi-sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 288;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;

interface UseAppShellStateOptions {
  scanningRef: MutableRefObject<boolean>;
  analyzeTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  pendingSimilarityRecalcRef: MutableRefObject<boolean>;
  runAnalysisNow: () => Promise<boolean>;
}

interface UseAppShellStateResult {
  activePanel: ActivePanel;
  setActivePanel: Dispatch<SetStateAction<ActivePanel>>;
  handlePanelChange: (nextPanel: ActivePanel) => Promise<void>;
  sidebarWidth: number;
  handleResizeStart: (event: ReactMouseEvent) => void;
  tourOpen: boolean;
  initialLanguageScreenOpen: boolean;
  showFeatureTour: boolean;
  handleStartTour: () => void;
  handleTourClose: () => void;
  handleInitialLanguageContinue: () => void;
}

function getStoredSidebarWidth() {
  try {
    return (
      Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || DEFAULT_SIDEBAR_WIDTH
    );
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

export function useAppShellState({
  scanningRef,
  analyzeTimerRef,
  pendingSimilarityRecalcRef,
  runAnalysisNow,
}: UseAppShellStateOptions): UseAppShellStateResult {
  const { t } = useTranslation();
  const [activePanel, setActivePanel] = useState<ActivePanel>("gallery");
  const [tourOpen, setTourOpen] = useState(
    () => localStorage.getItem(TOUR_COMPLETED_KEY) !== "true",
  );
  const [initialLanguageScreenOpen, setInitialLanguageScreenOpen] = useState(
    () =>
      localStorage.getItem(TOUR_COMPLETED_KEY) !== "true" &&
      localStorage.getItem(INITIAL_LANGUAGE_SCREEN_COMPLETED_KEY) !== "true",
  );
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const currentSidebarWidth = useRef(sidebarWidth);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      isDragging.current = true;
      dragStartX.current = event.clientX;
      dragStartWidth.current = sidebarWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarWidth],
  );

  useEffect(() => {
    const persistSidebarWidth = () => {
      try {
        localStorage.setItem(
          SIDEBAR_WIDTH_KEY,
          String(currentSidebarWidth.current),
        );
      } catch {
        /* ignore */
      }
    };

    const onMove = (event: MouseEvent) => {
      if (!isDragging.current) return;
      const next = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(
          MAX_SIDEBAR_WIDTH,
          dragStartWidth.current + event.clientX - dragStartX.current,
        ),
      );
      currentSidebarWidth.current = next;
      setSidebarWidth(next);
    };

    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persistSidebarWidth();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("beforeunload", persistSidebarWidth);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("beforeunload", persistSidebarWidth);
    };
  }, []);

  const handlePanelChange = useCallback(
    async (nextPanel: ActivePanel) => {
      if (nextPanel === activePanel) return;

      const leavingSettings =
        activePanel === "settings" && nextPanel !== "settings";
      if (!leavingSettings || !pendingSimilarityRecalcRef.current) {
        setActivePanel(nextPanel);
        return;
      }

      if (scanningRef.current) {
        toast.error(t("error.scanInProgressForSimilarity"));
        return;
      }

      if (analyzeTimerRef.current) {
        clearTimeout(analyzeTimerRef.current);
        analyzeTimerRef.current = null;
      }

      setActivePanel(nextPanel);
      await runAnalysisNow();
    },
    [
      activePanel,
      analyzeTimerRef,
      pendingSimilarityRecalcRef,
      runAnalysisNow,
      scanningRef,
      t,
    ],
  );

  const handleStartTour = useCallback(() => {
    setTourOpen(true);
  }, []);

  const handleTourClose = useCallback(() => {
    setTourOpen(false);
    setActivePanel("gallery");
    try {
      localStorage.setItem(TOUR_COMPLETED_KEY, "true");
    } catch {
      /* ignore */
    }
  }, []);

  const handleInitialLanguageContinue = useCallback(() => {
    try {
      localStorage.setItem(INITIAL_LANGUAGE_SCREEN_COMPLETED_KEY, "true");
    } catch {
      /* ignore */
    }
    setInitialLanguageScreenOpen(false);
  }, []);

  return {
    activePanel,
    setActivePanel,
    handlePanelChange,
    sidebarWidth,
    handleResizeStart,
    tourOpen,
    initialLanguageScreenOpen,
    showFeatureTour: tourOpen && !initialLanguageScreenOpen,
    handleStartTour,
    handleTourClose,
    handleInitialLanguageContinue,
  };
}
