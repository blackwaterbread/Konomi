import { memo, useCallback, useRef, useState } from "react";
import { Loader2, Play, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ANNOUNCEMENTS, resetAnnouncement } from "@/lib/announcements";

type LogLine = {
  id: number;
  text: string;
  type: "info" | "success" | "error";
  timestamp: number;
};

interface ActionsPanelProps {
  onRunAnalysis: () => Promise<boolean>;
  scanning: boolean;
  isAnalyzing: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export const ActionsPanel = memo(function ActionsPanel({
  onRunAnalysis,
  scanning,
  isAnalyzing,
}: ActionsPanelProps) {
  const [log, setLog] = useState<LogLine[]>([]);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const idRef = useRef(0);

  const pushLog = useCallback(
    (text: string, type: LogLine["type"] = "info") => {
      setLog((prev) => [
        ...prev,
        { id: ++idRef.current, text, type, timestamp: Date.now() },
      ]);
    },
    [],
  );

  const handleComputeHashes = useCallback(async () => {
    setRunningAction("hashes");
    pushLog("Computing pHash...");
    const start = performance.now();
    try {
      const count = await window.image.computeHashes();
      const elapsed = Math.round(performance.now() - start);
      pushLog(`pHash complete — ${count} processed (${elapsed}ms)`, "success");
    } catch (e) {
      pushLog(
        `pHash failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    } finally {
      setRunningAction(null);
    }
  }, [pushLog]);

  const handleSimilarGroups = useCallback(async () => {
    setRunningAction("similarity");
    pushLog("Computing similarity groups...");
    const start = performance.now();
    try {
      const groups = await window.image.similarGroups(12);
      const elapsed = Math.round(performance.now() - start);
      pushLog(
        `Similarity complete — ${groups.length} groups (${elapsed}ms)`,
        "success",
      );
    } catch (e) {
      pushLog(
        `Similarity failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    } finally {
      setRunningAction(null);
    }
  }, [pushLog]);

  const handleFullAnalysis = useCallback(async () => {
    setRunningAction("analysis");
    pushLog("Starting full analysis pipeline (pHash → similarity)...");
    const start = performance.now();
    try {
      const success = await onRunAnalysis();
      const elapsed = Math.round(performance.now() - start);
      if (success) {
        pushLog(`Full analysis complete (${elapsed}ms)`, "success");
      } else {
        pushLog(`Full analysis aborted (scan active or failed) (${elapsed}ms)`, "error");
      }
    } catch (e) {
      pushLog(
        `Full analysis failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    } finally {
      setRunningAction(null);
    }
  }, [onRunAnalysis, pushLog]);

  const handleForceFullAnalysis = useCallback(async () => {
    setRunningAction("forceAnalysis");
    pushLog("Resetting all hashes...");
    const start = performance.now();
    try {
      await window.image.resetHashes();
      pushLog("Hashes reset. Starting full analysis pipeline...");
      const success = await onRunAnalysis();
      const elapsed = Math.round(performance.now() - start);
      if (success) {
        pushLog(`Force analysis complete (${elapsed}ms)`, "success");
      } else {
        pushLog(`Force analysis aborted (scan active or failed) (${elapsed}ms)`, "error");
      }
    } catch (e) {
      pushLog(
        `Force analysis failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    } finally {
      setRunningAction(null);
    }
  }, [onRunAnalysis, pushLog]);

  const handleRescanMetadata = useCallback(async () => {
    setRunningAction("rescan");
    pushLog("Rescanning metadata...");
    const start = performance.now();
    try {
      const count = await window.image.rescanMetadata();
      const elapsed = Math.round(performance.now() - start);
      pushLog(`Metadata rescan complete — ${count} updated (${elapsed}ms)`, "success");
    } catch (e) {
      pushLog(
        `Metadata rescan failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    } finally {
      setRunningAction(null);
    }
  }, [pushLog]);

  const busy = !!runningAction || scanning || isAnalyzing;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Status */}
      {(scanning || isAnalyzing) && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 text-xs text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {scanning && "Scan in progress"}
          {scanning && isAnalyzing && " / "}
          {isAnalyzing && "Analysis in progress"}
        </div>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <ActionButton
          label="Full Analysis (pHash + Similarity)"
          description="Runs computeHashes → similarGroups sequentially"
          running={runningAction === "analysis"}
          disabled={busy}
          onClick={() => void handleFullAnalysis()}
        />
        <ActionButton
          label="Compute pHash Only"
          description="Compute image hashes without similarity calculation"
          running={runningAction === "hashes"}
          disabled={busy}
          onClick={() => void handleComputeHashes()}
        />
        <ActionButton
          label="Similarity Groups Only"
          description="Recalculate similarity groups from existing hashes"
          running={runningAction === "similarity"}
          disabled={busy}
          onClick={() => void handleSimilarGroups()}
        />
        <ActionButton
          label="Force Full Analysis"
          description="Reset all hashes, then recompute pHash + similarity from scratch"
          running={runningAction === "forceAnalysis"}
          disabled={busy}
          destructive
          onClick={() => void handleForceFullAnalysis()}
        />
        <ActionButton
          label="Rescan Metadata"
          description="Re-parse metadata for all images"
          running={runningAction === "rescan"}
          disabled={busy}
          onClick={() => void handleRescanMetadata()}
        />
      </div>

      {/* Announcement triggers */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Announcements</label>
        <div className="flex flex-wrap gap-1.5">
          {ANNOUNCEMENTS.map((a) => (
            <Button
              key={a.id}
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => {
                resetAnnouncement(a.id);
                pushLog(`Reset announcement "${a.id}" — reload to trigger`, "info");
              }}
            >
              <Megaphone className="h-3 w-3" />
              {a.id}
            </Button>
          ))}
        </div>
      </div>

      {/* Log */}
      <div className="flex flex-col gap-1 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Log</label>
          {log.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setLog([])}
            >
              Clear
            </Button>
          )}
        </div>
        <ScrollArea className="flex-1 min-h-0 rounded-md border border-border bg-secondary">
          <div className="p-2 space-y-0.5">
            {log.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No actions executed yet.
              </span>
            ) : (
              log.map((l) => (
                <div key={l.id} className="flex gap-2 text-xs">
                  <span className="text-muted-foreground tabular-nums shrink-0 font-mono">
                    {formatTime(l.timestamp)}
                  </span>
                  <span
                    className={cn(
                      "font-mono",
                      l.type === "success" && "text-green-500",
                      l.type === "error" && "text-destructive",
                    )}
                  >
                    {l.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
});

function ActionButton({
  label,
  description,
  running,
  disabled,
  destructive,
  onClick,
}: {
  label: string;
  description: string;
  running: boolean;
  disabled: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
        destructive ? "border-destructive/40" : "border-border",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-accent/50 cursor-pointer",
      )}
      disabled={disabled}
      onClick={onClick}
    >
      <div className={cn(
        "flex items-center gap-1.5 text-xs font-medium",
        destructive && "text-destructive",
      )}>
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {label}
      </div>
      <span className="text-[11px] text-muted-foreground">{description}</span>
    </button>
  );
}
