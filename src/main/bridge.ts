import { utilityProcess, app } from "electron";
import { join } from "path";
import type { WebContents } from "electron";
import { createLogger } from "./lib/logger";

const NOISY_EVENTS = new Set([
  "image:batch",
  "image:scanProgress",
  "image:hashProgress",
  "image:similarityProgress",
  "image:scanFolder",
  "image:searchStatsProgress",
]);

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  type: string;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout>;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const RESTART_DELAY_MS = 1000;

function resolveRequestTimeoutMs(): number {
  const raw = Number(process.env.KONOMI_BRIDGE_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.max(5000, Math.floor(raw));
}

class UtilityBridge {
  private child: Electron.UtilityProcess | null = null;
  private webContents: WebContents | null = null;
  private pending = new Map<number, PendingRequest>();
  private seq = 0;
  private utilityPath: string | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly requestTimeoutMs = resolveRequestTimeoutMs();
  private log = createLogger("main/bridge");

  start(utilityPath: string): void {
    this.utilityPath = utilityPath;
    this.spawnUtilityProcess();
  }

  stop(): void {
    this.log.info("Stopping utility bridge");
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.utilityPath = null;
    this.rejectAllPending(new Error("Utility bridge stopped"));
    const child = this.child;
    this.child = null;
    if (child) {
      child.kill();
    }
  }

  private spawnUtilityProcess(): void {
    if (!this.utilityPath) return;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.log.info("Starting utility process", {
      utilityPath: this.utilityPath,
    });
    const child = utilityProcess.fork(this.utilityPath, [], {
      env: {
        ...process.env,
        KONOMI_USER_DATA: app.getPath("userData"),
        KONOMI_MIGRATIONS_PATH: join(app.getAppPath(), "prisma", "migrations"),
      },
    });
    this.child = child;
    child.on("message", (msg: unknown) => {
      const m = msg as Record<string, unknown>;
      if (m.event !== undefined) {
        const eventName = String(m.event);
        if (!NOISY_EVENTS.has(eventName)) {
          this.log.debug("Forwarding utility event", { event: eventName });
        }
        if (this.webContents && !this.webContents.isDestroyed()) {
          this.webContents.send(m.event as string, m.payload);
        }
      } else {
        const id = m.id as number;
        const pending = this.pending.get(id);
        if (!pending) {
          this.log.warn("Received response for unknown request id", { id });
          return;
        }
        this.pending.delete(id);
        clearTimeout(pending.timeout);
        const elapsedMs = Date.now() - pending.startedAt;
        if (m.error !== undefined) {
          this.log.error("Utility request failed", {
            id,
            type: pending.type,
            elapsedMs,
            error: m.error,
          });
          pending.reject(new Error(m.error as string));
        } else {
          this.log.debug("Utility request succeeded", {
            id,
            type: pending.type,
            elapsedMs,
          });
          pending.resolve(m.result);
        }
      }
    });
    child.on("exit", (code) => {
      this.log.error("Utility process exited", { code });
      if (this.child === child) {
        this.child = null;
      }
      this.rejectAllPending(
        new Error(
          `Utility process exited unexpectedly (code: ${String(code)})`,
        ),
      );
      this.scheduleRestart();
    });
    child.on("error", (error) => {
      this.log.errorWithStack("Utility process error", error);
    });
  }

  private rejectAllPending(error: Error): void {
    const pendingEntries = Array.from(this.pending.values());
    this.pending.clear();
    for (const pending of pendingEntries) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  private scheduleRestart(): void {
    if (!this.utilityPath || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.utilityPath) return;
      this.log.warn("Restarting utility process");
      this.spawnUtilityProcess();
    }, RESTART_DELAY_MS);
  }

  setWebContents(wc: WebContents): void {
    this.webContents = wc;
    this.log.info("Bound renderer webContents");
  }

  request<T>(type: string, payload?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const child = this.child;
      if (!child) {
        this.log.error("Utility request failed: child process unavailable", {
          type,
        });
        this.scheduleRestart();
        reject(new Error("Utility process is unavailable"));
        return;
      }
      const id = this.seq++;
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.log.error("Utility request timed out", {
          id,
          type: pending.type,
          timeoutMs: this.requestTimeoutMs,
        });
        pending.reject(
          new Error(
            `Utility request timed out after ${this.requestTimeoutMs}ms: ${pending.type}`,
          ),
        );
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        type,
        startedAt: Date.now(),
        timeout,
      });
      this.log.debug("Sending request to utility", { id, type });
      try {
        child.postMessage({ id, type, payload });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        this.log.errorWithStack("Failed to post utility request", error, {
          id,
          type,
        });
        reject(error);
      }
    });
  }
}

export const bridge = new UtilityBridge();
