import fs from "fs";
import path from "path";
import { walkImageFiles, countImageFiles, withConcurrency } from "../lib/scanner";
import { readImageMeta } from "../lib/image-meta";
import { parsePromptTokens } from "../lib/token";
import { createLogger } from "../lib/logger";
import type { CancelToken } from "../lib/scanner";
import type {
  FolderEntity,
  ImageUpsertData,
  SearchStatMutation,
} from "../types/repository";
import type { ImageRepo } from "../lib/repositories/prisma-image-repo";
import type { FolderRepo } from "../lib/repositories/prisma-folder-repo";
import type { EventSender } from "../types/event-sender";
import type { ImageMeta } from "../types/image-meta";

const log = createLogger("scan-service");

// ── Constants ──────────────────────────────────────────────────
const BATCH_SIZE = 20;
const SYNC_SCAN_CONCURRENCY = 24;
const SIZE_SCAN_CONCURRENCY = 32;
const HASH_SCAN_CONCURRENCY = 12;
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
  discoveredPaths: Set<string>;
  unchangedCount: number;
};

export type FolderDuplicateExistingEntry = {
  imageId: number;
  path: string;
  fileName: string;
};

export type FolderDuplicateIncomingEntry = {
  path: string;
  fileName: string;
};

export type FolderDuplicateGroup = {
  id: string;
  hash: string;
  previewPath: string;
  previewFileName: string;
  existingEntries: FolderDuplicateExistingEntry[];
  incomingEntries: FolderDuplicateIncomingEntry[];
};

export type FolderDuplicateGroupResolution = {
  id: string;
  hash: string;
  keep: "existing" | "incoming" | "ignore";
  existingEntries: Array<{ imageId: number; path: string }>;
  incomingPaths: string[];
};

type ProgressCallback = (done: number, total: number) => void;

export type QuickVerifyResult = {
  changedFolderIds: number[];
  unchangedFolderIds: number[];
};

// ── Adapter interfaces ─────────────────────────────────────────
// Infrastructure-specific operations that consumers must implement.

export interface SearchStatsAdapter {
  applyMutations(
    mutations: SearchStatMutation[],
    onProgress?: ProgressCallback,
  ): Promise<void>;
}

export interface IgnoredDuplicateAdapter {
  isIgnored(filePath: string): Promise<boolean>;
}

export interface SimilarityCacheAdapter {
  deleteForImageIds(ids: number[]): Promise<void>;
}

// ── Deps & options ─────────────────────────────────────────────

export type ScanServiceDeps = {
  imageRepo: ImageRepo;
  folderRepo: FolderRepo;
  sender: EventSender;
  /** Async metadata reader (e.g. backed by a WorkerPool). Falls back to sync readImageMeta. */
  readMeta?: (filePath: string) => Promise<ImageMeta | null>;
  /** SHA-1 file hasher for duplicate detection */
  hashFile?: (filePath: string) => Promise<string | null>;
  /** Search stats subsystem */
  searchStats?: SearchStatsAdapter;
  /** Ignored-duplicate path checker */
  ignoredDuplicates?: IgnoredDuplicateAdapter;
  /** Similarity cache cleanup */
  similarityCache?: SimilarityCacheAdapter;
};

export type ScanOptions = {
  signal?: CancelToken;
  folderIds?: number[];
  orderedFolderIds?: number[];
  skipFolderIds?: number[];
  detectDuplicates?: boolean;
  onDuplicateGroup?: (group: FolderDuplicateGroup) => void;
  onDupCheckProgress?: ProgressCallback;
  onSearchStatsProgress?: ProgressCallback;
  onPhase?: (phase: ScanPhase) => void;
};

// ── Pure helpers ───────────────────────────────────────────────

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

async function fileSize(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

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
      discoveredPaths.add(filePath);
      const existingRow = existingMap.get(filePath);
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
    unchangedCount: discoveredPaths.size - newFiles.length - changedFiles.length,
  };
}

