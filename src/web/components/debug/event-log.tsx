import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type LogEntry = {
  id: number;
  event: string;
  payload: string;
  timestamp: number;
};

const MAX_ENTRIES = 500;

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function truncatePayload(data: unknown): string {
  try {
    const str = JSON.stringify(data);
    return str.length > 500 ? str.slice(0, 500) + "…" : str;
  } catch {
    return String(data);
  }
}

export const EventLog = memo(function EventLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const idRef = useRef(0);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const pushEntry = useCallback((event: string, data: unknown) => {
    if (pausedRef.current) return;
    setEntries((prev) => [
      {
        id: ++idRef.current,
        event,
        payload: truncatePayload(data),
        timestamp: Date.now(),
      },
      ...prev.slice(0, MAX_ENTRIES - 1),
    ]);
  }, []);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // image events
    unsubs.push(window.image.onBatch((d) => pushEntry("image:batch", { count: d.length })));
    unsubs.push(window.image.onRemoved((d) => pushEntry("image:removed", d)));
    unsubs.push(window.image.onScanProgress((d) => pushEntry("image:scanProgress", d)));
    unsubs.push(window.image.onScanPhase((d) => pushEntry("image:scanPhase", d)));
    unsubs.push(window.image.onScanFolder((d) => pushEntry("image:scanFolder", d)));
    unsubs.push(window.image.onHashProgress((d) => pushEntry("image:hashProgress", d)));
    unsubs.push(window.image.onSimilarityProgress((d) => pushEntry("image:similarityProgress", d)));
    unsubs.push(window.image.onDupCheckProgress((d) => pushEntry("image:dupCheckProgress", d)));
    unsubs.push(window.image.onSearchStatsProgress((d) => pushEntry("image:searchStatsProgress", d)));
    unsubs.push(window.image.onRescanMetadataProgress((d) => pushEntry("image:rescanMetadataProgress", d)));
    unsubs.push(window.image.onWatchDuplicate((d) => pushEntry("image:watchDuplicate", d)));

    // nai events
    unsubs.push(window.nai.onGeneratePreview(() => pushEntry("nai:generatePreview", "(data url omitted)")));

    // db events
    unsubs.push(window.db.onMigrationProgress((d) => pushEntry("db:migrationProgress", d)));

    // app events
    unsubs.push(window.appInfo.onUpdateAvailable((d) => pushEntry("app:updateAvailable", d)));
    unsubs.push(window.appInfo.onUpdateDownloaded((d) => pushEntry("app:updateDownloaded", d)));
    unsubs.push(window.appInfo.onUpdateProgress((d) => pushEntry("app:updateProgress", d)));

    return () => unsubs.forEach((fn) => fn());
  }, [pushEntry]);

  const handleClear = useCallback(() => {
    setEntries([]);
    setSelectedId(null);
  }, []);

  const selectedEntry = selectedId
    ? entries.find((e) => e.id === selectedId)
    : null;

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? (
            <Play className="h-3.5 w-3.5" />
          ) : (
            <Pause className="h-3.5 w-3.5" />
          )}
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={handleClear}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {entries.length} events
          {paused && " (paused)"}
        </span>
      </div>

      <ScrollArea className="flex-1 rounded-md border border-border bg-secondary">
        <div className="p-1 space-y-px">
          {entries.length === 0 ? (
            <div className="text-xs text-muted-foreground p-3 text-center">
              Waiting for events...
            </div>
          ) : (
            entries.map((e) => (
              <div
                key={e.id}
                className={cn(
                  "flex items-start gap-2 px-2 py-1 text-xs rounded cursor-pointer hover:bg-accent/50",
                  selectedId === e.id && "bg-accent",
                )}
                onClick={() =>
                  setSelectedId((prev) => (prev === e.id ? null : e.id))
                }
              >
                <span className="text-muted-foreground tabular-nums shrink-0 font-mono">
                  {formatTime(e.timestamp)}
                </span>
                <span className="font-mono font-medium text-primary shrink-0">
                  {e.event}
                </span>
                <span className="text-muted-foreground truncate font-mono">
                  {e.payload}
                </span>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {selectedEntry && (
        <div className="flex flex-col gap-1 max-h-48">
          <label className="text-xs text-muted-foreground">
            {selectedEntry.event} — {formatTime(selectedEntry.timestamp)}
          </label>
          <ScrollArea className="flex-1 rounded-md border border-border bg-secondary">
            <pre className="p-2 text-xs font-mono whitespace-pre-wrap break-all">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(selectedEntry.payload), null, 2);
                } catch {
                  return selectedEntry.payload;
                }
              })()}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
});
