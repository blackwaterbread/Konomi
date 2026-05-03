import type { PrismaClient, Prisma } from "../../../../generated/prisma/client";
import type {
  ImageEntity,
  ImageSyncRow,
  ImageUpsertData,
  ImageMetadataUpdateEntry,
  SearchStatSource,
} from "@core/types/repository";
import type {
  ImageListQuery,
  ImageListResult,
  ImageSortBy,
  ImageBuiltinCategory,
  ImageQueryResolutionFilter,
  SubfolderFilter,
} from "@core/types/image-query";
import { getDialect } from "@core/lib/db";
import { resolveAccessors, type RepoDbAccessors } from "./db-accessors";

// ---------------------------------------------------------------------------
// Query builder internals
// ---------------------------------------------------------------------------

const IMAGE_LIST_PAGE_SELECT = {
  id: true,
  path: true,
  folderId: true,
  prompt: true,
  negativePrompt: true,
  characterPrompts: true,
  promptTokens: true,
  negativePromptTokens: true,
  characterPromptTokens: true,
  source: true,
  model: true,
  seed: true,
  width: true,
  height: true,
  sampler: true,
  steps: true,
  cfgScale: true,
  cfgRescale: true,
  noiseSchedule: true,
  varietyPlus: true,
  isFavorite: true,
  pHash: true,
  fileSize: true,
  fileModifiedAt: true,
  createdAt: true,
} as const satisfies Prisma.ImageSelect;

const IMAGE_LIST_PAGE_COLUMNS = Object.keys(IMAGE_LIST_PAGE_SELECT)
  .map((c) => `\`${c}\``)
  .join(", ");

type NormalizedQuery = {
  page: number;
  pageSize: number;
  folderIds: number[];
  searchGroups: string[][];
  sortBy: ImageSortBy;
  onlyRecent: boolean;
  recentDays: number;
  customCategoryId: number | null;
  builtinCategory: ImageBuiltinCategory | null;
  randomSeed: number;
  resolutionFilters: ImageQueryResolutionFilter[];
  modelFilters: string[];
  seedFilters: string[];
  excludeTags: string[];
  subfolderFilters: SubfolderFilter[];
};

// ── Normalize helpers ──────────────────────────────────────────

function normalizePositiveInt(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  const integer = Math.floor(value!);
  if (integer < 1) return fallback;
  return Math.min(integer, max);
}

function normalizeIntegerArray(values: number[] | undefined): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.filter((value) => Number.isInteger(value))),
  ) as number[];
}

