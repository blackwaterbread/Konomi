import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TourStep {
  targetSelector: string;
  title: string;
  description: string;
  placement: "top" | "bottom" | "left" | "right";
  panel?: "gallery" | "generator";
  action?: string;
}

type TourStepKey =
  | "search"
  | "panels"
  | "views"
  | "folders"
  | "categories"
  | "galleryToolbar"
  | "galleryKeyboard"
  | "promptInput"
  | "promptCursor"
  | "tokenChipPopover"
  | "groupChip"
  | "promptGroups"
  | "wildcard"
  | "autoGenerate"
  | "generate";

type TourStepTemplate = Omit<TourStep, "title" | "description"> & {
  key: TourStepKey;
};

const TOUR_STEP_TEMPLATES: TourStepTemplate[] = [
  {
    key: "search",
    targetSelector: '[data-tour="search"]',
    placement: "bottom",
    panel: "gallery",
  },
  {
    key: "panels",
    targetSelector: '[data-tour="panel-buttons"]',
    placement: "bottom",
    panel: "gallery",
  },
  {
    key: "views",
    targetSelector: '[data-tour="sidebar-views"]',
    placement: "right",
    panel: "gallery",
  },
  {
    key: "folders",
    targetSelector: '[data-tour="sidebar-folders"]',
    placement: "right",
    panel: "gallery",
  },
  {
    key: "categories",
    targetSelector: '[data-tour="sidebar-categories"]',
    placement: "right",
    panel: "gallery",
  },
  {
    key: "galleryToolbar",
    targetSelector: '[data-tour="gallery-toolbar"]',
    placement: "bottom",
    panel: "gallery",
  },
  {
    key: "galleryKeyboard",
    targetSelector: '[data-tour="gallery-toolbar"]',
    placement: "bottom",
    panel: "gallery",
  },
  {
    key: "promptInput",
    targetSelector: '[data-tour="gen-prompt-input"]',
    placement: "bottom",
    panel: "generator",
  },
  {
    key: "promptCursor",
    targetSelector: '[data-tour="gen-prompt-input"]',
    placement: "bottom",
    panel: "generator",
    action: "switch-to-token-mode",
  },
  {
    key: "tokenChipPopover",
    targetSelector: '[data-tour="gen-prompt-input"]',
    placement: "bottom",
    panel: "generator",
    action: "open-token-chip-popover",
  },
  {
    key: "groupChip",
    targetSelector: '[data-tour="gen-prompt-input"]',
    placement: "bottom",
    panel: "generator",
  },
  {
    key: "promptGroups",
    targetSelector: '[data-tour="gen-prompt-group-panel"]',
    placement: "left",
    panel: "generator",
    action: "open-prompt-group-panel",
  },
  {
    key: "wildcard",
    targetSelector: '[data-tour="gen-prompt-input"]',
    placement: "bottom",
    panel: "generator",
  },
  {
    key: "autoGenerate",
    targetSelector: '[data-tour="gen-auto-gen"]',
    placement: "top",
    panel: "generator",
  },
  {
    key: "generate",
    targetSelector: '[data-tour="gen-generate-button"]',
    placement: "top",
    panel: "generator",
    action: "open-settings-panel",
  },
];

function buildTourSteps(t: TFunction): TourStep[] {
  return TOUR_STEP_TEMPLATES.map(({ key, ...step }) => ({
    ...step,
    title: t(`featureTour.steps.${key}.title`),
    description: t(`featureTour.steps.${key}.description`),
  }));
}

