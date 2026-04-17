import { memo, useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AppInfo, Folder, Category, ImageSearchPresetStats } from "@preload/index.d";

type AppState = {
  appInfo: AppInfo | null;
  dbFileSize: number | null;
  promptsDbVersion: number | null;
  folders: Folder[];
  categories: Category[];
  searchStats: ImageSearchPresetStats | null;
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AppStateInspector = memo(function AppStateInspector() {
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(false);

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const [appInfo, dbFileSize, promptsDbVersion, folders, categories, searchStats] =
        await Promise.all([
          window.appInfo.get(),
          window.appInfo.getDbFileSize(),
          window.appInfo.getPromptsDbSchemaVersion(),
          window.folder.list(),
          window.category.list(),
          window.image.getSearchPresetStats(),
        ]);
      setState({ appInfo, dbFileSize, promptsDbVersion, folders, categories, searchStats });
    } catch (e) {
      console.error("Failed to load app state", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={loading}
          onClick={() => void loadState()}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <ScrollArea className="flex-1 rounded-md border border-border bg-secondary min-h-0">
        {state ? (
          <div className="p-3 space-y-4 text-xs">
            {/* App Info */}
            <Section title="App Info">
              <Row label="Version" value={`${state.appInfo?.appName} v${state.appInfo?.appVersion}`} />
              <Row label="Electron" value={state.appInfo?.electronVersion ?? "?"} />
              <Row label="Chrome" value={state.appInfo?.chromeVersion ?? "?"} />
              <Row label="Node" value={state.appInfo?.nodeVersion ?? "?"} />
              <Row label="Platform" value={`${state.appInfo?.platform} / ${state.appInfo?.arch}`} />
            </Section>

            {/* Database */}
            <Section title="Database">
              <Row label="DB Size" value={formatBytes(state.dbFileSize)} />
              <Row label="Prompts DB Schema" value={state.promptsDbVersion !== null ? `v${state.promptsDbVersion}` : "N/A"} />
            </Section>

            {/* Folders */}
            <Section title={`Folders (${state.folders.length})`}>
              {state.folders.length === 0 ? (
                <span className="text-muted-foreground">No folders</span>
              ) : (
                state.folders.map((f) => (
                  <Row key={f.id} label={`#${f.id} ${f.name}`} value={f.path} />
                ))
              )}
            </Section>

            {/* Categories */}
            <Section title={`Categories (${state.categories.length})`}>
              {state.categories.map((c) => (
                <Row
                  key={c.id}
                  label={`#${c.id} ${c.name}`}
                  value={c.isBuiltin ? "builtin" : `order: ${c.order}`}
                />
              ))}
            </Section>

            {/* Search Stats */}
            <Section title="Search Stats">
              <Row
                label="Resolutions"
                value={
                  state.searchStats?.availableResolutions
                    .map((r) => `${r.width}x${r.height}`)
                    .join(", ") || "None"
                }
              />
              <Row
                label="Models"
                value={state.searchStats?.availableModels.join(", ") || "None"}
              />
            </Section>
          </div>
        ) : (
          <div className="p-3 text-xs text-muted-foreground">Loading...</div>
        )}
      </ScrollArea>
    </div>
  );
});

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="font-medium text-foreground mb-1.5">{title}</h3>
      <div className="space-y-1 pl-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="font-mono break-all">{value}</span>
    </div>
  );
}