function normalizeResolutionFilters(
  values: ImageQueryResolutionFilter[] | undefined,
): ImageQueryResolutionFilter[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: ImageQueryResolutionFilter[] = [];
  for (const value of values) {
    const width = Math.floor(value?.width ?? 0);
    const height = Math.floor(value?.height ?? 0);
    if (width < 1 || height < 1) continue;
    const key = `${width}x${height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ width, height });
  }
  return normalized;
}

function normalizeSeedFilters(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const v = String(value ?? "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    normalized.push(v);
  }
  return normalized;
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

const MAX_SEARCH_TERMS = 32;
const MAX_OR_TERMS_PER_GROUP = 16;
const SEARCH_AND_SPLIT_RE = /[,\n\uFF0C]+/;
const SEARCH_OR_SPLIT_RE = /[|\uFF5C]+/;

function normalizeSearchGroups(rawQuery: string): string[][] {
  if (!rawQuery) return [];
  const normalized: string[][] = [];
  const seenGroups = new Set<string>();
  let totalTerms = 0;

  for (const rawGroup of rawQuery.split(SEARCH_AND_SPLIT_RE)) {
    if (totalTerms >= MAX_SEARCH_TERMS) break;
    const seenTerms = new Set<string>();
    const groupTerms: string[] = [];
    for (const rawTerm of rawGroup.split(SEARCH_OR_SPLIT_RE)) {
      if (totalTerms + groupTerms.length >= MAX_SEARCH_TERMS) break;
      if (groupTerms.length >= MAX_OR_TERMS_PER_GROUP) break;
      const term = rawTerm.trim();
      if (!term) continue;
      const variants = [
        ...new Set([term, term.replace(/_/g, " "), term.replace(/ /g, "_")]),
      ];
      for (const variant of variants) {
        if (totalTerms + groupTerms.length >= MAX_SEARCH_TERMS) break;
        const dedupeKey = variant.toLowerCase();
        if (seenTerms.has(dedupeKey)) continue;
        seenTerms.add(dedupeKey);
        groupTerms.push(variant);
      }
    }
    if (groupTerms.length === 0) continue;
    const groupKey = groupTerms.map((t) => t.toLowerCase()).join("\0");
    if (seenGroups.has(groupKey)) continue;
    seenGroups.add(groupKey);
    normalized.push(groupTerms);
    totalTerms += groupTerms.length;
  }
  return normalized;
}

function normalizeQuery(query: ImageListQuery): NormalizedQuery {
  const searchQuery = String(query.searchQuery ?? "").trim();
  const sortBy: ImageSortBy = (() => {
    switch (query.sortBy) {
      case "oldest":
      case "favorites":
      case "name":
        return query.sortBy;
      default:
        return "recent";
    }
  })();
  return {
    page: normalizePositiveInt(query.page, 1, 100000),
    pageSize: normalizePositiveInt(query.pageSize, 50, 200),
    folderIds: normalizeIntegerArray(query.folderIds),
    searchGroups: normalizeSearchGroups(searchQuery),
    sortBy,
    onlyRecent: query.onlyRecent === true,
    recentDays: normalizePositiveInt(query.recentDays, 7, 3650),
    customCategoryId: Number.isInteger(query.customCategoryId)
      ? (query.customCategoryId as number)
      : null,
    builtinCategory:
      query.builtinCategory === "favorites" ||
      query.builtinCategory === "random"
        ? query.builtinCategory
        : null,
    randomSeed: Number.isFinite(query.randomSeed)
      ? Math.floor(query.randomSeed!)
      : 0,
    resolutionFilters: normalizeResolutionFilters(query.resolutionFilters),
    modelFilters: normalizeStringArray(query.modelFilters),
    seedFilters: normalizeSeedFilters(query.seedFilters),
    excludeTags: normalizeStringArray(query.excludeTags),
    subfolderFilters: Array.isArray(query.subfolderFilters)
      ? query.subfolderFilters
          .filter(
            (f) =>
              Number.isInteger(f.folderId) &&
              Array.isArray(f.selectedPaths) &&
              Array.isArray(f.allPaths),
          )
          .map((f) => ({
            folderId: f.folderId,
            selectedPaths: f.selectedPaths,
            allPaths: f.allPaths,
            includeRoot: f.includeRoot !== false,
          }))
      : [],
  };
}

// ── Prisma WHERE builder ───────────────────────────────────────

function buildImageWhereInput(
  query: NormalizedQuery,
): Prisma.ImageWhereInput {
  const andConditions: Prisma.ImageWhereInput[] = [];

  if (query.subfolderFilters.length === 0) {
    andConditions.push({ folderId: { in: query.folderIds } });
  } else {
    const sep = process.platform === "win32" ? "\\" : "/";
    const filteredFolderIds = new Set(
      query.subfolderFilters.map((f) => f.folderId),
    );
    const unfilteredIds = query.folderIds.filter(
      (id) => !filteredFolderIds.has(id),
    );
    const orConditions: Prisma.ImageWhereInput[] = [];
    if (unfilteredIds.length > 0) {
      orConditions.push({ folderId: { in: unfilteredIds } });
    }
    for (const sf of query.subfolderFilters) {
      const pathConditions: Prisma.ImageWhereInput[] = [
        ...sf.selectedPaths.map((p) => ({
          path: { startsWith: p.endsWith(sep) ? p : p + sep },
        })),
        ...(sf.includeRoot && sf.allPaths.length > 0
          ? [
              {
                AND: sf.allPaths.map((p) => ({
                  path: {
                    not: { startsWith: p.endsWith(sep) ? p : p + sep },
                  },
                })),
              },
            ]
          : []),
      ];
      if (pathConditions.length > 0) {
        orConditions.push({
          AND: [{ folderId: sf.folderId }, { OR: pathConditions }],
        });
      }
    }
    andConditions.push({ OR: orConditions });
  }

  if (query.searchGroups.length > 0) {
    for (const terms of query.searchGroups) {
      const orConditions: Prisma.ImageWhereInput[] = [];
      for (const term of terms) {
        orConditions.push(
          { promptTokens: { contains: term } },
          { negativePromptTokens: { contains: term } },
          { characterPromptTokens: { contains: term } },
          { prompt: { contains: term } },
          { negativePrompt: { contains: term } },
          { characterPrompts: { contains: term } },
        );
      }
      andConditions.push({ OR: orConditions });
    }
  }

  if (query.resolutionFilters.length > 0) {
    andConditions.push({
      OR: query.resolutionFilters.map((f) => ({
        width: f.width,
        height: f.height,
      })),
    });
  }
  if (query.modelFilters.length > 0) {
    andConditions.push({ model: { in: query.modelFilters } });
  }
  if (query.seedFilters.length > 0) {
    andConditions.push({ seed: { in: query.seedFilters } });
  }
  for (const tag of query.excludeTags) {
    andConditions.push({
      AND: [
        { promptTokens: { not: { contains: tag } } },
        { negativePromptTokens: { not: { contains: tag } } },
        { characterPromptTokens: { not: { contains: tag } } },
        { prompt: { not: { contains: tag } } },
        { negativePrompt: { not: { contains: tag } } },
        { characterPrompts: { not: { contains: tag } } },
      ],
    });
  }
  if (query.onlyRecent) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - query.recentDays);
    andConditions.push({ fileModifiedAt: { gte: cutoff } });
  }
  if (query.customCategoryId !== null) {
    andConditions.push({
      categories: { some: { categoryId: query.customCategoryId } },
    });
  }
  if (query.builtinCategory === "favorites") {
    andConditions.push({ isFavorite: true });
  }
  return andConditions.length > 0 ? { AND: andConditions } : {};
}

// ── Raw SQL WHERE builder (for random queries) ─────────────────

function sqlLikeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

function buildImageWhereSql(query: NormalizedQuery): {
  sql: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.subfolderFilters.length === 0) {
    conditions.push(`\`folderId\` IN (${placeholders(query.folderIds.length)})`);
    params.push(...query.folderIds);
  } else {
    const sep = process.platform === "win32" ? "\\" : "/";
    const filteredFolderIds = new Set(
      query.subfolderFilters.map((f) => f.folderId),
    );
    const unfilteredIds = query.folderIds.filter(
      (id) => !filteredFolderIds.has(id),
    );
    const orParts: string[] = [];
    if (unfilteredIds.length > 0) {
      orParts.push(`\`folderId\` IN (${placeholders(unfilteredIds.length)})`);
      params.push(...unfilteredIds);
    }
    for (const sf of query.subfolderFilters) {
      const sfParams: unknown[] = [sf.folderId];
      const pathParts: string[] = [];
      for (const p of sf.selectedPaths) {
        const prefix = p.endsWith(sep) ? p : p + sep;
        pathParts.push(`\`path\` LIKE ? ESCAPE '\\'`);
        sfParams.push(sqlLikeEscape(prefix) + "%");
      }
      if (sf.includeRoot && sf.allPaths.length > 0) {
        const notParts = sf.allPaths.map((p) => {
          const prefix = p.endsWith(sep) ? p : p + sep;
          sfParams.push(sqlLikeEscape(prefix) + "%");
          return `\`path\` NOT LIKE ? ESCAPE '\\'`;
        });
        pathParts.push(`(${notParts.join(" AND ")})`);
      }
      if (pathParts.length > 0) {
        orParts.push(`(\`folderId\` = ? AND (${pathParts.join(" OR ")}))`);
        params.push(...sfParams);
      }
    }
    if (orParts.length > 0) {
      conditions.push(`(${orParts.join(" OR ")})`);
    }
  }

  const searchColumns = [
    "`promptTokens`",
    "`negativePromptTokens`",
    "`characterPromptTokens`",
    "`prompt`",
    "`negativePrompt`",
    "`characterPrompts`",
  ];
  for (const terms of query.searchGroups) {
    const orParts: string[] = [];
    for (const term of terms) {
      for (const col of searchColumns) {
        orParts.push(`${col} LIKE ? ESCAPE '\\'`);
        params.push("%" + sqlLikeEscape(term) + "%");
      }
    }
    conditions.push(`(${orParts.join(" OR ")})`);
  }

  if (query.resolutionFilters.length > 0) {
    const orParts = query.resolutionFilters.map((f) => {
      params.push(f.width, f.height);
      return `(\`width\` = ? AND \`height\` = ?)`;
    });
    conditions.push(`(${orParts.join(" OR ")})`);
  }
  if (query.modelFilters.length > 0) {
    conditions.push(`\`model\` IN (${placeholders(query.modelFilters.length)})`);
    params.push(...query.modelFilters);
  }
  if (query.seedFilters.length > 0) {
    conditions.push(`\`seed\` IN (${placeholders(query.seedFilters.length)})`);
    params.push(...query.seedFilters);
  }
  for (const tag of query.excludeTags) {
    const escaped = "%" + sqlLikeEscape(tag) + "%";
    for (const col of searchColumns) {
      conditions.push(`${col} NOT LIKE ? ESCAPE '\\'`);
      params.push(escaped);
    }
  }
  if (query.onlyRecent) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - query.recentDays);
    conditions.push(`\`fileModifiedAt\` >= ?`);
    params.push(cutoff.toISOString());
  }
  if (query.customCategoryId !== null) {
    conditions.push(
      "EXISTS (SELECT 1 FROM `ImageCategory` WHERE `ImageCategory`.`imageId` = `Image`.`id` AND `ImageCategory`.`categoryId` = ?)",
    );
    params.push(query.customCategoryId);
  }
  if (query.builtinCategory === "favorites") {
    conditions.push(`\`isFavorite\` = 1`);
  }
  return {
    sql: conditions.length > 0 ? conditions.join(" AND ") : "1=1",
    params,
  };
}

