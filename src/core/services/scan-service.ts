import fs from "fs";
import path from "path";
import {
  walkImageFiles,
  countImageFiles,
  withConcurrency,
} from "../lib/scanner";
import { readImageMeta } from "../lib/image-meta";
import { parsePromptTokens } from "../lib/token";
import { createLogger } from "../lib/logger";
import { normalizePathKey } from "../lib/path-key";
import {
  buildDuplicateGroupsFromBuckets,
  buildExistingSizeBuckets,
  buildIncomingSizeBuckets,
  buildSignatureBuckets,
  collectCandidateSizes,
  countEntriesForSizes,
} from "../lib/duplicate-detect";
import type { CancelToken } from "../lib/scanner";
import type { FolderDuplicateGroup, HashFile } from "../lib/duplicate-detect";
import type {
  FolderEntity,
  ImageUpsertData,
  SearchStatMutation,
} from "../types/repository";
import type { ImageRepo } from "../lib/repositories/prisma-image-repo";
import type { FolderRepo } from "../lib/repositories/prisma-folder-repo";
import type { EventSender } from "../types/event-sender";
import type { ImageMeta } from "../types/image-meta";
import type {
  IgnoredDuplicateChecker,
  SearchStatsAdapter,
  SimilarityCacheAdapter,
} from "../types/adapters";

export type {
  FolderDuplicateExistingEntry,
  FolderDuplicateIncomingEntry,
  FolderDuplicateGroup,
  FolderDuplicateGroupResolution,
} from "../lib/duplicate-detect";

const log = createLogger("scan-service");

// ── Constants ──────────────────────────────────────────────────
const BATCH_SIZE = 20;
const SYNC_SCAN_CONCURRENCY = 24;
const SIZE_SCAN_CONCURRENCY = 32;
const STAT_CONCURRENCY = 128;

// ── Types ──────────────────────────────────────────────────────

export type ScanPhase =
  | "loadingLibrary"
  | "scanningFiles"
  | "checkingDuplicates"
  | "syncing";

export type ClassifyResult = {
  newFiles: string[];
  changedFiles: string[];
  /** `normalizePathKey` keys, not walkable paths. */
  discoveredPaths: Set<string>;
  unchangedCount: number;
};

type ProgressCallback = (done: number, total: number) => void;

export type QuickVerifyResult = {
  changedFolderIds: number[];
  unchangedFolderIds: number[];
};

/** One directory subtree to walk. `root` is the folder root unless `partial`. */
type ScanTarget = {
  folder: FolderEntity;
  root: string;
  partial: boolean;
  /**
   * The subtree no longer exists on disk. Nothing is walked; the target only
   * exists so its stale DB rows get pruned.
   */
  missing?: boolean;
};

// ── Deps & options ─────────────────────────────────────────────

export type ScanServiceDeps = {
  imageRepo: ImageRepo;
  folderRepo: FolderRepo;
  sender: EventSender;
  /** Async metadata reader (e.g. backed by a WorkerPool). Falls back to sync readImageMeta. */
  readMeta?: (filePath: string) => Promise<ImageMeta | null>;
  /** SHA-1 file hasher for duplicate detection */
  hashFile?: HashFile;
  /** Search stats subsystem */
  searchStats?: SearchStatsAdapter;
  /** Ignored-duplicate path checker */
  ignoredDuplicates?: IgnoredDuplicateChecker;
  /** Similarity cache cleanup */
  similarityCache?: SimilarityCacheAdapter;
};

export type ScanResult = {
  cancelled: boolean;
  /**
   * Requested `subPaths` the scan did not cover: the directory was unreadable
   * — a permission error or transient IO, not a deletion — or it sits under no
   * resolved folder. The scan otherwise succeeds, so without this the caller
   * reports a clean run over a subtree it never touched.
   *
   * Flattened across both causes on purpose: the distinction only shapes the
   * message a user reads, and that is carried by `image:scanSkipped`'s
   * `reason`. Callers of the return value just need to know what went
   * uncovered.
   */
  skippedSubPaths: string[];
};

export type ScanOptions = {
  signal?: CancelToken;
  folderIds?: number[];
  orderedFolderIds?: number[];
  skipFolderIds?: number[];
  /**
   * Restrict the scan to these directory subtrees instead of whole folder
   * roots. Each path must live under one of the resolved folders; paths that
   * match no folder are ignored.
   */
  subPaths?: string[];
  detectDuplicates?: boolean;
  onDuplicateGroup?: (group: FolderDuplicateGroup) => void;
  onDupCheckProgress?: ProgressCallback;
  onSearchStatsProgress?: ProgressCallback;
  onPhase?: (phase: ScanPhase) => void;
};

