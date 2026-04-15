import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: null as unknown,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers[event]) eventHandlers[event] = [];
      eventHandlers[event].push(handler);
    }),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
  };

  const app = { isPackaged: false };

  return { autoUpdater, app, eventHandlers };
});

vi.mock("electron-updater", () => ({ autoUpdater: mocks.autoUpdater }));
vi.mock("electron", () => ({ app: mocks.app }));
vi.mock("../../../konomi-app/main/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorWithStack: vi.fn(),
  }),
}));

function makeWebContents() {
  return { send: vi.fn() };
}

function emit(event: string, ...args: unknown[]): void {
  for (const handler of mocks.eventHandlers[event] ?? []) {
    handler(...args);
  }
}

beforeEach(() => {
  for (const key of Object.keys(mocks.eventHandlers)) {
    delete mocks.eventHandlers[key];
  }
  mocks.autoUpdater.autoDownload = true;
  mocks.autoUpdater.autoInstallOnAppQuit = true;
  mocks.autoUpdater.on.mockClear();
  mocks.autoUpdater.checkForUpdates.mockClear();
  mocks.autoUpdater.quitAndInstall.mockClear();
  mocks.app.isPackaged = false;
});

describe("initAutoUpdater — Windows", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
  });

  it("sends updateAvailable without releaseUrl", async () => {
    const wc = makeWebContents();
    const { initAutoUpdater } = await import("../../../konomi-app/main/lib/updater");
    initAutoUpdater(wc as never);

    emit("update-available", { version: "1.2.0" });

    expect(wc.send).toHaveBeenCalledWith("app:updateAvailable", {
      version: "1.2.0",
      releaseUrl: undefined,
    });
  });

  it("sends updateDownloaded with version", async () => {
    const wc = makeWebContents();
    const { initAutoUpdater } = await import("../../../konomi-app/main/lib/updater");
    initAutoUpdater(wc as never);

    emit("update-downloaded", { version: "1.2.0" });

    expect(wc.send).toHaveBeenCalledWith("app:updateDownloaded", {
      version: "1.2.0",
    });
  });

  it("sends rounded download progress", async () => {
    const wc = makeWebContents();
    const { initAutoUpdater } = await import("../../../konomi-app/main/lib/updater");
    initAutoUpdater(wc as never);

    emit("download-progress", { percent: 45.6, bytesPerSecond: 512000 });

    expect(wc.send).toHaveBeenCalledWith("app:updateProgress", {
      percent: 46,
      bytesPerSecond: 512000,
    });
  });
});

describe("initAutoUpdater — macOS", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
  });

  it("disables autoDownload and autoInstallOnAppQuit", async () => {
    const { initAutoUpdater } = await import("../../../konomi-app/main/lib/updater");
    initAutoUpdater(makeWebContents() as never);

    expect(mocks.autoUpdater.autoDownload).toBe(false);
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("sends updateAvailable with releaseUrl", async () => {
    const wc = makeWebContents();
    const { initAutoUpdater } = await import("../../../konomi-app/main/lib/updater");
    initAutoUpdater(wc as never);

    emit("update-available", { version: "1.2.0" });

    expect(wc.send).toHaveBeenCalledWith("app:updateAvailable", {
      version: "1.2.0",
      releaseUrl: "https://github.com/blackwaterbread/Konomi/releases/latest",
    });
  });
});

describe("initAutoUpdater — checkForUpdates scheduling", () => {
  it("calls checkForUpdates after 10s when app.isPackaged", async () => {
    vi.useFakeTimers();
    mocks.app.isPackaged = true;

    const { initAutoUpdater } = await import("../../../konomi-app/main/lib/updater");
    initAutoUpdater(makeWebContents() as never);

    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("does not schedule checkForUpdates when not packaged", async () => {
    vi.useFakeTimers();
    mocks.app.isPackaged = false;

    const { initAutoUpdater } = await import("../../../konomi-app/main/lib/updater");
    initAutoUpdater(makeWebContents() as never);

    vi.advanceTimersByTime(10_000);
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

