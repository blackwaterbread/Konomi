import { useEffect, useState } from "react";
import { FolderGit2, Github, Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { AppInfo } from "@preload/index.d";

interface AppInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PROJECT_REPO_URL = "https://github.com/blackwaterbread/Konomi";
const CREATOR_GITHUB_URL = "https://github.com/blackwaterbread";

export function AppInfoDialog({ open, onOpenChange }: AppInfoDialogProps) {
  const [loading, setLoading] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    window.appInfo
      .get()
      .then((info) => setAppInfo(info))
      .catch(() => setAppInfo(null))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,72rem)] max-w-4xl overflow-hidden p-0">
        <div className="flex flex-col">
          <section className="relative bg-gradient-to-br from-primary/15 via-background to-secondary/40 p-8 sm:p-10">
            <DialogHeader className="mb-8">
              <div className="flex items-center gap-4">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/20">
                  <Sparkles className="h-7 w-7 text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-2xl tracking-tight">
                    Konomi
                  </DialogTitle>
                  <DialogDescription className="text-sm leading-relaxed">
                    AI 생성 이미지 통합관리
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-6 border-t border-border/60 pt-5">
              <div className="flex flex-col items-start gap-2">
                <a
                  href={PROJECT_REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open project GitHub repository"
                  title="Repository GitHub"
                  className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <FolderGit2 className="h-5 w-5" />
                  <span className="text-sm font-medium">Repository</span>
                </a>
                <a
                  href={CREATOR_GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open creator GitHub profile"
                  title="Creator GitHub"
                  className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <Github className="h-5 w-5" />
                  <span className="text-sm font-medium">Author</span>
                </a>
              </div>
              {loading && (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading information...</span>
                </div>
              )}
            </div>
          </section>

          <section className="border-t border-border/60 bg-background/95 px-8 py-5 sm:px-10">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground select-none">
              Environment
            </p>
            {loading ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Loading environment...</span>
              </div>
            ) : (
              <p className="mt-2 overflow-x-auto whitespace-nowrap font-mono text-sm text-foreground">
                {`${appInfo?.appName ?? "Konomi"} v${appInfo?.appVersion ?? "-"} · Electron ${appInfo?.electronVersion ?? "-"} · Node ${appInfo?.nodeVersion ?? "-"} · Chrome ${appInfo?.chromeVersion ?? "-"} · Platform ${appInfo ? `${appInfo.platform} (${appInfo.arch})` : "-"}`}
              </p>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
