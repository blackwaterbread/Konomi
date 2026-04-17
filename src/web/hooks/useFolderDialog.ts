import { useCallback, useRef, useState } from "react";

export function useFolderDialog(
  onSubmit: (name: string, path: string) => Promise<void>,
) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const submittingRef = useRef(false);

  const canSubmit = !!name.trim() && !!path.trim() && !submittingRef.current;

  const handleBrowse = useCallback(async () => {
    if (submittingRef.current) return;
    try {
      const selected = await window.dialog.selectDirectory();
      if (selected) setPath(selected);
    } catch {
      // 다이얼로그 취소 또는 실패는 무시
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (submittingRef.current) return;
    const trimmedName = name.trim();
    const trimmedPath = path.trim();
    if (!trimmedName || !trimmedPath) return;
    // Close the dialog immediately — duplicate check & scan run in the background
    setName("");
    setPath("");
    setOpen(false);
    submittingRef.current = true;
    onSubmit(trimmedName, trimmedPath).finally(() => {
      submittingRef.current = false;
    });
  }, [name, onSubmit, path]);

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next && submittingRef.current) return;
    if (!next) {
      setName("");
      setPath("");
    }
    setOpen(next);
  }, []);

  return {
    open,
    name,
    path,
    canSubmit,
    setName,
    handleBrowse,
    handleSubmit,
    handleOpenChange,
  };
}
