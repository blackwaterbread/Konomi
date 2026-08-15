// ---------------------------------------------------------------------------
// Adapter interfaces — infrastructure-specific operations services depend on
// ---------------------------------------------------------------------------
// Declared once here rather than per service: scan-service, duplicate-service
// and image-service all need the same capabilities, and separate declarations
// of one name drift. `IgnoredDuplicateAdapter` already had: two services
// exported that name with different member sets, and the barrel could only
// re-export one of them.

import type { SearchStatMutation } from "./repository";

export interface SearchStatsAdapter {
  applyMutations(
    mutations: SearchStatMutation[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void>;
}

export interface SimilarityCacheAdapter {
  deleteForImageIds(ids: number[]): Promise<void>;
}

/** The read-only half of {@link IgnoredDuplicateAdapter}, all a scan needs. */
export interface IgnoredDuplicateChecker {
  isIgnored(filePath: string): Promise<boolean>;
}

export interface IgnoredDuplicateAdapter extends IgnoredDuplicateChecker {
  ensureLoaded(): Promise<void>;
  register(paths: string[]): Promise<void>;
  forget(filePath: string): Promise<void>;
  list(): Promise<string[]>;
  clear(): Promise<number>;
}
