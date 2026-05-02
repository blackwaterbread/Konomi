import { memo, useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useTextFieldContextMenu } from "@/hooks/useTextFieldContextMenu";

type StorageEntry = {
  key: string;
  value: string;
  size: number;
};

function readAllStorage(): StorageEntry[] {
  const entries: StorageEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const value = localStorage.getItem(key) ?? "";
    entries.push({ key, value, size: new Blob([value]).size });
  }
  entries.sort((a, b) => {
    const aKonomi = a.key.startsWith("konomi") ? 0 : 1;
    const bKonomi = b.key.startsWith("konomi") ? 0 : 1;
    if (aKonomi !== bKonomi) return aKonomi - bKonomi;
    return a.key.localeCompare(b.key);
  });
  return entries;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function tryFormat(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export const LocalStorageInspector = memo(function LocalStorageInspector() {
  const [entries, setEntries] = useState<StorageEntry[]>(() => readAllStorage());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editing, setEditing] = useState(false);
  const editContextMenu = useTextFieldContextMenu<HTMLTextAreaElement>();

  const refresh = useCallback(() => {
    setEntries(readAllStorage());
  }, []);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.storageArea === localStorage) refresh();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [refresh]);

  const handleSelect = useCallback(
    (key: string) => {
      if (selectedKey === key) {
        setSelectedKey(null);
        setEditing(false);
        return;
      }
      setSelectedKey(key);
      setEditValue(localStorage.getItem(key) ?? "");
      setEditing(false);
    },
    [selectedKey],
  );

  const handleDelete = useCallback(
    (key: string) => {
      localStorage.removeItem(key);
      if (selectedKey === key) {
        setSelectedKey(null);
        setEditing(false);
      }
      refresh();
    },
    [selectedKey, refresh],
  );

  const handleSave = useCallback(() => {
    if (!selectedKey) return;
    localStorage.setItem(selectedKey, editValue);
    setEditing(false);
    refresh();
  }, [selectedKey, editValue, refresh]);

  const handleCopyValue = useCallback(() => {
    const value = selectedKey ? localStorage.getItem(selectedKey) ?? "" : "";
    void navigator.clipboard.writeText(value);
  }, [selectedKey]);

  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={refresh}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {entries.length} keys — {formatSize(totalSize)}
        </span>
      </div>

      <ScrollArea className="flex-1 rounded-md border border-border bg-secondary min-h-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Key</th>
              <th className="px-2 py-1.5 font-medium w-20 text-right">Size</th>
              <th className="px-2 py-1.5 font-medium w-10" />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.key}
                className={cn(
                  "border-b border-border/50 cursor-pointer hover:bg-accent/50",
                  selectedKey === e.key && "bg-accent",
                )}
                onClick={() => handleSelect(e.key)}
              >
                <td className="px-2 py-1.5 font-mono truncate max-w-0">
                  <span
                    className={cn(
                      e.key.startsWith("konomi") && "text-primary font-medium",
                    )}
                  >
                    {e.key}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">
                  {formatSize(e.size)}
                </td>
                <td className="px-2 py-1.5">
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      handleDelete(e.key);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>

      {selectedKey && (
        <div className="flex flex-col gap-1 max-h-64">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground font-mono">
              {selectedKey}
            </label>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-xs"
                onClick={handleCopyValue}
              >
                <Copy className="h-3 w-3" />
                Copy
              </Button>
              {!editing ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={handleSave}
                >
                  Save
                </Button>
              )}
            </div>
          </div>
          {editing ? (
            <>
              <textarea
                className="h-40 rounded-md border border-border bg-secondary p-2 text-xs font-mono resize-y"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                spellCheck={false}
                onContextMenu={editContextMenu.onContextMenu}
              />
              {editContextMenu.contextMenu}
            </>
          ) : (
            <ScrollArea className="flex-1 rounded-md border border-border bg-secondary">
              <pre className="p-2 text-xs font-mono whitespace-pre-wrap break-all">
                {tryFormat(
                  entries.find((e) => e.key === selectedKey)?.value ?? "",
                )}
              </pre>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
});