function buildImageOrderBy(
  sortBy: ImageSortBy,
): Prisma.ImageOrderByWithRelationInput[] {
  switch (sortBy) {
    case "oldest":
      return [{ fileModifiedAt: "asc" }, { id: "asc" }];
    case "favorites":
      return [
        { isFavorite: "desc" },
        { fileModifiedAt: "desc" },
        { id: "desc" },
      ];
    case "name":
      return [{ path: "asc" }, { id: "asc" }];
    case "recent":
    default:
      return [{ fileModifiedAt: "desc" }, { id: "desc" }];
  }
}

type RawImageRow = Omit<ImageEntity, "isFavorite" | "varietyPlus"> & {
  isFavorite: number;
  varietyPlus: number;
};

/** Coerce seed to string — SQLite may still return a number before migration. */
function normalizeSeed(seed: unknown): string {
  if (seed == null || seed === 0) return "";
  return String(seed);
}

function normalizeRawImageRow(raw: RawImageRow): ImageEntity {
  return {
    ...raw,
    seed: normalizeSeed(raw.seed),
    isFavorite: Boolean(raw.isFavorite),
    varietyPlus: Boolean(raw.varietyPlus),
  };
}

function normalizeImageEntity(row: ImageEntity): ImageEntity {
  if (typeof row.seed !== "string") {
    return { ...row, seed: normalizeSeed(row.seed) };
  }
  return row;
}

