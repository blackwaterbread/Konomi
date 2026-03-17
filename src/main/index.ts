import { app, shell, BrowserWindow, protocol, session } from "electron";
import { dirname, join } from "path";
import fs from "fs";
import { Readable } from "stream";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { registerIpcHandlers } from "./ipc";
import { bridge } from "./bridge";
import { createLogger } from "./lib/logger";
import {
  getImageContentType,
  isManagedImagePath,
  isSupportedImagePath,
  warmManagedRootsCache,
} from "./lib/path-guard";
import { PROMPTS_DB_FILENAME } from "./lib/prompts-db";

// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: "konomi",
    privileges: { standard: true, secure: true, stream: true },
  },
]);

configureAppDataPaths();
registerIpcHandlers();
const log = createLogger("main/index");

const BOUNDS_FILE = join(app.getPath("userData"), "window-bounds.json");

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
    join(app.getAppPath(), "resources", PROMPTS_DB_FILENAME),
    join(process.cwd(), "resources", PROMPTS_DB_FILENAME),
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

async function installReactDevTools(): Promise<void> {
  if (!is.dev || app.isPackaged) {
    return;
  }

  try {
    const { downloadChromeExtension } =
      await import("electron-devtools-installer/dist/downloadChromeExtension");
    const extensionPath = await downloadChromeExtension(
      "fmkadmapgofadopljbjfkapdkoienihi",
    );
    const extensions = session.defaultSession.extensions;
    const installedExtension = extensions
      .getAllExtensions()
      .find(
        (extension) =>
          extension.path === extensionPath ||
          extension.name === "React Developer Tools",
      );

    if (installedExtension) {
      log.info("React DevTools extension already loaded", {
        id: installedExtension.id,
        name: installedExtension.name,
        path: installedExtension.path,
      });
      return;
    }

    const extension = await extensions.loadExtension(extensionPath, {
      allowFileAccess: true,
    });
    log.info("Installed React DevTools extension", {
      id: extension.id,
      name: extension.name,
      path: extension.path,
      version: extension.version,
    });
  } catch (error) {
    log.warn("Failed to install React DevTools extension", {
      error: error instanceof Error ? error.message : String(error),
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

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  bridge.setWebContents(mainWindow.webContents);
}

app
  .whenReady()
  .then(() => {
    log.info("App ready");
    syncBundledPromptsDBToUserData();
    bridge.start(join(__dirname, "utility.js"));

    // Serve local image files via konomi:// protocol
    // URL format: konomi://local/<encodeURIComponent(forwardSlashPath)>
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
        const data = Readable.toWeb(
          fs.createReadStream(filePath),
        ) as unknown as BodyInit;
        return new Response(data, {
          headers: { "content-type": getImageContentType(filePath) },
        });
      } catch {
        log.debug("konomi protocol file miss", { url: request.url });
        return new Response(null, { status: 404 });
      }
    });

    electronApp.setAppUserModelId("com.dayrain.konomi");

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    app.on("activate", () => {
      log.info("App activate");
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    return Promise.all([
      installReactDevTools(),
      warmManagedRootsCache(),
    ]).finally(() => {
      createWindow();
    });
  })
  .catch((error) => {
    log.errorWithStack("App startup failed", error);
  });

app.on("window-all-closed", () => {
  log.info("All windows closed", { platform: process.platform });
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  bridge.stop();
});
