import { memo } from "react";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface AvailableFoldersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AvailableFoldersDialog = memo(function AvailableFoldersDialog({
  open,
  onOpenChange,
}: AvailableFoldersDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" mobileSheet>
        <DialogHeader>
          <DialogTitle>{t("availableFolders.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-3 rounded-md border bg-muted/40 p-4">
          <Info className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
          <div className="space-y-2 text-sm">
            <p>{t("availableFolders.description")}</p>
            <p className="text-muted-foreground">
              {t("availableFolders.instruction")}
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("common.close")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
