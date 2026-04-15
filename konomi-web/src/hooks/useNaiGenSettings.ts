import { useCallback, useState } from "react";

const NAI_GEN_KEY = "konomi-nai-gen-settings";

function loadOutputFolder(): string {
  try {
    const stored = localStorage.getItem(NAI_GEN_KEY);
    if (!stored) return "";
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object") return "";
    const outputFolder = (parsed as { outputFolder?: unknown }).outputFolder;
    return typeof outputFolder === "string" ? outputFolder : "";
  } catch {
    return "";
  }
}

function persistOutputFolder(outputFolder: string): void {
  try {
    const stored = localStorage.getItem(NAI_GEN_KEY);
    const parsed = stored ? (JSON.parse(stored) as unknown) : {};
    const base = parsed && typeof parsed === "object" ? parsed : {};
    localStorage.setItem(
      NAI_GEN_KEY,
      JSON.stringify({ ...base, outputFolder }),
    );
  } catch {
    // keep UI state even if persistence fails
  }
}

export function useNaiGenSettings() {
  const [outputFolder, setOutputFolderState] = useState(() =>
    loadOutputFolder(),
  );

  const setOutputFolder = useCallback((nextOutputFolder: string) => {
    setOutputFolderState(nextOutputFolder);
    persistOutputFolder(nextOutputFolder);
  }, []);

  const resetOutputFolder = useCallback(
    () => setOutputFolder(""),
    [setOutputFolder],
  );

  return { outputFolder, setOutputFolder, resetOutputFolder };
}
