import { app, shell, BrowserWindow, nativeImage, protocol } from "electron";
import { dirname, join } from "path";
import fs from "fs";
import { Readable } from "stream";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { registerIpcHandlers } from "./ipc";
import { bridge } from "./bridge";
import { initAutoUpdater } from "./lib/updater";
import { createLogger } from "@core/lib/logger";
import {
  getImageContentType,
  isManagedImagePath,
  isSupportedImagePath,
  warmManagedRootsCache,
} from "./lib/path-guard";
import { PROMPTS_DB_FILENAME } from "@core/lib/prompts-db";

// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: "konomi",
    privileges: { standard: true, secure: true, stream: true },
  },
]);

configureAppDataPaths();

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  const [existing] = BrowserWindow.getAllWindows();
  if (!existing) return;
  if (existing.isMinimized()) existing.restore();
  if (!existing.isVisible()) existing.show();
  existing.focus();
});

registerIpcHandlers();
const log = createLogger("main/index");

const BOUNDS_FILE = join(app.getPath("userData"), "window-bounds.json");
const DEVTOOLS_OPEN_FLAGS = new Set(["-d", "--dev"]);
const APP_ID = "com.electron.konomi";

function configureAppDataPaths(): void {
  if (app.isPackaged) {
    return;
  }

  const defaultUserDataPath = app.getPath("userData");
  const devUserDataPath = `${defaultUserDataPath}-dev`;
  const devSessionDataPath = join(devUserDataPath, "session-data");

  app.setPath("userData", devUserDataPath);
  app.setPath("sessionData", devSessionDataPath);
}

