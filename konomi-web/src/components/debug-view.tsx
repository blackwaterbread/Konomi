import { memo, useState } from "react";
import { Bug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApiExecutor } from "@/components/debug/api-executor";
import { EventLog } from "@/components/debug/event-log";
import { LocalStorageInspector } from "@/components/debug/local-storage-inspector";
import { AppStateInspector } from "@/components/debug/app-state-inspector";
import { ActionsPanel } from "@/components/debug/actions-panel";

type DebugTab = "actions" | "api" | "events" | "storage" | "state";

const TABS: { id: DebugTab; label: string }[] = [
  { id: "actions", label: "Actions" },
  { id: "api", label: "API Executor" },
  { id: "events", label: "Event Log" },
  { id: "storage", label: "localStorage" },
  { id: "state", label: "App State" },
];

interface DebugViewProps {
  onClose: () => void;
  onRunAnalysis: () => Promise<boolean>;
  scanning: boolean;
  isAnalyzing: boolean;
  settings: import("@/hooks/useSettings").Settings;
  onUpdateSettings: (patch: Partial<import("@/hooks/useSettings").Settings>) => void;
}

export const DebugView = memo(function DebugView({
  onClose,
  onRunAnalysis,
  scanning,
  isAnalyzing,
  settings,
  onUpdateSettings,
}: DebugViewProps) {
  const [activeTab, setActiveTab] = useState<DebugTab>("actions");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Debug Panel</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border px-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden p-4">
        {activeTab === "actions" && (
          <ActionsPanel
            onRunAnalysis={onRunAnalysis}
            scanning={scanning}
            isAnalyzing={isAnalyzing}
            settings={settings}
            onUpdateSettings={onUpdateSettings}
          />
        )}
        {activeTab === "api" && <ApiExecutor />}
        {activeTab === "events" && <EventLog />}
        {activeTab === "storage" && <LocalStorageInspector />}
        {activeTab === "state" && <AppStateInspector />}
      </div>
    </div>
  );
});
