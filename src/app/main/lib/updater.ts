import { autoUpdater } from "electron-updater";
import { app } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync, rmSync, existsSync } from "fs";
import type { WebContents } from "electron";
import electronLog from "electron-log/main";
import { createLogger } from "@core/lib/logger";

// File logging for the updater. electron-log rotates main.log → main.old.log
// at maxSize and only keeps that single old file, so disk usage is capped at
// roughly 2× maxSize (≈10 MB) regardless of session count.
electronLog.initialize();
electronLog.transports.file.level = "info";
electronLog.transports.file.maxSize = 5 * 1024 * 1024;

const log = createLogger("main/updater");

let webContents: WebContents | null = null;
let notifiedVersion: string | null = null;

function send(channel: string, payload?: unknown): void {
  webContents?.send(channel, payload);
}

function pendingUpdatePath(): string {
  return join(app.getPath("userData"), "pending-update.json");
}

function savePendingUpdate(version: string): void {
  try {
    writeFileSync(pendingUpdatePath(), JSON.stringify({ version }));
  } catch {
    // Best-effort: if write fails, user simply won't be re-notified after restart
  }
}

function loadPendingUpdate(): { version: string } | null {
  try {
    const p = pendingUpdatePath();
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as { version: string };
  } catch {
    return null;
  }
}

function clearPendingUpdate(): void {
  try {
    rmSync(pendingUpdatePath(), { force: true });
  } catch {
    // Best-effort: if delete fails, user may see the update toast once more on next restart
  }
}

export function initAutoUpdater(wc: WebContents): void {
  webContents = wc;

  const isMac = process.platform === "darwin";
  autoUpdater.autoDownload = !isMac;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = electronLog;

  autoUpdater.on("checking-for-update", () => {
    log.info("Checking for update...");
  });

  autoUpdater.on("update-available", (info) => {
    log.info("Update available", { version: info.version });
    const releaseUrl = isMac
      ? "https://github.com/blackwaterbread/Konomi/releases/latest"
      : undefined;
    send("app:updateAvailable", { version: info.version, releaseUrl });
  });

  autoUpdater.on("update-not-available", () => {
    log.info("No update available");
  });

  autoUpdater.on("download-progress", (progress) => {
    send("app:updateProgress", {
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info("Update downloaded", { version: info.version });
    savePendingUpdate(info.version);
    // Dedupe with the pull path: getPendingUpdate() may have already notified
    // the renderer for this same version (e.g. when a re-check immediately
    // re-emits update-downloaded for an already-staged file).
    if (notifiedVersion === info.version) return;
    notifiedVersion = info.version;
    send("app:updateDownloaded", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    log.errorWithStack("Auto-updater error", err);
  });

  // Check 10 seconds after launch (only in packaged builds)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        log.errorWithStack("checkForUpdates failed", err);
      });
    }, 10_000);
  }
}

// Pull-model entry for the renderer. Replaces a previous push that fired on a
// 2s timer at startup and lost the toast whenever bootstrap (initial scan,
// splash) outran the timer. Renderer calls this once after mount.
export function getPendingUpdate(): { version: string } | null {
  const pending = loadPendingUpdate();
  if (!pending) return null;
  // Already-installed marker (e.g. user ran the staged installer manually, or
  // the app was relaunched after auto-install). Drop the stale entry so the
  // toast does not pester them about a version they are already on.
  if (pending.version === app.getVersion()) {
    clearPendingUpdate();
    return null;
  }
  notifiedVersion = pending.version;
  return pending;
}

export function installUpdate(): void {
  clearPendingUpdate();
  autoUpdater.quitAndInstall();
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((err) => {
    log.errorWithStack("checkForUpdates failed", err);
  });
}
