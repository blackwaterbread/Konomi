import { type ReactNode, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface Announcement {
  id: string;
  titleKey: string;
  bodyKey: string;
}

const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "v0.6.0-similarity-fix",
    titleKey: "announcement.v060SimilarityFix.title",
    bodyKey: "announcement.v060SimilarityFix.body",
  },
];

function getStorageKey(id: string) {
  return `konomi-announcement-${id}`;
}

function getLatestUnacknowledged(): Announcement | null {
  for (let i = ANNOUNCEMENTS.length - 1; i >= 0; i--) {
    const a = ANNOUNCEMENTS[i];
    if (localStorage.getItem(getStorageKey(a.id)) !== "true") {
      return a;
    }
  }
  return null;
}

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
}

export function AnnouncementModal({ disabled }: AnnouncementModalProps) {
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState(getLatestUnacknowledged);

  if (!announcement || disabled) return null;

  const handleConfirm = () => {
    try {
      localStorage.setItem(getStorageKey(announcement.id), "true");
    } catch {
      /* ignore */
    }
    setAnnouncement(null);
  };

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
        <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed select-none">
          {renderBold(t(announcement.bodyKey))}
        </div>
        <DialogFooter>
          <Button onClick={handleConfirm}>{t("announcement.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
