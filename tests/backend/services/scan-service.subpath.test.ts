import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupIsolatedDbTest,
  type IsolatedDbTestContext,
} from "../helpers/test-db";
import type { ImageMeta } from "@core/types/image-meta";

vi.mock("worker_threads", () => {
  class FakeWorker {
    on(): this {
      return this;
    }

    postMessage(): void {
      // The scan service under test is driven with an injected readMeta.
    }
  }
  return { Worker: FakeWorker };
});

let ctx: IsolatedDbTestContext;

beforeEach(async () => {
  ctx = await setupIsolatedDbTest();
});

afterEach(async () => {
  await ctx.cleanup();
});

const META: ImageMeta = {
  prompt: "a prompt",
  negativePrompt: "",
  characterPrompts: [],
  characterNegativePrompts: [],
  characterPositions: [],
  source: "nai",
  model: "nai-diffusion",
  seed: "1",
  width: 512,
  height: 512,
  sampler: "k_euler",
  steps: 28,
  cfgScale: 6,
  cfgRescale: 0,
  noiseSchedule: "karras",
  varietyPlus: false,
  raw: {},
};

describe("scanService.scanAll with subPaths", () => {
  async function buildService(onEvent?: (channel: string, data: unknown) => void) {
    const { getDB } = await import("@core/lib/db");
    const { createPrismaImageRepo } = await import(
      "@core/lib/repositories/prisma-image-repo"
    );
    const { createPrismaFolderRepo } = await import(
      "@core/lib/repositories/prisma-folder-repo"
    );
    const { createScanService } = await import("@core/services/scan-service");

    const events: { channel: string; data: unknown }[] = [];
    const scanService = createScanService({
      imageRepo: createPrismaImageRepo(getDB),
      folderRepo: createPrismaFolderRepo(getDB),
      sender: {
        send: (channel, data) => {
          events.push({ channel, data });
          onEvent?.(channel, data);
        },
      },
      readMeta: async () => META,
    });

    return { scanService, events, getDB };
  }

  function writePng(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "fake-png-bytes");
  }

  /** Folder with `alpha/`, `beta/` subfolders plus one root-level image. */
  async function createLibrary() {
    const root = path.join(ctx.userDataDir, "library");
    const alpha = path.join(root, "alpha");
    const beta = path.join(root, "beta");
    writePng(path.join(root, "root.png"));
    writePng(path.join(alpha, "a1.png"));
    writePng(path.join(alpha, "a2.png"));
    writePng(path.join(beta, "b1.png"));

    const { getDB } = await import("@core/lib/db");
    const folder = await getDB().folder.create({
      data: { name: "library", path: root },
    });
    return { folder, root, alpha, beta };
  }

  async function storedPaths(): Promise<string[]> {
    const { getDB } = await import("@core/lib/db");
    const rows = await getDB().image.findMany({ select: { path: true } });
    return rows.map((r) => r.path).sort();
  }

  it("walks only the requested subtree", async () => {
    const { scanService } = await buildService();
    const { folder, alpha } = await createLibrary();

    await scanService.scanAll({ folderIds: [folder.id], subPaths: [alpha] });

    expect(await storedPaths()).toEqual(
      [path.join(alpha, "a1.png"), path.join(alpha, "a2.png")].sort(),
    );
  });

  it("prunes stale rows inside the subtree but leaves the rest of the folder alone", async () => {
    const { scanService } = await buildService();
    const { folder, root, alpha, beta } = await createLibrary();

    await scanService.scanAll({ folderIds: [folder.id] });
    expect(await storedPaths()).toHaveLength(4);

    // Delete one file in the target subtree and one outside it. Only the
    // in-subtree deletion may be reflected by a subtree-scoped scan.
    fs.rmSync(path.join(alpha, "a2.png"));
    fs.rmSync(path.join(beta, "b1.png"));

    await scanService.scanAll({ folderIds: [folder.id], subPaths: [alpha] });

    expect(await storedPaths()).toEqual(
      [
        path.join(root, "root.png"),
        path.join(alpha, "a1.png"),
        path.join(beta, "b1.png"),
      ].sort(),
    );
  });

  it("prunes nothing when the walk is cancelled partway through", async () => {
    // The walk stops at the first subdirectory it opens once the sync phase
    // has begun, leaving the files under it undiscovered. Their rows are not
    // stale — the scan simply never looked at them — so pruning on that
    // partial view would delete images that are still on disk.
    let syncing = false;
    let cancelled = false;
    const signal = {
      get cancelled() {
        return cancelled;
      },
    };
    const { scanService } = await buildService((channel, data) => {
      if (
        channel === "image:scanFolder" &&
        (data as { active?: boolean }).active === true
      ) {
        syncing = true;
      }
    });
    const { folder, root } = await createLibrary();

    await scanService.scanAll({ folderIds: [folder.id] });
    const indexed = await storedPaths();
    expect(indexed).toHaveLength(4);

    // The first scan already emitted the event; only the second run's sync
    // phase may arm the trigger, or the file count pass cancels the scan
    // before `syncFolder` — and Phase 3 is never reached.
    syncing = false;

    const realOpendir = fs.promises.opendir;
    const opendirSpy = vi
      .spyOn(fs.promises, "opendir")
      .mockImplementation((async (dir: string, ...rest: unknown[]) => {
        if (syncing && dir !== root) cancelled = true;
        return (realOpendir as (...args: unknown[]) => unknown)(dir, ...rest);
      }) as typeof fs.promises.opendir);

    try {
      const result = await scanService.scanAll({
        folderIds: [folder.id],
        signal,
      });
      expect(result.cancelled).toBe(true);
    } finally {
      opendirSpy.mockRestore();
    }

    expect(await storedPaths()).toEqual(indexed);
  });

  it("keeps rows whose directory could not be read and prunes only the deleted file", async () => {
    // `walkImageFiles` logs and moves on when a directory will not open, so
    // its files go undiscovered exactly like deleted ones. No cancellation is
    // involved: one denied readdir is enough to make a whole subtree look
    // stale, and only stat-ing each row tells the two cases apart.
    const { scanService } = await buildService();
    const { folder, root, alpha, beta } = await createLibrary();

    await scanService.scanAll({ folderIds: [folder.id] });
    expect(await storedPaths()).toHaveLength(4);

    fs.rmSync(path.join(beta, "b1.png"));

    const realOpendir = fs.promises.opendir;
    const opendirSpy = vi
      .spyOn(fs.promises, "opendir")
      .mockImplementation((async (dir: string, ...rest: unknown[]) => {
        if (dir === alpha) {
          throw Object.assign(new Error("EACCES: permission denied"), {
            code: "EACCES",
          });
        }
        return (realOpendir as (...args: unknown[]) => unknown)(dir, ...rest);
      }) as typeof fs.promises.opendir);

    try {
      await scanService.scanAll({ folderIds: [folder.id] });
    } finally {
      opendirSpy.mockRestore();
    }

    // `alpha` is intact on disk, so its rows stay; `beta/b1.png` is really
    // gone and is the only row that may be dropped.
    expect(await storedPaths()).toEqual(
      [
        path.join(root, "root.png"),
        path.join(alpha, "a1.png"),
        path.join(alpha, "a2.png"),
      ].sort(),
    );
  });

  it("does not report a folder as changed because a directory would not open", async () => {
    const { scanService } = await buildService();
    const { folder, alpha, beta } = await createLibrary();

    await scanService.scanAll({ folderIds: [folder.id] });

    const realOpendir = fs.promises.opendir;
    const opendirSpy = vi
      .spyOn(fs.promises, "opendir")
      .mockImplementation((async (dir: string, ...rest: unknown[]) => {
        if (dir === alpha) {
          throw Object.assign(new Error("EACCES: permission denied"), {
            code: "EACCES",
          });
        }
        return (realOpendir as (...args: unknown[]) => unknown)(dir, ...rest);
      }) as typeof fs.promises.opendir);

    try {
      // Undiscovered but intact: a full rescan cannot fix what a failed
      // readdir hid, so reporting it would buy a boot-time scan every time.
      await expect(scanService.quickVerify()).resolves.toMatchObject({
        changedFolderIds: [],
        unchangedFolderIds: [folder.id],
      });

      // A file that is genuinely gone must still be caught, unreadable
      // sibling directory or not.
      fs.rmSync(path.join(beta, "b1.png"));
      await expect(scanService.quickVerify()).resolves.toMatchObject({
        changedFolderIds: [folder.id],
        unchangedFolderIds: [],
      });
    } finally {
      opendirSpy.mockRestore();
    }
  });

  it("prunes rows of a subtree that no longer exists on disk", async () => {
    const { scanService } = await buildService();
    const { folder, root, alpha, beta } = await createLibrary();

    await scanService.scanAll({ folderIds: [folder.id] });
    expect(await storedPaths()).toHaveLength(4);

    fs.rmSync(alpha, { recursive: true });

    await scanService.scanAll({ folderIds: [folder.id], subPaths: [alpha] });

    expect(await storedPaths()).toEqual(
      [path.join(root, "root.png"), path.join(beta, "b1.png")].sort(),
    );
  });

  it("skips an unreadable subtree instead of pruning its rows", async () => {
    const { scanService } = await buildService();
    const { folder, root, alpha } = await createLibrary();

    await scanService.scanAll({ folderIds: [folder.id] });
    const before = await storedPaths();
    expect(before).toHaveLength(4);

    // The parent cannot be listed and the subtree's own stat fails with a
    // non-ENOENT error, so whether it still exists is unknown. Unknown must
    // not be read as deleted — pruning here would drop a live index.
    const eacces = Object.assign(new Error("EACCES"), { code: "EACCES" });
    const realReaddir = fs.promises.readdir;
    const realStat = fs.promises.stat;
    const readdirSpy = vi
      .spyOn(fs.promises, "readdir")
      .mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) =>
        path.resolve(String(p)) === path.resolve(root)
          ? Promise.reject(eacces)
          : (realReaddir as (...a: unknown[]) => unknown)(p, ...rest)) as never);
    const statSpy = vi
      .spyOn(fs.promises, "stat")
      .mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) =>
        path.resolve(String(p)) === path.resolve(alpha)
          ? Promise.reject(eacces)
          : (realStat as (...a: unknown[]) => unknown)(p, ...rest)) as never);

    try {
      await scanService.scanAll({ folderIds: [folder.id], subPaths: [alpha] });
    } finally {
      readdirSpy.mockRestore();
      statSpy.mockRestore();
    }

    expect(await storedPaths()).toEqual(before);
  });

  it("skips a subtree whose folder root is gone instead of pruning its rows", async () => {
    const { scanService } = await buildService();
    const { folder, alpha } = await createLibrary();

    await scanService.scanAll({ folderIds: [folder.id] });
    const before = await storedPaths();
    expect(before).toHaveLength(4);

    // An unmounted share or a moved folder root answers ENOENT for every path
    // beneath it, so the subtree looks deleted while the whole library is only
    // unreachable. A full-folder scan skips that case; the subtree-scoped one
    // must not prune on it either.
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const realReaddir = fs.promises.readdir;
    const realAccess = fs.promises.access;
    const realStat = fs.promises.stat;
    const rejectFor = (target: string, real: unknown) =>
      (async (p: fs.PathLike, ...rest: unknown[]) =>
        path.resolve(String(p)) === path.resolve(target)
          ? Promise.reject(enoent)
          : (real as (...a: unknown[]) => unknown)(p, ...rest)) as never;

    const readdirSpy = vi
      .spyOn(fs.promises, "readdir")
      .mockImplementation(rejectFor(folder.path, realReaddir));
    const accessSpy = vi
      .spyOn(fs.promises, "access")
      .mockImplementation(rejectFor(folder.path, realAccess));
    const statSpy = vi
      .spyOn(fs.promises, "stat")
      .mockImplementation(rejectFor(alpha, realStat));

    try {
      await scanService.scanAll({ folderIds: [folder.id], subPaths: [alpha] });
    } finally {
      readdirSpy.mockRestore();
      accessSpy.mockRestore();
      statSpy.mockRestore();
    }

    expect(await storedPaths()).toEqual(before);
  });

  it("ignores subPaths that fall outside the resolved folder", async () => {
    const { scanService } = await buildService();
    const { folder } = await createLibrary();

    const outside = path.join(ctx.userDataDir, "elsewhere");
    writePng(path.join(outside, "x.png"));

    await scanService.scanAll({ folderIds: [folder.id], subPaths: [outside] });

    expect(await storedPaths()).toEqual([]);
  });

  it("ignores a subPath that climbs out of the folder with traversal segments", async () => {
    const { scanService } = await buildService();
    const { folder, alpha } = await createLibrary();

    // Escapes the folder while still carrying its prefix as a raw string, so
    // only a resolved containment check can reject it.
    const outside = path.join(ctx.userDataDir, "elsewhere");
    writePng(path.join(outside, "x.png"));
    const traversal = path.join(alpha, "..", "..", "elsewhere");

    await scanService.scanAll({
      folderIds: [folder.id],
      subPaths: [traversal],
    });

    expect(await storedPaths()).toEqual([]);
  });

  it("scans a nested subtree once when an ancestor subtree is requested too", async () => {
    const { scanService, events } = await buildService();
    const { folder, root, alpha } = await createLibrary();
    const nested = path.join(alpha, "deep");
    writePng(path.join(nested, "d1.png"));

    await scanService.scanAll({
      folderIds: [folder.id],
      subPaths: [nested, alpha],
    });

    const scanRoots = events
      .filter(
        (e) =>
          e.channel === "image:scanFolder" &&
          (e.data as { active: boolean }).active,
      )
      .map((e) => (e.data as { subPath?: string }).subPath);
    expect(scanRoots).toEqual([alpha]);

    // The nested file is still picked up — via the ancestor walk.
    expect(await storedPaths()).toEqual(
      [
        path.join(alpha, "a1.png"),
        path.join(alpha, "a2.png"),
        path.join(nested, "d1.png"),
      ].sort(),
    );
    expect(await storedPaths()).not.toContain(path.join(root, "root.png"));
  });

  it.runIf(process.platform === "win32")(
    "does not duplicate rows when a subPath spells the subtree differently",
    async () => {
      const { scanService } = await buildService();
      const root = path.join(ctx.userDataDir, "library");
      const mixedCase = path.join(root, "MixedCase");
      writePng(path.join(mixedCase, "m1.png"));

      const { getDB } = await import("@core/lib/db");
      const folder = await getDB().folder.create({
        data: { name: "library", path: root },
      });

      await scanService.scanAll({ folderIds: [folder.id] });
      const afterFull = await storedPaths();
      expect(afterFull).toEqual([path.join(mixedCase, "m1.png")]);

      // `getSubfolderPaths` now reports the on-disk spelling, so this is no
      // longer how the sidebar calls in. It stays covered because the guarantee
      // belongs to the scan: whatever spelling reaches it, a file already
      // indexed keeps its one row.
      await scanService.scanAll({
        folderIds: [folder.id],
        subPaths: [mixedCase.toLowerCase()],
      });

      expect(await storedPaths()).toEqual(afterFull);
    },
  );

  it("reports a subPath it could not read instead of passing silently", async () => {
    const { scanService, events } = await buildService();
    const { folder, root } = await createLibrary();

    await scanService.scanAll({ folderIds: [folder.id] });
    const before = await storedPaths();

    const absent = path.join(root, "alpha", "does-not-exist");
    const outside = path.join(ctx.userDataDir, "elsewhere");
    const result = await scanService.scanAll({
      folderIds: [folder.id],
      subPaths: [outside],
    });

    // Outside every folder: nothing to scan, and the caller has to hear it.
    expect(result.cancelled).toBe(false);
    expect(result.skippedSubPaths).toEqual([outside]);
    expect(
      events.filter((e) => e.channel === "image:scanSkipped").map((e) => e.data),
    ).toEqual([{ subPaths: [outside] }]);
    expect(await storedPaths()).toEqual(before);

    // A subtree confirmed gone is pruned, not skipped — it gets a target.
    const missing = await scanService.scanAll({
      folderIds: [folder.id],
      subPaths: [absent],
    });
    expect(missing.skippedSubPaths).toEqual([]);
  });

  it("reports a repeated subPath once", async () => {
    const { scanService, events } = await buildService();
    const { folder } = await createLibrary();

    const outside = path.join(ctx.userDataDir, "elsewhere");
    writePng(path.join(outside, "x.png"));

    const result = await scanService.scanAll({
      folderIds: [folder.id],
      subPaths: [outside, outside + path.sep, outside],
    });

    // One bad directory is one notice. Undeduplicated, the same path is probed
    // three times and the user reads "3 folders could not be read".
    expect(result.skippedSubPaths).toEqual([outside]);
    expect(
      events.filter((e) => e.channel === "image:scanSkipped").map((e) => e.data),
    ).toEqual([{ subPaths: [outside] }]);
  });

  /** `library` plus `library/alpha` registered as a folder in its own right. */
  async function createNestedRoots() {
    const { folder: outer, alpha } = await createLibrary();
    const { getDB } = await import("@core/lib/db");
    const inner = await getDB().folder.create({
      data: { name: "alpha", path: alpha },
    });
    const deep = path.join(alpha, "deep");
    writePng(path.join(deep, "d1.png"));
    return { outer, inner, alpha, deep };
  }

  it("gives a subtree under nested folder roots one target, owned by the innermost", async () => {
    const { scanService, events, getDB } = await buildService();
    const { inner, deep } = await createNestedRoots();

    // No folderIds, so both roots resolve — and both contain `deep`. Paired
    // against every containing root it is walked and synced twice, and the row
    // lands on whichever folder the loop reached last.
    await scanService.scanAll({ subPaths: [deep] });

    expect(
      events.filter(
        (e) =>
          e.channel === "image:scanFolder" &&
          (e.data as { active: boolean }).active,
      ),
    ).toHaveLength(1);
    expect(
      await getDB().image.findMany({ select: { path: true, folderId: true } }),
    ).toEqual([{ path: path.join(deep, "d1.png"), folderId: inner.id }]);
  });

  it("reports an unreadable subtree under nested folder roots once", async () => {
    const { scanService, events } = await buildService();
    const { deep } = await createNestedRoots();

    const eacces = Object.assign(new Error("EACCES"), { code: "EACCES" });
    const realOpendir = fs.promises.opendir;
    const opendirSpy = vi
      .spyOn(fs.promises, "opendir")
      .mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
        if (path.resolve(String(p)) === path.resolve(deep)) {
          return Promise.reject(eacces);
        }
        return (realOpendir as (...a: unknown[]) => unknown)(p, ...rest);
      }) as never);

    let result: Awaited<ReturnType<typeof scanService.scanAll>>;
    try {
      result = await scanService.scanAll({ subPaths: [deep] });
    } finally {
      opendirSpy.mockRestore();
    }

    // One bad directory is one notice, however many roots contain it.
    expect(result.skippedSubPaths).toEqual([deep]);
    expect(
      events.filter((e) => e.channel === "image:scanSkipped").map((e) => e.data),
    ).toEqual([{ subPaths: [deep] }]);
  });

  it("reports a subtree that becomes unreadable after targets are resolved", async () => {
    const { scanService, events } = await buildService();
    const { folder, alpha } = await createLibrary();

    await scanService.scanAll({ folderIds: [folder.id] });
    const before = await storedPaths();
    expect(before).toHaveLength(4);

    // Readable when the target is built, unreachable by the time the sync loop
    // gets to it. The scan still succeeds, so without a notice the user watches
    // a spinner run and stop over a subtree nothing happened to.
    const eacces = Object.assign(new Error("EACCES"), { code: "EACCES" });
    const realOpendir = fs.promises.opendir;
    let alphaProbes = 0;
    const opendirSpy = vi
      .spyOn(fs.promises, "opendir")
      .mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
        if (path.resolve(String(p)) === path.resolve(alpha)) {
          alphaProbes += 1;
          if (alphaProbes > 1) return Promise.reject(eacces);
        }
        return (realOpendir as (...a: unknown[]) => unknown)(p, ...rest);
      }) as never);

    let result: Awaited<ReturnType<typeof scanService.scanAll>>;
    try {
      result = await scanService.scanAll({
        folderIds: [folder.id],
        subPaths: [alpha],
      });
    } finally {
      opendirSpy.mockRestore();
    }

    expect(result.cancelled).toBe(false);
    expect(result.skippedSubPaths).toEqual([alpha]);
    expect(
      events.filter((e) => e.channel === "image:scanSkipped").map((e) => e.data),
    ).toEqual([{ subPaths: [alpha] }]);
    // A subtree that was never walked must not lose its rows.
    expect(await storedPaths()).toEqual(before);
  });

  it("skips duplicate detection when the caller asks for none", async () => {
    const { scanService } = await buildService();
    const { folder, alpha } = await createLibrary();
    const groups: unknown[] = [];

    await scanService.scanAll({
      folderIds: [folder.id],
      subPaths: [alpha],
      detectDuplicates: false,
      onDuplicateGroup: (g) => groups.push(g),
    });

    expect(groups).toEqual([]);
    expect(await storedPaths()).toEqual(
      [path.join(alpha, "a1.png"), path.join(alpha, "a2.png")].sort(),
    );
  });

  it.runIf(process.platform === "win32")(
    "keeps one row when a directory is renamed by case alone",
    async () => {
      const { scanService } = await buildService();
      const root = path.join(ctx.userDataDir, "library");
      writePng(path.join(root, "Sub", "a.png"));

      const { getDB } = await import("@core/lib/db");
      const folder = await getDB().folder.create({
        data: { name: "library", path: root },
      });

      await scanService.scanAll({ folderIds: [folder.id] });
      expect(await storedPaths()).toHaveLength(1);

      // A case-only rename needs a temp hop on win32. The walk now reports the
      // file under a spelling its row does not carry, while `stat` still finds
      // the old spelling — so the prune cannot clean up after an insert. The
      // row has to be recognised instead of inserted a second time.
      const tmp = path.join(root, "__tmp__");
      fs.renameSync(path.join(root, "Sub"), tmp);
      fs.renameSync(tmp, path.join(root, "sub"));

      await scanService.scanAll({ folderIds: [folder.id] });

      expect(await storedPaths()).toHaveLength(1);
    },
  );

  it.runIf(process.platform === "win32")(
    "keeps one row when a case-only rename comes with a content change",
    async () => {
      const { scanService } = await buildService();
      const root = path.join(ctx.userDataDir, "library");
      writePng(path.join(root, "Sub", "a.png"));

      const { getDB } = await import("@core/lib/db");
      const folder = await getDB().folder.create({
        data: { name: "library", path: root },
      });

      await scanService.scanAll({ folderIds: [folder.id] });
      expect(await storedPaths()).toHaveLength(1);

      const tmp = path.join(root, "__tmp__");
      fs.renameSync(path.join(root, "Sub"), tmp);
      fs.renameSync(tmp, path.join(root, "sub"));
      // Recognising the row is not enough once the file also changed: the
      // upsert runs, and matching `where: { path }` against the walked
      // spelling would insert a second row that the prune can never reach.
      const changed = path.join(root, "sub", "a.png");
      fs.writeFileSync(changed, "fake-png-bytes-changed");
      const later = new Date(Date.now() + 60_000);
      fs.utimesSync(changed, later, later);

      await scanService.scanAll({ folderIds: [folder.id] });
      expect(await storedPaths()).toHaveLength(1);

      // Still one row on the next pass — a phantom row would survive forever.
      await scanService.scanAll({ folderIds: [folder.id] });
      expect(await storedPaths()).toHaveLength(1);
    },
  );
});
