import { autoUpdater } from "electron-updater";
import { app } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync, rmSync, existsSync } from "fs";
import type { WebContents } from "electron";
import { createLogger } from "./logger";

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
  } catch {}
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
  } catch {}
}

export function initAutoUpdater(wc: WebContents): void {
  webContents = wc;

  const isMac = process.platform === "darwin";
  autoUpdater.autoDownload = !isMac;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null; // use our own logging

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
    // Skip if already notified this version in this session (e.g. from pending file)
    if (notifiedVersion === info.version) return;
    notifiedVersion = info.version;
    send("app:updateDownloaded", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    log.errorWithStack("Auto-updater error", err);
  });

  // Re-notify about update downloaded in a previous session
  const pending = loadPendingUpdate();
  if (pending) {
    notifiedVersion = pending.version;
    setTimeout(() => send("app:updateDownloaded", pending), 2_000);
  }

  // Check 10 seconds after launch (only in packaged builds)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        log.errorWithStack("checkForUpdates failed", err);
      });
    }, 10_000);
  }
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
