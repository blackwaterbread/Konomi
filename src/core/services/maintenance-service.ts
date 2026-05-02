// ---------------------------------------------------------------------------
// Maintenance service — debounced background analysis runner.
//
// Owns the "schedule + run computeAllHashes / similarity refresh" loop that
// previously lived in the renderer. The Electron utility process and the
// Fastify web server both wire one of these up, so analysis runs even when
// no client is connected. Renderer/web clients can still trigger a run
// manually via runAnalysisNow().
// ---------------------------------------------------------------------------

import type { CancelToken } from "../lib/scanner";
import type { EventSender } from "../types/event-sender";
import { createLogger } from "../lib/logger";

export type MaintenanceServiceDeps = {
  /** Compute pHash for any unhashed images and refresh similarity cache. */
  computeAllHashes(
    onHashProgress?: (done: number, total: number) => void,
    onSimilarityProgress?: (done: number, total: number) => void,
    signal?: CancelToken,
  ): Promise<number>;
  /**
   * Optional EventSender used to broadcast {active: boolean} on
   * "image:analysisActive". Renderer/web clients listen for this to mirror
   * the maintenance run state in their UI.
   */
  sender?: EventSender;
  /**
   * Returns true if a scan is currently active. The maintenance service
   * defers analysis until scans finish to avoid IO contention. Production
   * callers always wire this; without it the scheduler treats every tick as
   * scan-idle.
   */
  isScanActive?(): boolean;
};

export type MaintenanceRunResult = {
  /** True if the run completed without cancellation; false if cancelled, skipped, or errored. */
  ok: boolean;
  /** Number of images hashed by computeAllHashes. */
  hashed: number;
};

export type MaintenanceService = {
  /**
   * Debounced trigger. Clears any pending scheduled run and schedules a new
   * one at `delay` ms. If a scan is active when the timer fires, the run
   * reschedules itself for SCAN_RECHECK_DELAY_MS; the caller does not need
   * to coordinate.
   */
  scheduleAnalysis(delay?: number): void;
  /**
   * Manual, immediate trigger (e.g. settings panel "지금 분석" button).
   * Dedupes against any in-flight run — concurrent callers receive the
   * same promise. Returns `{ ok: false, hashed: 0 }` without doing work
   * when (a) shutdown has been requested or (b) a scan is currently
   * active. The latter mirrors `scheduleAnalysis` deferral semantics so
   * direct callers don't have to special-case scan-active themselves.
   */
  runAnalysisNow(): Promise<MaintenanceRunResult>;
  /**
   * Cancel any in-flight analysis run, drop any pending scheduled run, and
   * refuse subsequent triggers. Used during process shutdown.
   */
  requestShutdown(): void;
  /** Wait for any in-flight analysis run to finish (or be cancelled). */
  flush(): Promise<void>;
  /** True while a run is in flight (used by Electron utility for state push). */
  isRunning(): boolean;
};

const log = createLogger("maintenance-service");

const DEFAULT_DELAY_MS = 3000;
const SCAN_RECHECK_DELAY_MS = 1000;

export function createMaintenanceService(
  deps: MaintenanceServiceDeps,
): MaintenanceService {
  const { computeAllHashes, sender } = deps;

  let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  let analysisPromise: Promise<MaintenanceRunResult> | null = null;
  let activeCancelToken: CancelToken | null = null;
  let shuttingDown = false;

  function emitActive(active: boolean): void {
    sender?.send("image:analysisActive", { active });
  }

  function emitHashProgress(done: number, total: number): void {
    sender?.send("image:hashProgress", { done, total });
  }

  function emitSimilarityProgress(done: number, total: number): void {
    sender?.send("image:similarityProgress", { done, total });
  }

  function clearScheduleTimer(): void {
    if (scheduleTimer) {
      clearTimeout(scheduleTimer);
      scheduleTimer = null;
    }
  }

  function isScanCurrentlyActive(): boolean {
    return deps.isScanActive?.() ?? false;
  }

  function runAnalysisNow(): Promise<MaintenanceRunResult> {
    if (shuttingDown) return Promise.resolve({ ok: false, hashed: 0 });
    if (analysisPromise) return analysisPromise;
    // Scan-active check happens BEFORE emitActive so the UI doesn't see a
    // brief active=true → false flicker when the user clicks "지금 분석"
    // mid-scan.
    if (isScanCurrentlyActive()) {
      log.debug("Skipping run because scan is active");
      return Promise.resolve({ ok: false, hashed: 0 });
    }

    const startedAt = Date.now();
    const token: CancelToken = { cancelled: false };
    activeCancelToken = token;
    emitActive(true);
    log.info("Maintenance run starting");

    const run = (async (): Promise<MaintenanceRunResult> => {
      try {
        const hashed = await computeAllHashes(
          emitHashProgress,
          emitSimilarityProgress,
          token,
        );
        log.info("Maintenance run completed", {
          hashed,
          cancelled: token.cancelled,
          elapsedMs: Date.now() - startedAt,
        });
        return { ok: !token.cancelled, hashed };
      } catch (err) {
        log.errorWithStack(
          "Maintenance run failed",
          err instanceof Error ? err : new Error(String(err)),
        );
        return { ok: false, hashed: 0 };
      } finally {
        activeCancelToken = null;
        analysisPromise = null;
        emitActive(false);
      }
    })();

    analysisPromise = run;
    return run;
  }

  function scheduleAnalysis(delay = DEFAULT_DELAY_MS): void {
    if (shuttingDown) return;
    clearScheduleTimer();
    scheduleTimer = setTimeout(() => {
      scheduleTimer = null;
      if (shuttingDown) return;
      if (isScanCurrentlyActive()) {
        log.debug("Re-scheduling because scan is active");
        scheduleAnalysis(SCAN_RECHECK_DELAY_MS);
        return;
      }
      void runAnalysisNow();
    }, delay);
  }

  function requestShutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    clearScheduleTimer();
    if (activeCancelToken) {
      activeCancelToken.cancelled = true;
      log.info("Maintenance shutdown: cancelling in-flight run");
    }
  }

  async function flush(): Promise<void> {
    if (analysisPromise) {
      try {
        await analysisPromise;
      } catch {
        // Already logged inside the run.
      }
    }
  }

  function isRunning(): boolean {
    return analysisPromise !== null;
  }

  return {
    scheduleAnalysis,
    runAnalysisNow,
    requestShutdown,
    flush,
    isRunning,
  };
}