// ── Pure helpers ───────────────────────────────────────────────

function isSamePath(a: string, b: string): boolean {
  return normalizePathKey(a) === normalizePathKey(b);
}

function isPathUnder(child: string, root: string): boolean {
  const c = normalizePathKey(child);
  const r = normalizePathKey(root);
  return c === r || c.startsWith(r + "/");
}

/**
 * True only when `p` is confirmed absent (ENOENT). Any other failure — denied
 * permissions, a dropped network share, transient IO — leaves the answer
 * unknown, and an unknown path must never be read as deleted: its rows would
 * be pruned on the strength of a read error.
 */
async function isConfirmedMissing(p: string): Promise<boolean> {
  try {
    await fs.promises.stat(p);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/**
 * Readable enough to walk. Used everywhere a scan decides to skip a root.
 *
 * `fs.access` cannot answer this. Its default mode is `F_OK`, so a directory
 * that exists but cannot be listed passes the check, becomes a scan target,
 * and `walkImageFiles` then swallows the `opendir` failure — a silent success
 * over a subtree nothing ever read, which is precisely the permission case
 * `skippedSubPaths` exists to report. `R_OK` does not close the gap either:
 * libuv only reports the readonly attribute on win32, so ACL-denied
 * directories still pass there. Opening the directory is the only check that
 * asks the same question the walk does.
 */
async function isAccessible(p: string): Promise<boolean> {
  let handle: fs.Dir | null = null;
  try {
    handle = await fs.promises.opendir(p);
    return true;
  } catch {
    return false;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        /* ignore close errors */
      }
    }
  }
}

function buildUpsertData(
  filePath: string,
  folderId: number,
  stat: fs.Stats,
  meta: ImageMeta | null,
): ImageUpsertData {
  return {
    path: filePath,
    folderId,
    prompt: meta?.prompt ?? "",
    negativePrompt: meta?.negativePrompt ?? "",
    characterPrompts: JSON.stringify(meta?.characterPrompts ?? []),
    promptTokens: JSON.stringify(parsePromptTokens(meta?.prompt ?? "")),
    negativePromptTokens: JSON.stringify(
      parsePromptTokens(meta?.negativePrompt ?? ""),
    ),
    characterPromptTokens: JSON.stringify(
      (meta?.characterPrompts ?? []).flatMap(parsePromptTokens),
    ),
    source: meta?.source ?? "unknown",
    model: meta?.model ?? "",
    seed: meta?.seed || "",
    width: meta?.width ?? 0,
    height: meta?.height ?? 0,
    sampler: meta?.sampler ?? "",
    steps: meta?.steps ?? 0,
    cfgScale: meta?.cfgScale ?? 0,
    cfgRescale: meta?.cfgRescale ?? 0,
    noiseSchedule: meta?.noiseSchedule ?? "",
    varietyPlus: meta?.varietyPlus ?? false,
    fileSize: stat.size,
    fileModifiedAt: stat.mtime,
  };
}

/**
 * Classifies one directory subtree against the rows already recorded for it.
 *
 * `existingMap` and the returned `discoveredPaths` are both keyed by
 * `normalizePathKey`. A walked path and the row that recorded it can spell the
 * same file differently — a case-only rename on win32 is enough — and an exact
 * compare would then call that file new: the walk inserts a second row under
 * the new spelling while the old row survives the prune, because `stat` on a
 * case-insensitive filesystem never answers ENOENT for it.
 */
export async function classifyFolderFiles(
  folderPath: string,
  existingMap: Map<string, { fileModifiedAt: Date; source: string }>,
  signal?: CancelToken,
  onUnchanged?: () => void,
): Promise<ClassifyResult> {
  const newFiles: string[] = [];
  const changedFiles: string[] = [];
  const discoveredPaths = new Set<string>();

  await withConcurrency(
    walkImageFiles(folderPath, signal),
    STAT_CONCURRENCY,
    async (filePath) => {
      discoveredPaths.add(normalizePathKey(filePath));
      const existingRow = existingMap.get(normalizePathKey(filePath));
      if (!existingRow) {
        newFiles.push(filePath);
      } else if (existingRow.source === "unknown") {
        changedFiles.push(filePath);
      } else {
        const mtime = await fs.promises
          .stat(filePath)
          .then((s) => s.mtime.getTime())
          .catch(() => existingRow.fileModifiedAt.getTime());
        if (existingRow.fileModifiedAt.getTime() !== mtime) {
          changedFiles.push(filePath);
        } else {
          onUnchanged?.();
        }
      }
    },
    signal,
  );

  return {
    newFiles,
    changedFiles,
    discoveredPaths,
    unchangedCount:
      discoveredPaths.size - newFiles.length - changedFiles.length,
  };
}