// ── Duplicate detection helpers ────────────────────────────────

type ExistingSizeBuckets = Map<number, FolderDuplicateExistingEntry[]>;
type IncomingSizeBuckets = Map<number, FolderDuplicateIncomingEntry[]>;

async function buildIncomingSizeBuckets(
  incomingPaths: string[],
  signal?: CancelToken,
): Promise<IncomingSizeBuckets> {
  const buckets: IncomingSizeBuckets = new Map();
  await withConcurrency(
    incomingPaths,
    SIZE_SCAN_CONCURRENCY,
    async (incomingPath) => {
      const size = await fileSize(incomingPath);
      if (size === null) return;
      const bucket = buckets.get(size) ?? [];
      bucket.push({
        path: incomingPath,
        fileName: path.basename(incomingPath),
      });
      buckets.set(size, bucket);
    },
    signal,
  );
  return buckets;
}

function collectCandidateSizes(
  incomingSizeBuckets: IncomingSizeBuckets,
  existingSizeBuckets: ExistingSizeBuckets,
): number[] {
  const sizes: number[] = [];
  for (const [size, incomingEntries] of incomingSizeBuckets.entries()) {
    const existingEntries = existingSizeBuckets.get(size) ?? [];
    if (incomingEntries.length > 1 || existingEntries.length > 0) {
      sizes.push(size);
    }
  }
  return sizes;
}

async function buildSignatureBuckets<
  T extends { path: string },
>(
  sizeBuckets: Map<number, T[]>,
  candidateSizes: number[],
  hashFile: (filePath: string) => Promise<string | null>,
  signal?: CancelToken,
  onItemDone?: () => void,
): Promise<Map<string, T[]>> {
  const buckets = new Map<string, T[]>();
  const targets = candidateSizes.flatMap((size) =>
    (sizeBuckets.get(size) ?? []).map((entry) => ({ size, entry })),
  );
  await withConcurrency(
    targets,
    HASH_SCAN_CONCURRENCY,
    async ({ size, entry }) => {
      const hash = await hashFile(entry.path);
      onItemDone?.();
      if (!hash) return;
      const signature = `${size}:${hash}`;
      const bucket = buckets.get(signature) ?? [];
      bucket.push(entry);
      buckets.set(signature, bucket);
    },
    signal,
  );
  return buckets;
}

function buildDuplicateGroupsFromBuckets(
  incomingBuckets: Map<string, FolderDuplicateIncomingEntry[]>,
  existingBuckets: Map<string, FolderDuplicateExistingEntry[]>,
  incomingPathSet: Set<string>,
): FolderDuplicateGroup[] {
  const groups: FolderDuplicateGroup[] = [];
  for (const [signature, incomingEntries] of incomingBuckets.entries()) {
    const existingEntries = (existingBuckets.get(signature) ?? []).filter(
      (entry) => !incomingPathSet.has(entry.path),
    );
    const hasCrossDuplicate =
      existingEntries.length > 0 && incomingEntries.length > 0;
    const hasIncomingOnlyDuplicate = incomingEntries.length > 1;
    if (!hasCrossDuplicate && !hasIncomingOnlyDuplicate) continue;

    const hash = signature.split(":")[1] ?? signature;
    const previewEntry = existingEntries[0] ?? incomingEntries[0];
    if (!previewEntry) continue;

    groups.push({
      id: signature,
      hash,
      previewPath: previewEntry.path,
      previewFileName: previewEntry.fileName,
      existingEntries,
      incomingEntries,
    });
  }
  return groups;
}

// ── Service factory ────────────────────────────────────────────

