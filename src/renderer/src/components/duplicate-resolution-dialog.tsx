import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DuplicateResolutionDialogModel } from "@/hooks/useDuplicateResolutionDialog";
import { toDuplicatePreview } from "@/hooks/useDuplicateResolutionDialog";

type DuplicateResolutionDialogProps = DuplicateResolutionDialogModel;

export function DuplicateResolutionDialog({
  open,
  mode,
  items,
  choices,
  bulkDecision,
  resolving,
  pageIndex,
  preview,
  onOpenChange,
  onApplyAll,
  onSelectBulkDecision,
  onPrevPage,
  onNextPage,
  onSetChoice,
  onResolve,
  onOpenPreview,
  onPreviewOpenChange,
}: DuplicateResolutionDialogProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const currentItem = items[pageIndex] ?? null;
  const showItems = Boolean(
    currentItem && (items.length === 1 || bulkDecision === "manual"),
  );
  const sectionMinHeightClass = "min-h-[30rem]";
  const sectionMessageMinHeightClass = "min-h-[calc(30rem-1.5rem)]";

  const hasDestructiveAction = useMemo(
    () =>
      items.some((item) => {
        const keep = choices[item.id] ?? "existing";
        if (keep === "ignore") return false;
        if (keep === "existing") return item.incomingEntries.length > 0;
        return (
          item.existingEntries.length > 0 || item.incomingEntries.length > 1
        );
      }),
    [choices, items],
  );

  const handleResolveClick = () => {
    if (resolving || items.length === 0) return;
    if (!hasDestructiveAction) {
      void onResolve();
      return;
    }
    setConfirmDeleteOpen(true);
  };

  const handleConfirmResolve = async () => {
    setConfirmDeleteOpen(false);
    await onResolve();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-5xl"
          closeDisabled={resolving || mode === "watch"}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="-mb-6">
              {mode === "watch" ? "중복 이미지 감지" : "중복 이미지 처리"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground select-none">
              {mode === "watch"
                ? "작업이 필요한 파일이 있습니다."
                : `중복 이미지 ${items.length}개를 찾았습니다. 폴더 추가를 완료하려면 어떤 파일을 남길지 선택해 주세요.`}
            </p>
            {items.length > 1 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground/80 select-none">
                  일괄 처리
                </p>
                <div className="flex gap-2">
                  <Button
                    variant={
                      bulkDecision === "existing" ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => onApplyAll("existing")}
                    disabled={resolving}
                  >
                    기존 파일 모두 유지 (새 파일 제거)
                  </Button>
                  <Button
                    variant={
                      bulkDecision === "incoming" ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => onApplyAll("incoming")}
                    disabled={resolving}
                  >
                    새 파일 모두 유지 (기존 파일 제거)
                  </Button>
                  <Button
                    variant={bulkDecision === "ignore" ? "default" : "outline"}
                    size="sm"
                    onClick={() => onApplyAll("ignore")}
                    disabled={resolving}
                  >
                    모두 무시 (파일 유지, DB 미반영)
                  </Button>
                  <Button
                    variant={bulkDecision === "manual" ? "default" : "outline"}
                    size="sm"
                    onClick={() => onSelectBulkDecision("manual")}
                    disabled={resolving}
                  >
                    직접 보고 결정하기
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground/80 select-none">
                중복 파일 리스트
              </p>
              <div
                className={`rounded-lg border border-border/60 bg-card p-3 ${sectionMinHeightClass}`}
              >
                {showItems && currentItem ? (
                  <div className="h-full space-y-3">
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onPrevPage}
                        disabled={resolving || pageIndex === 0}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        이전
                      </Button>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {pageIndex + 1} / {items.length}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onNextPage}
                        disabled={resolving || pageIndex >= items.length - 1}
                      >
                        다음
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {/* <p className="text-xs text-muted-foreground">
                        중복 그룹 {pageIndex + 1}
                      </p> */}
                      <button
                        type="button"
                        className="w-full rounded-md border border-border/50 bg-secondary/20 overflow-hidden"
                        onClick={() =>
                          onOpenPreview(
                            toDuplicatePreview(
                              "중복 샘플",
                              currentItem.previewFileName,
                              currentItem.previewPath,
                            ),
                          )
                        }
                        disabled={resolving}
                      >
                        <img
                          src={
                            toDuplicatePreview(
                              "중복 샘플",
                              currentItem.previewFileName,
                              currentItem.previewPath,
                            ).src
                          }
                          alt={currentItem.previewFileName}
                          className="w-full h-56 object-contain bg-black/10 cursor-zoom-in"
                        />
                      </button>

                      <div className="rounded-md border border-border/60 bg-secondary/10 px-3 py-2 text-xs text-muted-foreground space-y-1">
                        <p>
                          기존 파일 {currentItem.existingEntries.length}개 / 새
                          파일 {currentItem.incomingEntries.length}개
                        </p>
                        <p className="break-all">
                          샘플: {currentItem.previewFileName}
                          <br />
                          {currentItem.previewPath}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant={
                            (choices[currentItem.id] ?? "existing") ===
                            "existing"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() =>
                            onSetChoice(currentItem.id, "existing")
                          }
                          disabled={
                            resolving ||
                            currentItem.existingEntries.length === 0
                          }
                        >
                          기존 유지 (새 파일 제거)
                        </Button>
                        <Button
                          variant={
                            (choices[currentItem.id] ?? "existing") ===
                            "incoming"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() =>
                            onSetChoice(currentItem.id, "incoming")
                          }
                          disabled={
                            resolving ||
                            currentItem.incomingEntries.length === 0
                          }
                        >
                          새 파일 유지 (기존 파일 제거)
                        </Button>
                        <Button
                          variant={
                            (choices[currentItem.id] ?? "existing") === "ignore"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() => onSetChoice(currentItem.id, "ignore")}
                          disabled={resolving}
                        >
                          무시 (파일 유지, DB 미반영)
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`flex items-center justify-center px-4 ${sectionMessageMinHeightClass}`}
                  >
                    <p className="text-center text-xl text-muted-foreground select-none">
                      일괄 작업에서는 개별 파일을 미리 볼 수 없습니다.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            {mode === "folderAdd" && (
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={resolving}
              >
                취소
              </Button>
            )}
            <Button
              onClick={handleResolveClick}
              disabled={resolving || items.length === 0}
            >
              {resolving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : null}
              {mode === "watch" ? "선택 적용" : "중복 처리 후 폴더 추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(nextOpen) => {
          if (!resolving) setConfirmDeleteOpen(nextOpen);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>삭제 포함 작업 확인</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            현재 선택에는 파일 삭제가 포함되어 있습니다. 계속 진행할까요?
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={resolving}>
                취소
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleConfirmResolve}
              disabled={resolving}
            >
              계속 진행
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={preview !== null} onOpenChange={onPreviewOpenChange}>
        <DialogContent
          className="max-w-6xl w-[96vw]"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{preview?.side ?? ""} 이미지 전체보기</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="max-h-[72vh] overflow-auto rounded-md border border-border/60 bg-secondary/20 p-2">
                <img
                  src={preview.src}
                  alt={preview.fileName}
                  className="max-w-full max-h-[68vh] mx-auto object-contain"
                />
              </div>
              <p className="text-xs text-muted-foreground break-all">
                {preview.fileName}
                <br />
                {preview.path}
              </p>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">닫기</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
