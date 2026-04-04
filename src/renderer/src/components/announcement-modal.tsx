import { type ReactNode, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslation } from "react-i18next";
import {
  type AnnouncementActionHandler,
  getAnnouncementStorageKey,
  getLatestUnacknowledged,
} from "@/lib/announcements";

/** Parses `**bold**` markers into <strong> elements */
function renderBold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/).map((segment, i) => {
    if (segment.startsWith("**") && segment.endsWith("**")) {
      return (
        <strong key={i} className="text-red-500">
          {segment.slice(2, -2)}
        </strong>
      );
    }
    return segment;
  });
}

interface AnnouncementModalProps {
  disabled?: boolean;
  onAction?: AnnouncementActionHandler;
  onDefer?: () => void;
}

export function AnnouncementModal({
  disabled,
  onAction,
  onDefer,
}: AnnouncementModalProps) {
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState(getLatestUnacknowledged);
  const [checkedActions, setCheckedActions] = useState<Set<string>>(
    () => new Set(),
  );

  if (!announcement || disabled) return null;

  const hasActions = announcement.actions && announcement.actions.length > 0;

  const handleDismiss = () => {
    try {
      localStorage.setItem(getAnnouncementStorageKey(announcement.id), "true");
    } catch {
      /* ignore */
    }
    setAnnouncement(null);
  };

  const handleDefer = () => {
    setAnnouncement(null);
    onDefer?.();
  };

  const handleExecute = () => {
    const selected = announcement.actions?.filter((a) =>
      checkedActions.has(a.id),
    );
    if (selected && selected.length > 0 && onAction) {
      for (const action of selected) {
        void onAction(action.id);
      }
    }
    handleDismiss();
  };

  const toggleAction = (id: string) => {
    setCheckedActions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Legacy announcements without actions — simple confirm dialog
  if (!hasActions) {
    return (
      <Dialog open onOpenChange={() => {}}>
        <DialogContent
          hideCloseButton
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t(announcement.titleKey)}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed select-none mb-4">
            {renderBold(t(announcement.bodyKey))}
          </div>
          <DialogFooter>
            <Button onClick={handleDismiss}>{t("announcement.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        hideCloseButton
        className="sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t(announcement.titleKey)}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed select-none mb-6">
          {renderBold(t(announcement.bodyKey))}
        </div>

        <div className="flex flex-col gap-2">
          {announcement.actions!.map((action) => (
            <label
              key={action.id}
              className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer"
            >
              <Checkbox
                checked={checkedActions.has(action.id)}
                onCheckedChange={() => toggleAction(action.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0 select-none">
                <div className="text-sm font-medium">{t(action.labelKey)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t(action.descriptionKey)}
                </div>
              </div>
            </label>
          ))}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
          <div className="flex gap-2 sm:mr-auto">
            <Button variant="ghost" size="sm" onClick={handleDismiss}>
              {t("announcement.dismiss")}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleDefer}>
              {t("announcement.defer")}
            </Button>
            <Button
              onClick={handleExecute}
              disabled={checkedActions.size === 0}
            >
              {t("announcement.execute")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
