import { useCallback, useRef, useState } from "react";

const shouldSuppressSubmitError = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  "suppressDialogError" in e &&
  (e as { suppressDialogError?: unknown }).suppressDialogError === true;

export function useFolderDialog(
  onSubmit: (name: string, path: string) => Promise<void>,
) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const canSubmit = !!name.trim() && !!path.trim() && !isSubmitting;

  const handleBrowse = useCallback(async () => {
    if (submittingRef.current) return;
    try {
      const selected = await window.dialog.selectDirectory();
      if (selected) setPath(selected);
    } catch {
      // 다이얼로그 취소 또는 실패는 무시
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(name.trim(), path.trim());
      setName("");
      setPath("");
      setOpen(false);
    } catch (e: unknown) {
      if (shouldSuppressSubmitError(e)) return;
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [name, onSubmit, path]);

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next && submittingRef.current) return;
    if (!next) {
      setName("");
      setPath("");
      setSubmitError(null);
    }
    setOpen(next);
  }, []);

  return {
    open,
    name,
    path,
    canSubmit,
    isSubmitting,
    submitError,
    setName,
    handleBrowse,
    handleSubmit,
    handleOpenChange,
  };
}