function resolveBundledPromptsDBPath(): string | null {
  const overridePath = (
    process.env.KONOMI_BUNDLED_PROMPTS_DB_PATH ?? ""
  ).trim();
  if (overridePath && fs.existsSync(overridePath)) {
    return overridePath;
  }

  const candidates = [
    join(process.resourcesPath, PROMPTS_DB_FILENAME),
    join(app.getAppPath(), "database", PROMPTS_DB_FILENAME),
    join(process.cwd(), "database", PROMPTS_DB_FILENAME),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getUserPromptsDBPath(): string {
  return join(app.getPath("userData"), PROMPTS_DB_FILENAME);
}

function syncBundledPromptsDBToUserData(): void {
  const targetPath = getUserPromptsDBPath();
  const sourcePath = resolveBundledPromptsDBPath();
  if (!sourcePath) {
    log.info("No bundled prompts DB found", {
      targetPath,
    });
    return;
  }

  if (pathEquals(sourcePath, targetPath)) {
    return;
  }

  try {
    const sourceStat = fs.statSync(sourcePath);
    let shouldCopy = true;

    if (fs.existsSync(targetPath)) {
      const targetStat = fs.statSync(targetPath);
      shouldCopy =
        targetStat.size !== sourceStat.size ||
        Math.abs(targetStat.mtimeMs - sourceStat.mtimeMs) > 1000;
    }

    if (!shouldCopy) {
      return;
    }

    fs.mkdirSync(dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.tmp`;
    fs.copyFileSync(sourcePath, tempPath);
    fs.utimesSync(tempPath, sourceStat.atime, sourceStat.mtime);
    fs.rmSync(targetPath, { force: true });
    fs.renameSync(tempPath, targetPath);

    log.info("Synchronized bundled prompts DB", {
      sourcePath,
      targetPath,
      size: sourceStat.size,
    });
  } catch (error) {
    log.errorWithStack("Failed to synchronize bundled prompts DB", error, {
      sourcePath,
      targetPath,
    });
  }
}

function pathEquals(left: string, right: string): boolean {
  const normalizedLeft =
    process.platform === "win32" ? left.toLowerCase() : left;
  const normalizedRight =
    process.platform === "win32" ? right.toLowerCase() : right;
  return normalizedLeft === normalizedRight;
}

function isDevMode(): boolean {
  if (!app.isPackaged) {
    return true;
  }

  const launchArgs = process.argv.slice(1);
  return launchArgs.some((arg) => DEVTOOLS_OPEN_FLAGS.has(arg));
}

function loadBounds(): {
  width: number;
  height: number;
  x?: number;
  y?: number;
} {
  try {
    return JSON.parse(fs.readFileSync(BOUNDS_FILE, "utf-8"));
  } catch {
    log.warn("Failed to load window bounds; using defaults", {
      boundsFile: BOUNDS_FILE,
    });
    return { width: 1280, height: 800 };
  }
}

function saveBounds(win: BrowserWindow): void {
  try {
    fs.writeFileSync(BOUNDS_FILE, JSON.stringify(win.getBounds()));
  } catch (error) {
    log.errorWithStack("Failed to save window bounds", error, {
      boundsFile: BOUNDS_FILE,
    });
  }
}

function createWindow(): void {
  const bounds = loadBounds();
  log.info("Creating main window", { bounds });
  const mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    log.info("Main window ready-to-show");
    mainWindow.show();
  });

  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedSave = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => saveBounds(mainWindow), 500);
  };
  mainWindow.on("resize", debouncedSave);
  mainWindow.on("move", debouncedSave);
  mainWindow.on("close", () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    saveBounds(mainWindow);
    log.info("Main window closing");
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const nextUrl = new URL(details.url);
      if (nextUrl.protocol === "https:" || nextUrl.protocol === "http:") {
        void shell.openExternal(details.url);
      } else {
        log.warn("Blocked non-http(s) external URL", { url: details.url });
      }
    } catch {
      log.warn("Blocked invalid external URL", { url: details.url });
    }
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    log.info("Loading renderer URL", {
      url: process.env["ELECTRON_RENDERER_URL"],
    });
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    log.info("Loading renderer file");
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  if (isDevMode()) {
    log.info("Opening DevTools", {
      packaged: app.isPackaged,
      argv: process.argv,
    });
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  bridge.setWebContents(mainWindow.webContents);
  initAutoUpdater(mainWindow.webContents);
}

app
  .whenReady()
  .then(() => {
    log.info("App ready");
    syncBundledPromptsDBToUserData();
    bridge.start(join(__dirname, "utility.js"));

    // Serve local image files via konomi:// protocol
    // URL format: konomi://local/<encodeURIComponent(forwardSlashPath)>[?w=<maxWidth>]
    // When ?w is provided, returns a resized JPEG thumbnail to reduce decoded bitmap memory.
    const thumbCacheDir = join(app.getPath("userData"), "thumb-cache");
    fs.mkdirSync(thumbCacheDir, { recursive: true });

    protocol.handle("konomi", async (request) => {
      try {
        const parsedUrl = new URL(request.url);
        if (parsedUrl.hostname !== "local") {
          return new Response(null, { status: 400 });
        }
        const encodedPath = parsedUrl.pathname.startsWith("/")
          ? parsedUrl.pathname.slice(1)
          : parsedUrl.pathname;
        const filePath = decodeURIComponent(encodedPath);
        if (!filePath || !isSupportedImagePath(filePath)) {
          return new Response(null, { status: 415 });
        }
        if (!(await isManagedImagePath(filePath))) {
          log.warn("Blocked konomi protocol path outside managed roots", {
            filePath,
          });
          return new Response(null, { status: 403 });
        }

        const maxWidth = parseInt(parsedUrl.searchParams.get("w") ?? "", 10);
        if (maxWidth > 0) {
          return await serveThumb(filePath, maxWidth, thumbCacheDir);
        }

        const data = Readable.toWeb(
          fs.createReadStream(filePath),
        ) as unknown as BodyInit;
        return new Response(data, {
          headers: {
            "content-type": getImageContentType(filePath),
            "cache-control": "no-store",
          },
        });
      } catch {
        log.debug("konomi protocol file miss", { url: request.url });
        return new Response(null, { status: 404 });
      }
    });

    electronApp.setAppUserModelId(APP_ID);

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    app.on("activate", () => {
      log.info("App activate");
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    return warmManagedRootsCache().finally(() => {
      createWindow();
    });
  })
  .catch((error) => {
    log.errorWithStack("App startup failed", error);
  });

app.on("window-all-closed", () => {
  log.info("All windows closed", { platform: process.platform });
  bridge.stop();
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// Thumbnail generation for gallery grid — reduces decoded bitmap memory ~12x.
// Uses native C++ addon (libpng decode + bilinear resize) when available,
// falls back to Electron nativeImage.  Caches to disk.
// ---------------------------------------------------------------------------
import crypto from "crypto";
import { resizePng } from "@core/lib/konomi-image";
import { resizeWebp } from "@core/lib/webp-alpha";

async function serveThumb(
  filePath: string,
  maxWidth: number,
  cacheDir: string,
): Promise<Response> {
  // Deterministic cache key from path + maxWidth + file mtime
  const stat = await fs.promises.stat(filePath);
  const hash = crypto
    .createHash("md5")
    .update(`${filePath}\0${maxWidth}\0${stat.mtimeMs}`)
    .digest("hex");
  const cachePath = join(cacheDir, `${hash}.jpg`);

  // Serve from disk cache if available (skip zero-byte corrupt entries)
  try {
    const cacheStat = await fs.promises.stat(cachePath);
    if (cacheStat.size > 0) {
      const data = Readable.toWeb(
        fs.createReadStream(cachePath),
      ) as unknown as BodyInit;
      return new Response(data, {
        headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
      });
    }
  } catch {
    // Cache miss — generate thumbnail
  }

  const jpegBuffer = await generateThumb(filePath, maxWidth);
  if (!jpegBuffer || jpegBuffer.length === 0) {
    // Image already small enough — serve original
    const data = Readable.toWeb(
      fs.createReadStream(filePath),
    ) as unknown as BodyInit;
    return new Response(data, {
      headers: {
        "content-type": getImageContentType(filePath),
        "cache-control": "no-store",
      },
    });
  }

  // Write cache asynchronously — don't block response
  fs.promises.writeFile(cachePath, jpegBuffer).catch(() => {});

  return new Response(new Uint8Array(jpegBuffer), {
    headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
  });
}

/** Try native C++ resize first, fall back to Electron nativeImage. */
function generateThumb(
  filePath: string,
  maxWidth: number,
): Promise<Buffer | null> {
  // Fast path: native addon (C++ decode + bilinear resize)
  try {
    const buf = fs.readFileSync(filePath);
    const ext = filePath.toLowerCase();
    const result = ext.endsWith(".webp")
      ? resizeWebp(buf, maxWidth)
      : resizePng(buf, maxWidth);
    if (result) {
      // result.data is raw BGRA pixels → convert to JPEG via nativeImage
      const bmp = nativeImage.createFromBitmap(result.data, {
        width: result.width,
        height: result.height,
      });
      return Promise.resolve(bmp.toJPEG(80));
    }
    // null = image already small enough
    return Promise.resolve(null);
  } catch {
    // Native addon unavailable or decode failed — fall back
  }

  // Slow path: Electron nativeImage (full decode + resize)
  const img = nativeImage.createFromPath(filePath);
  const size = img.getSize();
  if (size.width <= maxWidth) return Promise.resolve(null);

  const resized = img.resize({ width: maxWidth, quality: "good" });
  return Promise.resolve(resized.toJPEG(80));
}
