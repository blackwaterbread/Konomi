import { utilityProcess, app } from "electron";
import { join } from "path";
import type { WebContents } from "electron";
import { createLogger } from "@core/lib/logger";

const NOISY_EVENTS = new Set([
  "image:batch",
  "image:scanProgress",
  "image:scanPhase",
  "image:dupCheckProgress",
  "image:hashProgress",
  "image:similarityProgress",
  "image:scanFolder",
  "image:searchStatsProgress",
  "image:rescanMetadataProgress",
  "image:quickVerifyProgress",
]);

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  type: string;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout> | null;
};

// 0 = 무한 대기. 무거운 작업은 모두 CancelToken/signal 기반으로 취소되도록
// 재설계되었기 때문에 timeout 강제 종료가 불필요. KONOMI_BRIDGE_TIMEOUT_MS
// 환경 변수로 디버깅 시 유한 timeout을 강제할 수 있음.
const DEFAULT_REQUEST_TIMEOUT_MS = 0;
const RESTART_DELAY_MS = 1000;
const DEFAULT_SHUTDOWN_GRACE_MS = 5000;

function resolveRequestTimeoutMs(): number {
  const raw = Number(process.env.KONOMI_BRIDGE_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_REQUEST_TIMEOUT_MS;
  if (raw <= 0) return 0;
  return Math.max(5000, Math.floor(raw));
}

function resolveShutdownGraceMs(): number {
  const raw = Number(process.env.KONOMI_SHUTDOWN_GRACE_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SHUTDOWN_GRACE_MS;
  return Math.max(1000, Math.floor(raw));
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

  /**
   * Graceful shutdown: gives the utility process a chance to drain in-flight
   * maintenance work, terminate worker threads, and disconnect from the DB
   * before being killed. Falls back to a forced kill after `gracePeriodMs`.
   * Default grace period (5s) is overridable via `KONOMI_SHUTDOWN_GRACE_MS`
   * for users with large libraries whose hashing can't drain in 5s.
   */
  async stopGracefully(gracePeriodMs = resolveShutdownGraceMs()): Promise<void> {
    const child = this.child;
    if (!this.utilityPath || !child) {
      this.stop();
      return;
    }
    this.log.info("Stopping utility bridge (graceful)", { gracePeriodMs });
    // Prevent auto-restart while we wait for the utility to wind down.
    this.utilityPath = null;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    let timedOut = true;
    try {
      await Promise.race([
        this.request("system:shutdown").then(() => {
          timedOut = false;
        }),
        new Promise<void>((resolve) => setTimeout(resolve, gracePeriodMs)),
      ]);
    } catch (err) {
      timedOut = false;
      this.log.errorWithStack(
        "Graceful shutdown request failed",
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    if (timedOut) {
      this.log.warn(
        "Utility process did not acknowledge shutdown in time; force-killing",
        { gracePeriodMs },
      );
    }
    this.rejectAllPending(new Error("Utility bridge stopped"));
    this.child = null;
    try {
      child.kill();
    } catch (err) {
      this.log.errorWithStack(
        "Failed to kill utility process after graceful shutdown",
        err instanceof Error ? err : new Error(String(err)),
      );
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
        KONOMI_MIGRATIONS_PATH: join(app.getAppPath(), "prisma", "migrations", "sqlite"),
        KONOMI_PREBUILDS_PATH: app.isPackaged
          ? join(process.resourcesPath, "app.asar.unpacked", "prebuilds")
          : join(app.getAppPath(), "prebuilds"),
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
      } else if (m.ack === true) {
        // Utility process acknowledged the request — reset the timeout so
        // queue-wait time doesn't count against it.
        const id = m.id as number;
        const pending = this.pending.get(id);
        if (pending) {
          this.resetTimeout(pending, id);
        }
      } else {
        const id = m.id as number;
        const pending = this.pending.get(id);
        if (!pending) {
          this.log.warn("Received response for unknown request id", { id });
          return;
        }
        this.pending.delete(id);
        if (pending.timeout) clearTimeout(pending.timeout);
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
      if (this.webContents && !this.webContents.isDestroyed()) {
        this.webContents.send("utility:reset");
      }
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
      if (pending.timeout) clearTimeout(pending.timeout);
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

  private resetTimeout(pending: PendingRequest, id: number): void {
    if (!pending.timeout) return; // timeoutMs was 0 — no timeout to reset
    clearTimeout(pending.timeout);
    const effectiveTimeout = this.requestTimeoutMs;
    pending.timeout = setTimeout(() => {
      if (!this.pending.has(id)) return;
      this.pending.delete(id);
      this.log.error("Utility request timed out", {
        id,
        type: pending.type,
        timeoutMs: effectiveTimeout,
      });
      pending.reject(
        new Error(
          `Utility request timed out after ${effectiveTimeout}ms: ${pending.type}`,
        ),
      );
    }, effectiveTimeout);
  }

  setWebContents(wc: WebContents): void {
    this.webContents = wc;
    this.log.info("Bound renderer webContents");
  }

  // timeoutMs: per-request override. 0 또는 미지정 시 DEFAULT_REQUEST_TIMEOUT_MS
  // (기본 0 = 무한). 평소엔 무한이지만 테스트/디버깅 시 유한값을 넘겨 빠르게
  // 실패하게 만들 수 있음.
  request<T>(type: string, payload?: unknown, timeoutMs?: number): Promise<T> {
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
      const effectiveTimeout = timeoutMs ?? this.requestTimeoutMs;
      const timeout =
        effectiveTimeout > 0
          ? setTimeout(() => {
              const pending = this.pending.get(id);
              if (!pending) return;
              this.pending.delete(id);
              this.log.error("Utility request timed out", {
                id,
                type: pending.type,
                timeoutMs: effectiveTimeout,
              });
              pending.reject(
                new Error(
                  `Utility request timed out after ${effectiveTimeout}ms: ${pending.type}`,
                ),
              );
            }, effectiveTimeout)
          : null;
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
        if (timeout) clearTimeout(timeout);
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