export function createScanService(deps: ScanServiceDeps) {
  const { imageRepo, folderRepo, sender } = deps;
  const defaultReadMeta = (fp: string) =>
    Promise.resolve(readImageMeta(fp));
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
            const remaining = candidates.filter(
              (f) => !orderedSet.has(f.id),
            );
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

  // ── Duplicate pre-scan ────────────────────────────────────
  async function runDuplicatePreScan(
    foldersToScan: FolderEntity[],
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

    for (const folder of foldersToScan) {
      if (signal?.cancelled) break;
      await withConcurrency(
        walkImageFiles(folder.path, signal),
        SIZE_SCAN_CONCURRENCY,
        async (incomingPath) => {
          totalFiles++;
          if (existingPathSet.has(incomingPath)) return;
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
    const existingSizeBuckets: ExistingSizeBuckets = new Map();
    const existingRows = await imageRepo.findByFileSize(incomingFileSizes);
    for (const row of existingRows) {
      const bucket = existingSizeBuckets.get(row.fileSize) ?? [];
      bucket.push({
        imageId: row.id,
        path: row.path,
        fileName: path.basename(row.path),
      });
      existingSizeBuckets.set(row.fileSize, bucket);
    }

    const candidateSizes = collectCandidateSizes(
      incomingSizeBuckets,
      existingSizeBuckets,
    );

    if (candidateSizes.length > 0) {
      const existingTargetCount = candidateSizes.reduce(
        (sum, size) => sum + (existingSizeBuckets.get(size)?.length ?? 0),
        0,
      );
      const incomingTargetCount = candidateSizes.reduce(
        (sum, size) => sum + (incomingSizeBuckets.get(size)?.length ?? 0),
        0,
      );
      const dupCheckTotal = existingTargetCount + incomingTargetCount;
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
        new Set(incomingCandidates),
      );

      for (const group of duplicateGroups) {
        onDuplicateGroup?.(group);
        for (const entry of group.incomingEntries) {
          duplicateIncomingPaths.add(entry.path);
        }
      }
    }

    return { duplicateIncomingPaths, totalFiles };
  }

  // ── Per-folder sync ───────────────────────────────────────
  async function syncFolder(
    folder: FolderEntity,
    signal: CancelToken | undefined,
    duplicateIncomingPaths: Set<string>,
    progressState: { done: number; total: number; lastProgressAt: number },
    onProgress?: ProgressCallback,
    onSearchStatsProgress?: ProgressCallback,
  ): Promise<number[]> {
    const deletedIds: number[] = [];
    const existing = await imageRepo.findSyncRowsByFolderId(folder.id);
    const existingMap = new Map(existing.map((e) => [e.path, e] as const));
    const discoveredPathSet = new Set<string>();

    const pending: ImageUpsertData[] = [];
    const deferredStatMutations: SearchStatMutation[] = [];

    const flushBatch = async (): Promise<void> => {
      if (pending.length === 0) return;
      const batch = pending.splice(0);

      // Collect search stat "before" snapshots
      if (deps.searchStats) {
        const batchPaths = batch.map((row) => row.path);
        const beforeRows = await imageRepo.findSearchStatSourcesByPaths(batchPaths);
        const beforeMap = new Map(beforeRows.map((row) => [row.path, row]));
        for (const row of batch) {
          deferredStatMutations.push({
            before: beforeMap.get(row.path) ?? null,
            after: row,
          });
        }
      }

      const images = await imageRepo.upsertBatch(batch);
      sender.send("image:batch", images);
    };

    const processFile = async (filePath: string): Promise<void> => {
      try {
        if (duplicateIncomingPaths.has(filePath)) return;
        if (deps.ignoredDuplicates) {
          if (await deps.ignoredDuplicates.isIgnored(filePath)) return;
        }

        const stat = await fs.promises.stat(filePath);
        const existingRow = existingMap.get(filePath);
        if (
          existingRow &&
          existingRow.fileModifiedAt.getTime() === stat.mtime.getTime() &&
          existingRow.source !== "unknown"
        ) {
          return;
        }

        const meta = await metaReader(filePath);
        pending.push(buildUpsertData(filePath, folder.id, stat, meta));
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

    // Phase 1: stat-only classification
    const { newFiles, changedFiles, discoveredPaths } =
      await classifyFolderFiles(folder.path, existingMap, signal, () => {
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

    // Phase 3: prune stale DB rows
    const staleRows = existing.filter(
      (row) => !discoveredPathSet.has(row.path),
    );
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

    // Update folder scan fingerprint
    await imageRepo.updateFolderScanMeta(
      folder.id,
      discoveredPathSet.size,
      new Date(),
    );

    return deletedIds;
  }

  // ── Public API ────────────────────────────────────────────
  return {
    buildUpsertData,

    async scanAll(options?: ScanOptions): Promise<void> {
      const signal = options?.signal;
      const startedAt = Date.now();
      const detectDuplicates = Boolean(options?.onDuplicateGroup);
      const deletedSimilarityIds = new Set<number>();
      let folderCount = 0;
      let success = false;
      const progressState = { done: 0, total: 0, lastProgressAt: 0 };

      log.info(`scanAll start detectDuplicates=${detectDuplicates}`);

      try {
        options?.onPhase?.("loadingLibrary");
        const allFolders = await folderRepo.findAll();
        const foldersToScan = resolveFolders(allFolders, options);
        folderCount = foldersToScan.length;

        // ── Duplicate pre-scan ──────────────────────────────
        let duplicateIncomingPaths = new Set<string>();
        const preScannedTotals = detectDuplicates;

        if (detectDuplicates && !signal?.cancelled) {
          // Load all existing paths for O(1) existence check
          const allPaths = new Set<string>();
          for (const folder of foldersToScan) {
            const rows = await imageRepo.findSyncRowsByFolderId(folder.id);
            for (const row of rows) allPaths.add(row.path);
          }

          const result = await runDuplicatePreScan(
            foldersToScan,
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
          for (const folder of foldersToScan) {
            if (signal?.cancelled) break;
            progressState.total += await countImageFiles(folder.path, signal);
          }
          sender.send("image:scanProgress", {
            done: progressState.done,
            total: progressState.total,
          });
        }

        // ── Per-folder sync ─────────────────────────────────
        for (const folder of foldersToScan) {
          if (signal?.cancelled) break;

          try {
            await fs.promises.access(folder.path);
          } catch {
            log.info(`skipping inaccessible folder: ${folder.path}`);
            continue;
          }

          sender.send("image:scanFolder", {
            folderId: folder.id,
            folderName: folder.name,
            active: true,
          });

          try {
            const deleted = await syncFolder(
              folder,
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
              folderId: folder.id,
              active: false,
            });
          }
        }

        if (signal?.cancelled) return;

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
      } finally {
        const elapsed = Date.now() - startedAt;
        log.info(
          `scanAll end elapsed=${elapsed}ms folders=${folderCount} processed=${progressState.done}/${progressState.total} detectDuplicates=${detectDuplicates} cancelled=${signal?.cancelled === true} success=${success}`,
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
          folder,
          signal,
          new Set(),
          progressState,
          (done, total) =>
            sender.send("image:scanProgress", { done, total }),
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
        try {
          await fs.promises.access(folder.path);
          total += await countImageFiles(folder.path, signal);
        } catch {
          // inaccessible
        }
      }

      let done = 0;
      let lastProgressAt = 0;
      const changedFolderIds: number[] = [];
      const unchangedFolderIds: number[] = [];

      for (const folder of folders) {
        if (signal?.cancelled) break;
        try {
          await fs.promises.access(folder.path);
        } catch {
          unchangedFolderIds.push(folder.id);
          continue;
        }

        const existing = await imageRepo.findSyncRowsByFolderId(folder.id);
        const existingMap = new Map(
          existing.map(
            (e) => [e.path, { fileModifiedAt: e.fileModifiedAt, source: e.source }] as const,
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

        const hasStaleRows = existing.some(
          (row) => !result.discoveredPaths.has(row.path),
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
