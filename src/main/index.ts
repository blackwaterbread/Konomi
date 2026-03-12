import { app, shell, BrowserWindow, protocol } from "electron";
import { join } from "path";
import fs from "fs";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { registerIpcHandlers } from "./ipc";
import { bridge } from "./bridge";
import { createLogger } from "./lib/logger";
import {
  getImageContentType,
  isManagedImagePath,
  isSupportedImagePath,
} from "./lib/path-guard";

// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: "konomi",
    privileges: { standard: true, secure: true, stream: true },
  },
]);

registerIpcHandlers();
const log = createLogger("main/index");

const BOUNDS_FILE = join(app.getPath("userData"), "window-bounds.json");

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

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  bridge.setWebContents(mainWindow.webContents);
}

app.whenReady().then(() => {
  log.info("App ready");
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
      const data = await fs.promises.readFile(filePath);
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

  createWindow();

  app.on("activate", () => {
    log.info("App activate");
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  log.info("All windows closed", { platform: process.platform });
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  bridge.stop();
});
