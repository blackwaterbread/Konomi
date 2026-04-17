import { memo, useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  API_REGISTRY,
  API_NAMESPACES,
  resolveApiCall,
  type ApiMethod,
} from "./api-registry";

type HistoryEntry = {
  id: number;
  label: string;
  params: string;
  result: string;
  error: boolean;
  elapsedMs: number;
  timestamp: number;
};

const MAX_HISTORY = 30;

export const ApiExecutor = memo(function ApiExecutor() {
  const [selectedNamespace, setSelectedNamespace] = useState(API_NAMESPACES[0]);
  const [selectedMethod, setSelectedMethod] = useState<ApiMethod | null>(null);
  const [paramsText, setParamsText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [resultError, setResultError] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyIdRef = useRef(0);

  const filteredMethods = useMemo(
    () => API_REGISTRY.filter((m) => m.namespace === selectedNamespace),
    [selectedNamespace],
  );

  const handleNamespaceChange = useCallback(
    (ns: string) => {
      setSelectedNamespace(ns);
      setSelectedMethod(null);
      setParamsText("");
    },
    [],
  );

  const handleMethodChange = useCallback(
    (label: string) => {
      const method = API_REGISTRY.find((m) => m.label === label) ?? null;
      setSelectedMethod(method);
      setParamsText(method?.params ?? "");
    },
    [],
  );

  const handleExecute = useCallback(async () => {
    if (!selectedMethod || running) return;

    const entry = selectedMethod;
    const ns = entry.namespace as keyof typeof window;
    const api = window[ns] as Record<string, (...args: unknown[]) => Promise<unknown>>;
    if (!api || typeof api[entry.method] !== "function") {
      setResult(`Error: window.${entry.label} is not a function`);
      setResultError(true);
      return;
    }

    let parsedParams: Record<string, unknown> = {};
    if (entry.params && paramsText.trim()) {
      try {
        parsedParams = JSON.parse(paramsText);
      } catch (e) {
        setResult(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
        setResultError(true);
        return;
      }
    }

    setRunning(true);
    const start = performance.now();
    try {
      const args = resolveApiCall(entry, parsedParams);
      const res = await api[entry.method](...args);
      const elapsed = Math.round(performance.now() - start);
      const resultStr = JSON.stringify(res, null, 2) ?? "undefined";
      setResult(resultStr);
      setResultError(false);
      setElapsedMs(elapsed);
      setHistory((prev) => [
        {
          id: ++historyIdRef.current,
          label: entry.label,
          params: paramsText,
          result: resultStr,
          error: false,
          elapsedMs: elapsed,
          timestamp: Date.now(),
        },
        ...prev.slice(0, MAX_HISTORY - 1),
      ]);
    } catch (e) {
      const elapsed = Math.round(performance.now() - start);
      const errStr = e instanceof Error ? e.message : String(e);
      setResult(`Error: ${errStr}`);
      setResultError(true);
      setElapsedMs(elapsed);
      setHistory((prev) => [
        {
          id: ++historyIdRef.current,
          label: entry.label,
          params: paramsText,
          result: errStr,
          error: true,
          elapsedMs: elapsed,
          timestamp: Date.now(),
        },
        ...prev.slice(0, MAX_HISTORY - 1),
      ]);
    } finally {
      setRunning(false);
    }
  }, [selectedMethod, paramsText, running]);

  const handleCopyResult = useCallback(() => {
    if (result) void navigator.clipboard.writeText(result);
  }, [result]);

  const handleReplay = useCallback(
    (entry: HistoryEntry) => {
      const method = API_REGISTRY.find((m) => m.label === entry.label);
      if (method) {
        setSelectedNamespace(method.namespace);
        setSelectedMethod(method);
        setParamsText(entry.params);
      }
    },
    [],
  );

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Controls */}
      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Namespace</label>
          <select
            className="h-8 rounded-md border border-border bg-secondary px-2 text-xs"
            value={selectedNamespace}
            onChange={(e) => handleNamespaceChange(e.target.value)}
          >
            {API_NAMESPACES.map((ns) => (
              <option key={ns} value={ns}>
                {ns}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Method</label>
          <select
            className="h-8 rounded-md border border-border bg-secondary px-2 text-xs min-w-[200px]"
            value={selectedMethod?.label ?? ""}
            onChange={(e) => handleMethodChange(e.target.value)}
          >
            <option value="" disabled>
              Select method...
            </option>
            {filteredMethods.map((m) => (
              <option key={m.label} value={m.label}>
                {m.destructive ? "⚠ " : ""}
                {m.method}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          variant={selectedMethod?.destructive ? "destructive" : "default"}
          className="h-8 gap-1.5"
          disabled={!selectedMethod || running}
          onClick={() => void handleExecute()}
        >
          {selectedMethod?.destructive && (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          <Play className="h-3.5 w-3.5" />
          {running ? "Running..." : "Execute"}
        </Button>
      </div>

      {/* Params */}
      {selectedMethod?.params && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">
            Parameters (JSON)
          </label>
          <textarea
            className="h-24 rounded-md border border-border bg-secondary p-2 text-xs font-mono resize-y"
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            spellCheck={false}
          />
        </div>
      )}

      {/* Result */}
      <div className="flex flex-col gap-1 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">
            Result
            {elapsedMs !== null && (
              <span className="ml-2 tabular-nums">{elapsedMs}ms</span>
            )}
          </label>
          {result && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs"
              onClick={handleCopyResult}
            >
              <Copy className="h-3 w-3" />
              Copy
            </Button>
          )}
        </div>
        <ScrollArea className="flex-1 rounded-md border border-border bg-secondary">
          <pre
            className={cn(
              "p-2 text-xs font-mono whitespace-pre-wrap break-all",
              resultError && "text-destructive",
            )}
          >
            {result ?? "No result yet"}
          </pre>
        </ScrollArea>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="flex flex-col gap-1 h-40 shrink-0">
          <label className="text-xs text-muted-foreground shrink-0">
            History ({history.length})
          </label>
          <ScrollArea className="flex-1 min-h-0 rounded-md border border-border bg-secondary">
            <div className="p-1 space-y-0.5">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-accent/50 cursor-pointer"
                  onClick={() => handleReplay(h)}
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      h.error ? "bg-destructive" : "bg-green-500",
                    )}
                  />
                  <span className="font-mono truncate flex-1">{h.label}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {h.elapsedMs}ms
                  </span>
                  <RotateCcw className="h-3 w-3 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
});