interface FeatureTourProps {
  open: boolean;
  onClose: () => void;
  onPanelChange?: (panel: "gallery" | "generator") => void;
  onAction?: (action: string) => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;
const GAP = 12;
const POPOVER_WIDTH = 320;

function computePopoverPosition(
  spotRect: Rect,
  placement: TourStep["placement"],
  popoverHeight: number,
) {
  let top = 0;
  let left = 0;

  switch (placement) {
    case "bottom":
      top = spotRect.top + spotRect.height + PADDING + GAP;
      left = spotRect.left + spotRect.width / 2 - PADDING - POPOVER_WIDTH / 2;
      break;
    case "top":
      top = spotRect.top - PADDING - GAP - popoverHeight;
      left = spotRect.left + spotRect.width / 2 - PADDING - POPOVER_WIDTH / 2;
      break;
    case "right":
      top = spotRect.top + spotRect.height / 2 - PADDING - popoverHeight / 2;
      left = spotRect.left + spotRect.width + PADDING + GAP;
      break;
    case "left":
      top = spotRect.top + spotRect.height / 2 - PADDING - popoverHeight / 2;
      left = spotRect.left - PADDING - GAP - POPOVER_WIDTH;
      break;
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (left < 8) left = 8;
  if (left + POPOVER_WIDTH > vw - 8) left = vw - 8 - POPOVER_WIDTH;
  if (top < 8) top = 8;
  if (top + popoverHeight > vh - 8) top = vh - 8 - popoverHeight;

  return { top, left };
}

export function FeatureTour({
  open,
  onClose,
  onPanelChange,
  onAction,
}: FeatureTourProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const tourSteps = useMemo(() => buildTourSteps(t), [t]);
  const currentStep = tourSteps[step];

  const updateRect = useCallback(() => {
    if (!currentStep) return;
    const el = document.querySelector(currentStep.targetSelector);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setTargetRect({
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    });
  }, [currentStep]);

  useEffect(() => {
    if (!open || !currentStep) return undefined;
    let cancelled = false;
    if (currentStep.panel || currentStep.action) {
      if (currentStep.panel) onPanelChange?.(currentStep.panel);
      if (currentStep.action) onAction?.(currentStep.action);

      const tryFind = (attempt: number) => {
        if (cancelled) return;
        const el = document.querySelector(currentStep.targetSelector);
        if (el) {
          updateRect();
        } else if (attempt < 10) {
          setTimeout(() => tryFind(attempt + 1), 50);
        }
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(() => tryFind(0));
      });
    } else {
      updateRect();
    }

    return () => {
      cancelled = true;
    };
  }, [open, currentStep, onPanelChange, onAction, updateRect]);

  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener("resize", updateRect);
    return () => window.removeEventListener("resize", updateRect);
  }, [open, updateRect]);

  useEffect(() => {
    if (!targetRect || !currentStep) {
      setPopoverPos(null);
      return;
    }
    const popoverHeight = popoverRef.current?.offsetHeight ?? 160;
    setPopoverPos(
      computePopoverPosition(targetRect, currentStep.placement, popoverHeight),
    );
  }, [targetRect, currentStep]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        setStep((s) => Math.min(s + 1, tourSteps.length - 1));
      } else if (e.key === "ArrowLeft") {
        setStep((s) => Math.max(s - 1, 0));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, tourSteps.length]);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open || !currentStep) return null;

  const isFirst = step === 0;
  const isLast = step === tourSteps.length - 1;

  const overlay = (
    <div className="fixed inset-0 z-9999">
      <div className="absolute inset-0" />

      {targetRect && (
        <div
          className="absolute rounded-lg pointer-events-none"
          style={{
            top: targetRect.top - PADDING,
            left: targetRect.left - PADDING,
            width: targetRect.width + PADDING * 2,
            height: targetRect.height + PADDING * 2,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
            transition: "all 300ms ease",
          }}
        />
      )}

      {popoverPos && (
        <div
          ref={popoverRef}
          className="absolute bg-popover border border-border rounded-xl shadow-lg p-4"
          style={{
            top: popoverPos.top,
            left: popoverPos.left,
            width: POPOVER_WIDTH,
            transition: "all 300ms ease",
          }}
        >
          <div className="mb-2">
            <h3 className="text-sm font-semibold text-foreground">
              {currentStep.title}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            {currentStep.description}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {step + 1} / {tourSteps.length}
            </span>
            <div className="flex items-center gap-1.5">
              {!isFirst && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setStep((s) => s - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t("featureTour.previous")}
                </Button>
              )}
              {isLast ? (
                <Button size="sm" className="h-7 px-3" onClick={onClose}>
                  {t("featureTour.done")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setStep((s) => s + 1)}
                >
                  {t("featureTour.next")}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          {isLast && (
            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
              {t("featureTour.reopenHint")}
            </p>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}