export type ImageRepo = ReturnType<typeof createPrismaImageRepo>;

export function createPrismaImageRepo(
  arg: (() => PrismaClient) | RepoDbAccessors,
) {
  const { read, write } = resolveAccessors(arg);
  const repo = {
    async findById(id: number): Promise<ImageEntity | null> {
      const row = await read().image.findUnique({ where: { id } }) as ImageEntity | null;
      return row ? normalizeImageEntity(row) : null;
    },

    async findByPath(path: string): Promise<ImageEntity | null> {
      const row = await read().image.findUnique({ where: { path } }) as ImageEntity | null;
      return row ? normalizeImageEntity(row) : null;
    },

    async findSyncRowsByFolderId(folderId: number): Promise<ImageSyncRow[]> {
      return read().image.findMany({
        where: { folderId },
        select: { id: true, path: true, fileModifiedAt: true, source: true },
      });
    },

    async upsertBatch(rows: ImageUpsertData[]): Promise<ImageEntity[]> {
      const db = write();
      // Default Prisma interactive-transaction timeout is 5s, which is tight
      // for slow NAS-hosted MariaDB when the batch hits cold indexes. Use the
      // interactive form so we can extend the timeout to 60s.
      const results = (await db.$transaction(
        async (tx) => {
          const out: unknown[] = [];
          for (const data of rows) {
            out.push(
              await tx.image.upsert({
                where: { path: data.path },
                update: data,
                create: data,
              }),
            );
          }
          return out;
        },
        { timeout: 60_000, maxWait: 10_000 },
      )) as unknown as ImageEntity[];
      return results.map(normalizeImageEntity);
    },

    async upsertByPath(data: ImageUpsertData): Promise<ImageEntity> {
      const row = await write().image.upsert({
        where: { path: data.path },
        update: data,
        create: data,
      }) as unknown as ImageEntity;
      return normalizeImageEntity(row);
    },

    async deleteByIds(ids: number[]): Promise<void> {
      if (ids.length === 0) return;
      await write().image.deleteMany({ where: { id: { in: ids } } });
    },

    async deleteByPath(path: string): Promise<void> {
      await write().image.deleteMany({ where: { path } });
    },

    async setFavorite(id: number, isFavorite: boolean): Promise<void> {
      await write().image.update({ where: { id }, data: { isFavorite } });
    },

    async countByFolderId(folderId: number): Promise<number> {
      return read().image.count({ where: { folderId } });
    },

    async existsByPath(path: string): Promise<boolean> {
      const row = await read().image.findUnique({
        where: { path },
        select: { id: true },
      });
      return row !== null;
    },

    async updateFolderScanMeta(
      folderId: number,
      fileCount: number,
      finishedAt: Date,
    ): Promise<void> {
      await write().folder.update({
        where: { id: folderId },
        data: {
          lastScanFileCount: fileCount,
          lastScanFinishedAt: finishedAt,
        },
      });
    },

    async getPathsByFolderId(
      folderId: number,
    ): Promise<Array<{ id: number; path: string }>> {
      const CHUNK = 5000;
      const result: Array<{ id: number; path: string }> = [];
      let lastId = 0;
      const db = read();
      while (true) {
        const images = await db.image.findMany({
          where: { folderId, id: { gt: lastId } },
          select: { id: true, path: true },
          orderBy: { id: "asc" },
          take: CHUNK,
        });
        if (images.length === 0) break;
        lastId = images[images.length - 1].id;
        result.push(...images);
      }
      return result;
    },

    async sumFileSizeByFolderId(folderId: number): Promise<number> {
      const CHUNK = 5000;
      let totalBytes = 0;
      let lastId = 0;
      const db = read();
      while (true) {
        const images = await db.image.findMany({
          where: { folderId, id: { gt: lastId } },
          select: { id: true, fileSize: true },
          orderBy: { id: "asc" },
          take: CHUNK,
        });
        if (images.length === 0) break;
        lastId = images[images.length - 1].id;
        for (const img of images) {
          if (img.fileSize) totalBytes += img.fileSize;
        }
      }
      return totalBytes;
    },

    async findIdsByPromptContaining(query: string): Promise<number[]> {
      const images = await read().image.findMany({
        where: {
          OR: [
            { prompt: { contains: query } },
            { characterPrompts: { contains: query } },
          ],
        },
        select: { id: true },
      });
      return images.map((img) => img.id);
    },

    async findByFileSize(
      sizes: number[],
    ): Promise<Array<{ id: number; path: string; fileSize: number }>> {
      if (sizes.length === 0) return [];
      const db = read();
      const CHUNK = 500;
      const result: Array<{ id: number; path: string; fileSize: number }> = [];
      for (let i = 0; i < sizes.length; i += CHUNK) {
        const chunk = sizes.slice(i, i + CHUNK);
        const rows = await db.image.findMany({
          where: { fileSize: { in: chunk } },
          select: { id: true, path: true, fileSize: true },
        });
        result.push(...rows);
      }
      return result;
    },

    async findSearchStatSourcesByPaths(
      paths: string[],
    ): Promise<Array<{ path: string } & SearchStatSource>> {
      if (paths.length === 0) return [];
      const rows = await read().image.findMany({
        where: { path: { in: paths } },
        select: {
          path: true,
          width: true,
          height: true,
          model: true,
          promptTokens: true,
          negativePromptTokens: true,
          characterPromptTokens: true,
        },
      });
      return rows as Array<{ path: string } & SearchStatSource>;
    },

    async findSearchStatSourcesByIds(
      ids: number[],
    ): Promise<SearchStatSource[]> {
      if (ids.length === 0) return [];
      const rows = await read().image.findMany({
        where: { id: { in: ids } },
        select: {
          width: true,
          height: true,
          model: true,
          promptTokens: true,
          negativePromptTokens: true,
          characterPromptTokens: true,
        },
      });
      return rows as SearchStatSource[];
    },

    async listPage(query: ImageListQuery): Promise<ImageListResult> {
      const normalized = normalizeQuery(query);
      const offset = (normalized.page - 1) * normalized.pageSize;
      if (normalized.folderIds.length === 0) {
        return {
          rows: [],
          totalCount: 0,
          page: normalized.page,
          pageSize: normalized.pageSize,
          totalPages: 1,
        };
      }

      const db = read();

      if (normalized.builtinCategory === "random") {
        const { sql: whereSql, params } = buildImageWhereSql(normalized);
        const randomFn = getDialect() === "mysql" ? "RAND()" : "RANDOM()";
        const rows = (
          await db.$queryRawUnsafe<RawImageRow[]>(
            `SELECT ${IMAGE_LIST_PAGE_COLUMNS} FROM \`Image\` WHERE ${whereSql} ORDER BY ${randomFn} LIMIT ?`,
            ...params,
            normalized.pageSize,
          )
        ).map(normalizeRawImageRow);
        return {
          rows,
          totalCount: rows.length,
          page: normalized.page,
          pageSize: normalized.pageSize,
          totalPages: 1,
        };
      }

      const where = buildImageWhereInput(normalized);
      const totalCount = await db.image.count({ where });
      const rows = ((await db.image.findMany({
        where,
        select: IMAGE_LIST_PAGE_SELECT,
        orderBy: buildImageOrderBy(normalized.sortBy),
        skip: offset,
        take: normalized.pageSize,
      })) as unknown as ImageEntity[]).map(normalizeImageEntity);
      return {
        rows,
        totalCount,
        page: normalized.page,
        pageSize: normalized.pageSize,
        totalPages: Math.max(1, Math.ceil(totalCount / normalized.pageSize)),
      };
    },

    async listMatchingIds(query: ImageListQuery): Promise<number[]> {
      const normalized = normalizeQuery(query);
      if (normalized.folderIds.length === 0) return [];

      if (normalized.builtinCategory === "random") {
        const pageResult = await repo.listPage(query);
        return pageResult.rows.map((r) => r.id);
      }

      const rows = await read().image.findMany({
        where: buildImageWhereInput(normalized),
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },

    async listByIds(ids: number[]): Promise<ImageEntity[]> {
      const cleanIds = normalizeIntegerArray(ids);
      if (cleanIds.length === 0) return [];
      const rows = ((await read().image.findMany({
        where: { id: { in: cleanIds } },
      })) as unknown as ImageEntity[]).map(normalizeImageEntity);
      const rowMap = new Map(rows.map((row) => [row.id, row]));
      return cleanIds
        .map((id) => rowMap.get(id))
        .filter((row): row is ImageEntity => row !== undefined);
    },

    async listIdsByFolderId(folderId: number): Promise<number[]> {
      const rows = await read().image.findMany({
        where: { folderId },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },

    async findAllIdAndPath(): Promise<Array<{ id: number; path: string }>> {
      return read().image.findMany({
        select: { id: true, path: true },
      });
    },

    async updateMetadataBatch(
      entries: ImageMetadataUpdateEntry[],
    ): Promise<ImageEntity[]> {
      if (entries.length === 0) return [];
      const db = write();
      const results = await db.$transaction(
        async (tx) => {
          const out: unknown[] = [];
          for (const data of entries) {
            out.push(
              await tx.image.update({ where: { path: data.path }, data }),
            );
          }
          return out;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      return (results as unknown as ImageEntity[]).map(normalizeImageEntity);
    },

    async findByFileSizeExcludingPath(
      fileSize: number,
      excludePath: string,
    ): Promise<Array<{ id: number; path: string }>> {
      return read().image.findMany({
        where: { fileSize, NOT: { path: excludePath } },
        select: { id: true, path: true },
      });
    },

    async deleteById(id: number): Promise<boolean> {
      try {
        await write().image.delete({ where: { id } });
        return true;
      } catch {
        return false;
      }
    },

    async findByFolderIdCursor(
      folderId: number,
      afterId: number,
      limit: number,
    ): Promise<Array<{ id: number; path: string } & SearchStatSource>> {
      return read().image.findMany({
        where: { folderId, id: { gt: afterId } },
        select: {
          id: true,
          path: true,
          width: true,
          height: true,
          model: true,
          promptTokens: true,
          negativePromptTokens: true,
          characterPromptTokens: true,
        },
        orderBy: { id: "asc" },
        take: limit,
      });
    },
  };
  return repo;
}