// ── Service factory ────────────────────────────────────────────

export function createScanService(deps: ScanServiceDeps) {
  const { imageRepo, folderRepo, sender } = deps;
  const defaultReadMeta = (fp: string) => Promise.resolve(readImageMeta(fp));
  const metaReader = deps.readMeta ?? defaultReadMeta;
  const hashFile = deps.hashFile ?? (() => Promise.resolve(null));

  // ── Folder resolution ─────────────────────────────────────
  function resolveFolders(
    allFolders: FolderEntity[],
    options?: ScanOptions,
  ): FolderEntity[] {
    const requestedIds =
      options?.folderIds && options.folderIds.length > 0
        ? new Set(options.folderIds)
        : null;
    const candidates = requestedIds
      ? allFolders.filter((f) => requestedIds.has(f.id))
      : allFolders;

    // Honour renderer drag order
    const ordered =
      options?.orderedFolderIds && options.orderedFolderIds.length > 0
        ? (() => {
            const folderMap = new Map(candidates.map((f) => [f.id, f]));
            const result = options
              .orderedFolderIds!.map((id) => folderMap.get(id))
              .filter((f): f is FolderEntity => f !== undefined);
            const orderedSet = new Set(options.orderedFolderIds);
            const remaining = candidates.filter((f) => !orderedSet.has(f.id));
            return [...result, ...remaining];
          })()
        : candidates;

    // Skip unchanged folders
    const skipSet =
      options?.skipFolderIds && options.skipFolderIds.length > 0
        ? new Set(options.skipFolderIds)
        : null;
    return skipSet ? ordered.filter((f) => !skipSet.has(f.id)) : ordered;
  }

  /**
   * Expands the resolved folders into the directory subtrees to walk. Without
   * `subPaths` that is one target per folder root; with them, one target per
   * requested subfolder (folders contributing no subfolder are dropped).
   */
  async function resolveScanTargets(
    foldersToScan: FolderEntity[],
    options?: ScanOptions,
  ): Promise<{
    targets: ScanTarget[];
    skippedSubPaths: string[];
    outsideSubPaths: string[];
  }> {
    // `isPathUnder` is a string fold and does not collapse `..`, so a caller
    // could otherwise walk out of the folder while still matching its prefix —
    // `<root>/sub/../../elsewhere` starts with `<root>/sub`. The web server
    // takes `subPaths` straight from a client request, so the containment check
    // has to run on a path that cannot contain traversal segments any more.
    // `path.resolve` also settles separators and any trailing one, which is
    // what lets the renderer key its spinner on the same string.
    //
    // Deduplicated before any of it runs: the `seen` guard below only fires
    // after the accessibility probes, so a repeated path would stat twice and
    // — when unreadable — be reported twice, turning one bad directory into
    // "2 folders" in the notice the user reads.
    const subPaths: string[] = [];
    const requestedKeys = new Set<string>();
    for (const raw of options?.subPaths ?? []) {
      if (raw.trim() === "") continue;
      const resolvedPath = path.resolve(raw);
      const key = normalizePathKey(resolvedPath);
      if (requestedKeys.has(key)) continue;
      requestedKeys.add(key);
      subPaths.push(resolvedPath);
    }
    if (subPaths.length === 0) {
      return {
        targets: foldersToScan.map((folder) => ({
          folder,
          root: folder.path,
          partial: false,
        })),
        skippedSubPaths: [],
        outsideSubPaths: [],
      };
    }

    const targets: ScanTarget[] = [];
    const skippedSubPaths: string[] = [];
    const outsideSubPaths: string[] = [];
    // One target per requested subtree, never one per (folder, subtree) pair.
    // A folder can be registered inside another one, and then a subPath sits
    // under two roots: pairing would walk and sync the same directory twice,
    // leaving `Image.folderId` up to iteration order, and — when the directory
    // is unreadable — report it twice, turning one bad directory into
    // "2 folders" in the notice the user reads. The subtree belongs to the
    // most specific root containing it, which is the folder the sidebar shows
    // it under.
    for (const subPath of subPaths) {
      let owner: FolderEntity | undefined;
      let ownerDepth = -1;
      for (const folder of foldersToScan) {
        if (!isPathUnder(subPath, folder.path)) continue;
        const depth = normalizePathKey(folder.path).length;
        if (depth > ownerDepth) {
          owner = folder;
          ownerDepth = depth;
        }
      }
      // A subPath under no resolved folder scans nothing at all, and without a
      // trace of it the scan just reports success over an empty target list.
      //
      // Reported apart from the unreadable ones: the directory is fine, it is
      // folder resolution that excluded it — the parent folder was removed
      // while the request was in flight, or `folderIds`/`skipFolderIds` left it
      // out. Folding this into `"unreadable"` would send the user hunting a
      // permissions problem on a directory they can read.
      if (!owner) {
        log.info(`ignoring subPath outside every resolved folder: ${subPath}`);
        outsideSubPaths.push(subPath);
        continue;
      }

      // A subtree that is gone still needs a target, otherwise its rows are
      // never pruned and the phantom subfolder lingers in the sidebar. A
      // directory that merely failed to read (permissions, transient IO)
      // must not wipe the subtree, so prune only when it is confirmed gone.
      //
      // ENOENT on the subtree only means "deleted" while the folder root is
      // still reachable. An unmounted share or a moved folder root answers
      // ENOENT for everything beneath it, and pruning on that would wipe a
      // live index — exactly what the full-folder scan refuses to do when
      // its root is inaccessible.
      const reachable = await isAccessible(subPath);
      const missing =
        !reachable &&
        (await isAccessible(owner.path)) &&
        (await isConfirmedMissing(subPath));
      if (!reachable && !missing) {
        log.info(`skipping unreadable scan root: ${subPath}`);
        skippedSubPaths.push(subPath);
        continue;
      }
      targets.push({
        folder: owner,
        root: subPath,
        partial: !isSamePath(subPath, owner.path),
        missing,
      });
    }

    // A requested subtree nested inside another requested subtree would be
    // walked (and pruned) twice; keep only the outermost ones. Not scoped to a
    // folder: with nested roots the outer and inner subtree can be owned by
    // different folders and still be the same directory tree on disk.
    return {
      targets: targets.filter(
        (target) =>
          !targets.some(
            (other) =>
              other !== target &&
              !isSamePath(other.root, target.root) &&
              isPathUnder(target.root, other.root),
          ),
      ),
      skippedSubPaths,
      outsideSubPaths,
    };
  }

  // ── Duplicate pre-scan ────────────────────────────────────
  /**
   * `existingPathSet` holds `normalizePathKey` keys of every indexed row, and
   * the returned `duplicateIncomingPaths` holds them too — `syncFolder` looks
   * a walked file up in it to decide whether to skip the upsert, which is the
   * same "is this the same file?" question every other comparison here folds.
   */
  async function runDuplicatePreScan(
    targets: ScanTarget[],
    signal: CancelToken | undefined,
    existingPathSet: Set<string>,
    onProgress?: ProgressCallback,
    onDuplicateGroup?: (group: FolderDuplicateGroup) => void,
    onDupCheckProgress?: ProgressCallback,
    onPhase?: (phase: ScanPhase) => void,
  ): Promise<{ duplicateIncomingPaths: Set<string>; totalFiles: number }> {
    const duplicateIncomingPaths = new Set<string>();
    let totalFiles = 0;

    onPhase?.("scanningFiles");
    const incomingCandidates: string[] = [];
    let lastProgressAt = 0;

    for (const target of targets) {
      if (signal?.cancelled) break;
      if (target.missing) continue;
      await withConcurrency(
        walkImageFiles(target.root, signal),
        SIZE_SCAN_CONCURRENCY,
        async (incomingPath) => {
          totalFiles++;
          if (existingPathSet.has(normalizePathKey(incomingPath))) return;
          if (deps.ignoredDuplicates) {
            if (await deps.ignoredDuplicates.isIgnored(incomingPath)) return;
          }
          incomingCandidates.push(incomingPath);
        },
        signal,
      );

      const now = Date.now();
      if (now - lastProgressAt >= 100) {
        lastProgressAt = now;
        onProgress?.(0, totalFiles);
      }
    }

    onProgress?.(0, totalFiles);

    if (signal?.cancelled || incomingCandidates.length === 0) {
      return { duplicateIncomingPaths, totalFiles };
    }

    onPhase?.("checkingDuplicates");

    const incomingSizeBuckets = await buildIncomingSizeBuckets(
      incomingCandidates,
      signal,
    );
    if (signal?.cancelled) return { duplicateIncomingPaths, totalFiles };

    const incomingFileSizes = [...incomingSizeBuckets.keys()];

    // Build existing size buckets via repository
    const existingRows = await imageRepo.findByFileSize(incomingFileSizes);
    const existingSizeBuckets = buildExistingSizeBuckets(existingRows);

    const candidateSizes = collectCandidateSizes(
      incomingSizeBuckets,
      existingSizeBuckets,
    );

    if (candidateSizes.length > 0) {
      const dupCheckTotal =
        countEntriesForSizes(existingSizeBuckets, candidateSizes) +
        countEntriesForSizes(incomingSizeBuckets, candidateSizes);
      let dupCheckDone = 0;
      const onItemDone =
        onDupCheckProgress && dupCheckTotal > 0
          ? () => onDupCheckProgress(++dupCheckDone, dupCheckTotal)
          : undefined;

      const existingSignatureBuckets = await buildSignatureBuckets(
        existingSizeBuckets,
        candidateSizes,
        hashFile,
        signal,
        onItemDone,
      );
      if (signal?.cancelled) return { duplicateIncomingPaths, totalFiles };

      const incomingSignatureBuckets = await buildSignatureBuckets(
        incomingSizeBuckets,
        candidateSizes,
        hashFile,
        signal,
        onItemDone,
      );
      if (signal?.cancelled) return { duplicateIncomingPaths, totalFiles };

      const duplicateGroups = buildDuplicateGroupsFromBuckets(
        incomingSignatureBuckets,
        existingSignatureBuckets,
        new Set(incomingCandidates.map(normalizePathKey)),
      );

      for (const group of duplicateGroups) {
        onDuplicateGroup?.(group);
        for (const entry of group.incomingEntries) {
          duplicateIncomingPaths.add(normalizePathKey(entry.path));
        }
      }
    }

    return { duplicateIncomingPaths, totalFiles };
  }

  // ── Per-folder sync ───────────────────────────────────────
  async function syncFolder(
    target: ScanTarget,
    signal: CancelToken | undefined,
    duplicateIncomingPaths: Set<string>,
    progressState: { done: number; total: number; lastProgressAt: number },
    onProgress?: ProgressCallback,
    onSearchStatsProgress?: ProgressCallback,
  ): Promise<number[]> {
    const { folder, root, partial, missing } = target;
    const deletedIds: number[] = [];
    // A partial scan only walks one subtree, so rows outside it must stay out
    // of both the "unchanged" map and the stale-row pruning below. Narrowed in
    // SQL as well, not just here: rescanning a twenty-image subfolder of a
    // folder holding hundreds of thousands would otherwise materialise every
    // one of those rows to discard them a line later, which is most of what
    // scoping the scan to a subtree was meant to avoid. The repo's prefix is a
    // superset of this fold, so the filter still decides containment.
    const folderRows = await imageRepo.findSyncRowsByFolderId(
      folder.id,
      partial ? root : undefined,
    );
    const existing = partial
      ? folderRows.filter((row) => isPathUnder(row.path, root))
      : folderRows;
    // Both keyed by `normalizePathKey`, for the reason `classifyFolderFiles`
    // documents: the walk and the row can spell one file differently.
    const existingMap = new Map(
      existing.map((e) => [normalizePathKey(e.path), e] as const),
    );
    const discoveredPathSet = new Set<string>();

    const pending: ImageUpsertData[] = [];
    const deferredStatMutations: SearchStatMutation[] = [];

    const flushBatch = async (): Promise<void> => {
      if (pending.length === 0) return;
      const batch = pending.splice(0);

      // Collect search stat "before" snapshots
      if (deps.searchStats) {
        const batchPaths = batch.map((row) => row.path);
        const beforeRows =
          await imageRepo.findSearchStatSourcesByPaths(batchPaths);
        const beforeMap = new Map(beforeRows.map((row) => [row.path, row]));
        for (const row of batch) {
          deferredStatMutations.push({
            before: beforeMap.get(row.path) ?? null,
            after: row,
          });
        }
      }

      const images = await imageRepo.upsertBatch(batch);
      const annotated = images.map((img) => ({
        ...img,
        isNew: !existingMap.has(normalizePathKey(img.path)),
      }));
      sender.send("image:batch", annotated);
    };

    const processFile = async (filePath: string): Promise<void> => {
      try {
        if (duplicateIncomingPaths.has(normalizePathKey(filePath))) return;
        if (deps.ignoredDuplicates) {
          if (await deps.ignoredDuplicates.isIgnored(filePath)) return;
        }

        const stat = await fs.promises.stat(filePath);
        const existingRow = existingMap.get(normalizePathKey(filePath));
        if (
          existingRow &&
          existingRow.fileModifiedAt.getTime() === stat.mtime.getTime() &&
          existingRow.source !== "unknown"
        ) {
          return;
        }

        const meta = await metaReader(filePath);
        // Written under the spelling the row already carries, not the one the
        // walk reported. `upsertBatch` matches on `where: { path }` and
        // SQLite's unique index on `path` is binary, so a file reached under
        // different casing than its row would be INSERTed beside it — and the
        // prune cannot clean that up, because both spellings fold to the same
        // discovered key. `findSearchStatSourcesByPaths` looks the row up by
        // exact path too, so the stale spelling also keeps the stat delta
        // honest.
        pending.push(
          buildUpsertData(existingRow?.path ?? filePath, folder.id, stat, meta),
        );
        if (pending.length >= BATCH_SIZE) await flushBatch();
      } catch {
        // skip unreadable files
      } finally {
        progressState.done++;
        const progressNow = Date.now();
        if (progressNow - progressState.lastProgressAt >= 100) {
          progressState.lastProgressAt = progressNow;
          onProgress?.(progressState.done, progressState.total);
        }
      }
    };

    // Phases 1–2 are skipped for a missing subtree: there is nothing to walk,
    // so `discoveredPathSet` stays empty and every row under it is pruned.
    if (!missing) {
      // Phase 1: stat-only classification
      const { newFiles, changedFiles, discoveredPaths } =
        await classifyFolderFiles(root, existingMap, signal, () => {
          progressState.done++;
          const progressNow = Date.now();
          if (progressNow - progressState.lastProgressAt >= 100) {
            progressState.lastProgressAt = progressNow;
            onProgress?.(progressState.done, progressState.total);
          }
        });
      for (const p of discoveredPaths) discoveredPathSet.add(p);

      // Phase 2: metadata extraction for new + changed files
      if (!signal?.cancelled && newFiles.length + changedFiles.length > 0) {
        await withConcurrency(
          [...newFiles, ...changedFiles],
          SYNC_SCAN_CONCURRENCY,
          processFile,
          signal,
        );
      }

      await flushBatch();
    }

    // A cancelled walk stopped partway, so `discoveredPathSet` holds only the
    // files reached before the stop and cannot support a statement about the
    // subtree as a whole. Phase 3 re-verifies each row it is about to delete,
    // but Phase 4 has no such check and a count taken here would understate
    // the folder — and neither has any work worth doing on a cancelled scan.
    const walkCompleted = !signal?.cancelled;

    // Phase 3: prune stale DB rows.
    //
    // Absence from the walk is not proof the file is gone. A cancelled walk
    // stops partway, a narrowed one never looks outside its subtree, and
    // `walkImageFiles` swallows a directory it cannot open — every one of those
    // reads as "missing" while the file sits on disk. Only an ENOENT on the
    // row's own path justifies deleting it, the same rule `resolveScanTargets`
    // applies before pruning a whole subtree.
    const staleRows: (typeof existing)[number][] = [];
    if (walkCompleted) {
      await withConcurrency(
        existing.filter(
          (row) => !discoveredPathSet.has(normalizePathKey(row.path)),
        ),
        STAT_CONCURRENCY,
        async (row) => {
          if (await isConfirmedMissing(row.path)) staleRows.push(row);
        },
        signal,
      );
    }
    if (staleRows.length > 0) {
      for (let i = 0; i < staleRows.length; i += 400) {
        const chunk = staleRows.slice(i, i + 400);
        const chunkIds = chunk.map((row) => row.id);
        deletedIds.push(...chunkIds);

        if (deps.searchStats) {
          const statRows = await imageRepo.findSearchStatSourcesByIds(chunkIds);
          for (const row of statRows) {
            deferredStatMutations.push({ before: row, after: null });
          }
        }

        await imageRepo.deleteByIds(chunkIds);
      }
    }

    // Flush deferred search stat mutations
    if (deps.searchStats && deferredStatMutations.length > 0) {
      await deps.searchStats.applyMutations(
        deferredStatMutations,
        onSearchStatsProgress,
      );
    }

    // Phase 4: update folder scan fingerprint. A partial scan only saw one
    // subtree, so its file count would understate the folder — leave the
    // fingerprint alone.
    if (!partial && walkCompleted) {
      await imageRepo.updateFolderScanMeta(
        folder.id,
        discoveredPathSet.size,
        new Date(),
      );
    }

    return deletedIds;
  }

  // ── Public API ────────────────────────────────────────────
  return {
    buildUpsertData,

    async scanAll(options?: ScanOptions): Promise<ScanResult> {
      const signal = options?.signal;
      const startedAt = Date.now();
      // A group the caller cannot see is a file silently dropped from the
      // upsert, so detection needs both the intent and somewhere to report to.
      const detectDuplicates =
        (options?.detectDuplicates ?? true) &&
        Boolean(options?.onDuplicateGroup);
      const deletedSimilarityIds = new Set<number>();
      let folderCount = 0;
      let success = false;
      let skippedSubPaths: string[] = [];
      const lateSkippedSubPaths: string[] = [];
      const progressState = { done: 0, total: 0, lastProgressAt: 0 };

      log.info(`scanAll start detectDuplicates=${detectDuplicates}`);

      try {
        options?.onPhase?.("loadingLibrary");
        const allFolders = await folderRepo.findAll();
        const foldersToScan = resolveFolders(allFolders, options);
        const resolved = await resolveScanTargets(foldersToScan, options);
        const targets = resolved.targets;
        skippedSubPaths = [
          ...resolved.skippedSubPaths,
          ...resolved.outsideSubPaths,
        ];
        folderCount = targets.length;

        // Emitted before the work starts so the notice survives a cancel: the
        // renderer resolves its scan promise on cancellation without reading
        // the result, and web clients never see the return value at all.
        //
        // One event per reason rather than one merged event: the reason is what
        // the message is built from, so a mixed batch could only be labelled by
        // whichever reason won.
        if (resolved.skippedSubPaths.length > 0) {
          sender.send("image:scanSkipped", {
            subPaths: resolved.skippedSubPaths,
            reason: "unreadable",
          });
        }
        if (resolved.outsideSubPaths.length > 0) {
          sender.send("image:scanSkipped", {
            subPaths: resolved.outsideSubPaths,
            reason: "outside",
          });
        }

        // ── Duplicate pre-scan ──────────────────────────────
        let duplicateIncomingPaths = new Set<string>();
        const preScannedTotals = detectDuplicates;

        if (detectDuplicates && !signal?.cancelled) {
          // Existing paths for the O(1) existence check, loaded per target
          // rather than per folder: a partial target only walks its own
          // subtree, so pulling its folder's whole row set would cost the same
          // full-folder read the sync loop no longer does. Keyed by the query
          // the target implies — with `subPaths` every target is partial, so
          // the same folder can legitimately appear under several roots.
          const allPaths = new Set<string>();
          const seenScopes = new Set<string>();
          for (const { folder, root, partial } of targets) {
            const scope = partial
              ? `${folder.id}:${normalizePathKey(root)}`
              : `${folder.id}:`;
            if (seenScopes.has(scope)) continue;
            seenScopes.add(scope);
            const rows = await imageRepo.findSyncRowsByFolderId(
              folder.id,
              partial ? root : undefined,
            );
            for (const row of rows) {
              if (partial && !isPathUnder(row.path, root)) continue;
              allPaths.add(normalizePathKey(row.path));
            }
          }

          const result = await runDuplicatePreScan(
            targets,
            signal,
            allPaths,
            (done, total) => {
              progressState.total = total;
              sender.send("image:scanProgress", { done, total });
            },
            options?.onDuplicateGroup,
            options?.onDupCheckProgress,
            options?.onPhase,
          );
          duplicateIncomingPaths = result.duplicateIncomingPaths;
          progressState.total = result.totalFiles;
        }

        // ── Count files if no pre-scan ──────────────────────
        options?.onPhase?.("syncing");
        if (!preScannedTotals && !signal?.cancelled) {
          for (const target of targets) {
            if (signal?.cancelled) break;
            if (target.missing) continue;
            progressState.total += await countImageFiles(target.root, signal);
          }
          sender.send("image:scanProgress", {
            done: progressState.done,
            total: progressState.total,
          });
        }

        // ── Per-target sync ─────────────────────────────────
        for (const target of targets) {
          if (signal?.cancelled) break;

          // A `missing` target is deliberately gone — it runs so syncFolder can
          // prune its rows, so the accessibility guard must not skip it.
          if (!target.missing && !(await isAccessible(target.root))) {
            log.info(`skipping inaccessible scan root: ${target.root}`);
            // A root that passed `resolveScanTargets` and then became
            // unreachable is the same silent success the pre-check notice
            // exists to prevent, so it joins the same report. Only for an
            // explicitly requested subtree: a full-folder scan skipping a
            // disconnected drive is routine and must not raise a notice.
            if (target.partial) lateSkippedSubPaths.push(target.root);
            continue;
          }

          const subPath = target.partial ? target.root : undefined;
          sender.send("image:scanFolder", {
            folderId: target.folder.id,
            folderName: target.folder.name,
            subPath,
            active: true,
          });

          try {
            const deleted = await syncFolder(
              target,
              signal,
              duplicateIncomingPaths,
              progressState,
              (done, total) =>
                sender.send("image:scanProgress", { done, total }),
              options?.onSearchStatsProgress,
            );
            for (const id of deleted) deletedSimilarityIds.add(id);
          } finally {
            sender.send("image:scanFolder", {
              folderId: target.folder.id,
              subPath,
              active: false,
            });
          }
        }

        if (lateSkippedSubPaths.length > 0) {
          skippedSubPaths = [...skippedSubPaths, ...lateSkippedSubPaths];
          sender.send("image:scanSkipped", {
            subPaths: lateSkippedSubPaths,
            reason: "unreadable",
          });
        }

        if (signal?.cancelled) return { cancelled: true, skippedSubPaths };

        // Clean up similarity cache for deleted images
        if (deletedSimilarityIds.size > 0 && deps.similarityCache) {
          await deps.similarityCache.deleteForImageIds([
            ...deletedSimilarityIds,
          ]);
        }

        sender.send("image:scanProgress", {
          done: progressState.done,
          total: progressState.total,
        });
        success = true;
        return { cancelled: false, skippedSubPaths };
      } finally {
        const elapsed = Date.now() - startedAt;
        log.info(
          `scanAll end elapsed=${elapsed}ms folders=${folderCount} processed=${progressState.done}/${progressState.total} detectDuplicates=${detectDuplicates} skippedSubPaths=${skippedSubPaths.length} cancelled=${signal?.cancelled === true} success=${success}`,
        );
      }
    },

    async scanOne(folderId: number, signal?: CancelToken): Promise<void> {
      const folder = await folderRepo.findById(folderId);
      if (!folder) throw new Error(`Folder not found: ${folderId}`);

      sender.send("image:scanFolder", {
        folderId: folder.id,
        folderName: folder.name,
        active: true,
      });

      try {
        const progressState = { done: 0, total: 0, lastProgressAt: 0 };
        progressState.total = await countImageFiles(folder.path, signal);
        sender.send("image:scanProgress", {
          done: 0,
          total: progressState.total,
        });

        await syncFolder(
          { folder, root: folder.path, partial: false },
          signal,
          new Set(),
          progressState,
          (done, total) => sender.send("image:scanProgress", { done, total }),
        );
      } finally {
        sender.send("image:scanFolder", { folderId, active: false });
      }
    },

    async quickVerify(
      signal?: CancelToken,
      onProgress?: ProgressCallback,
    ): Promise<QuickVerifyResult> {
      const folders = await folderRepo.findAll();

      // Count total files across all folders for progress
      let total = 0;
      for (const folder of folders) {
        if (signal?.cancelled) break;
        if (!(await isAccessible(folder.path))) continue;
        total += await countImageFiles(folder.path, signal);
      }

      let done = 0;
      let lastProgressAt = 0;
      const changedFolderIds: number[] = [];
      const unchangedFolderIds: number[] = [];

      for (const folder of folders) {
        if (signal?.cancelled) break;
        if (!(await isAccessible(folder.path))) {
          unchangedFolderIds.push(folder.id);
          continue;
        }

        const existing = await imageRepo.findSyncRowsByFolderId(folder.id);
        const existingMap = new Map(
          existing.map(
            (e) =>
              [
                normalizePathKey(e.path),
                { fileModifiedAt: e.fileModifiedAt, source: e.source },
              ] as const,
          ),
        );

        const result = await classifyFolderFiles(
          folder.path,
          existingMap,
          signal,
          () => {
            done++;
            const now = Date.now();
            if (now - lastProgressAt >= 100) {
              lastProgressAt = now;
              onProgress?.(done, total);
            }
          },
        );

        done += result.newFiles.length + result.changedFiles.length;
        onProgress?.(done, total);

        // Same rule as the prune: a row the walk did not reach is only stale
        // once its file answers ENOENT. An unreadable subdirectory otherwise
        // marks the folder changed on every boot, and each of those reports
        // costs a full rescan that cannot fix what a failed readdir hid.
        let hasStaleRows = false;
        await withConcurrency(
          existing.filter(
            (row) => !result.discoveredPaths.has(normalizePathKey(row.path)),
          ),
          STAT_CONCURRENCY,
          async (row) => {
            if (hasStaleRows) return;
            if (await isConfirmedMissing(row.path)) hasStaleRows = true;
          },
          signal,
        );
        const hasChanges =
          result.newFiles.length > 0 ||
          result.changedFiles.length > 0 ||
          hasStaleRows;

        if (hasChanges) {
          changedFolderIds.push(folder.id);
        } else {
          unchangedFolderIds.push(folder.id);
        }
      }

      onProgress?.(done, total);
      log.info(
        `quickVerify: total=${folders.length} changed=${changedFolderIds.length} unchanged=${unchangedFolderIds.length}`,
      );

      return { changedFolderIds, unchangedFolderIds };
    },
  };
}

export type ScanService = ReturnType<typeof createScanService>;
