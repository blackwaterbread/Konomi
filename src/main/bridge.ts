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
};

class UtilityBridge {
  private child: Electron.UtilityProcess | null = null;
  private webContents: WebContents | null = null;
  private pending = new Map<number, PendingRequest>();
  private seq = 0;
  private log = createLogger("main/bridge");

  start(utilityPath: string): void {
    this.log.info("Starting utility process", { utilityPath });
    this.child = utilityProcess.fork(utilityPath, [], {
      env: {
        ...process.env,
        KONOMI_USER_DATA: app.getPath("userData"),
        KONOMI_MIGRATIONS_PATH: join(app.getAppPath(), "prisma", "migrations"),
      },
    });
    this.child.on("message", (msg: unknown) => {
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
    this.child.on("exit", (code) => {
      this.log.error("Utility process exited", { code });
    });
  }

  setWebContents(wc: WebContents): void {
    this.webContents = wc;
    this.log.info("Bound renderer webContents");
  }

  request<T>(type: string, payload?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.seq++;
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        type,
        startedAt: Date.now(),
      });
      this.log.debug("Sending request to utility", { id, type });
      this.child!.postMessage({ id, type, payload });
    });
  }
}

export const bridge = new UtilityBridge();
