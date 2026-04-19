import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/services";

type DetectedDir = { name: string; path: string };

const listAvailableDirectoriesMock = vi.fn<() => Promise<DetectedDir[]>>();
const dataRootExistsMock = vi.fn<() => Promise<boolean>>();
const isUnderDataRootMock = vi.fn<(p: string) => boolean>();

vi.mock("../../../src/server/lib/data-root", () => ({
  listAvailableDirectories: () => listAvailableDirectoriesMock(),
  dataRootExists: () => dataRootExistsMock(),
  isUnderDataRoot: (p: string) => isUnderDataRootMock(p),
}));

vi.mock("../../../src/server/db", () => ({
  getDB: () => ({}),
}));

// services.ts imports `bun:sqlite` for promptTagService; that module is
// unavailable under the node test runner. Stub it out.
vi.mock("bun:sqlite", () => ({ Database: class {} }));

type FolderRow = { id: number; name: string; path: string };

function createMockServices(initial: FolderRow[] = []) {
  let rows: FolderRow[] = [...initial];
  let nextId = (rows.at(-1)?.id ?? 0) + 1;

  const folderService = {
    list: vi.fn(async () => rows.slice()),
    create: vi.fn(async (name: string, folderPath: string) => {
      const row = { id: nextId++, name, path: folderPath };
      rows.push(row);
      return row;
    }),
    delete: vi.fn(async (id: number) => {
      rows = rows.filter((r) => r.id !== id);
    }),
  };
  const categoryService = { seedBuiltins: vi.fn(async () => {}) };
  const duplicateService = { ensureIgnoredLoaded: vi.fn(async () => {}) };
  const watchService = { startAll: vi.fn(async () => {}) };

  return {
    services: {
      folderService,
      categoryService,
      duplicateService,
      watchService,
    } as unknown as Services,
    spies: { folderService, categoryService, duplicateService, watchService },
    getRows: () => rows.slice(),
  };
}

async function loadBootstrap() {
  vi.resetModules();
  const mod = await import("../../../src/server/services");
  return mod.bootstrap;
}

beforeEach(() => {
  listAvailableDirectoriesMock.mockReset();
  dataRootExistsMock.mockReset();
  isUnderDataRootMock.mockReset();
  isUnderDataRootMock.mockReturnValue(true);
});

describe("bootstrap — autoRegisterFolders", () => {
  it("registers detected directories that are not yet in DB", async () => {
    const { services, spies } = createMockServices([]);
    listAvailableDirectoriesMock.mockResolvedValue([
      { name: "photos", path: "/images/photos" },
      { name: "art", path: "/images/art" },
    ]);
    dataRootExistsMock.mockResolvedValue(true);

    const bootstrap = await loadBootstrap();
    await bootstrap(services);

    expect(spies.folderService.create).toHaveBeenCalledTimes(2);
    expect(spies.folderService.create).toHaveBeenCalledWith(
      "photos",
      "/images/photos",
    );
    expect(spies.folderService.create).toHaveBeenCalledWith(
      "art",
      "/images/art",
    );
  });

  it("skips directories that are already registered (normalized path)", async () => {
    const { services, spies } = createMockServices([
      { id: 1, name: "photos", path: "/images/photos" },
    ]);
    listAvailableDirectoriesMock.mockResolvedValue([
      { name: "photos", path: "/images/photos" },
      { name: "art", path: "/images/art" },
    ]);
    dataRootExistsMock.mockResolvedValue(true);

    const bootstrap = await loadBootstrap();
    await bootstrap(services);

    expect(spies.folderService.create).toHaveBeenCalledTimes(1);
    expect(spies.folderService.create).toHaveBeenCalledWith(
      "art",
      "/images/art",
    );
  });
});

describe("bootstrap — reconcileRemovedFolders", () => {
  it("removes DB folders that are no longer under DATA_ROOT", async () => {
    const { services, spies } = createMockServices([
      { id: 1, name: "photos", path: "/images/photos" },
      { id: 2, name: "gone", path: "/images/gone" },
    ]);
    listAvailableDirectoriesMock.mockResolvedValue([
      { name: "photos", path: "/images/photos" },
    ]);
    dataRootExistsMock.mockResolvedValue(true);

    const bootstrap = await loadBootstrap();
    await bootstrap(services);

    expect(spies.folderService.delete).toHaveBeenCalledTimes(1);
    expect(spies.folderService.delete).toHaveBeenCalledWith(2);
  });

  it("skips reconciliation entirely when DATA_ROOT itself is missing", async () => {
    const { services, spies } = createMockServices([
      { id: 1, name: "photos", path: "/images/photos" },
    ]);
    dataRootExistsMock.mockResolvedValue(false);
    listAvailableDirectoriesMock.mockResolvedValue([]);

    const bootstrap = await loadBootstrap();
    await bootstrap(services);

    expect(spies.folderService.delete).not.toHaveBeenCalled();
    // autoRegister still runs but has nothing to register
    expect(spies.folderService.create).not.toHaveBeenCalled();
  });

  it("does not delete folders that are outside DATA_ROOT (defensive)", async () => {
    const { services, spies } = createMockServices([
      { id: 1, name: "external", path: "/mnt/other/external" },
    ]);
    isUnderDataRootMock.mockImplementation((p) => p.startsWith("/images/"));
    listAvailableDirectoriesMock.mockResolvedValue([]);
    dataRootExistsMock.mockResolvedValue(true);

    const bootstrap = await loadBootstrap();
    await bootstrap(services);

    expect(spies.folderService.delete).not.toHaveBeenCalled();
  });
});

describe("bootstrap — orchestration", () => {
  it("seeds builtins, loads ignored duplicates, and starts watcher paused", async () => {
    const { services, spies } = createMockServices([]);
    listAvailableDirectoriesMock.mockResolvedValue([]);
    dataRootExistsMock.mockResolvedValue(true);

    const bootstrap = await loadBootstrap();
    await bootstrap(services);

    expect(spies.categoryService.seedBuiltins).toHaveBeenCalledOnce();
    expect(spies.duplicateService.ensureIgnoredLoaded).toHaveBeenCalledOnce();
    expect(spies.watchService.startAll).toHaveBeenCalledWith({ paused: true });
  });
});
