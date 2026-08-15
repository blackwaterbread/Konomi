/**
 * Comparison key for a filesystem path — the backend answer to "is this the
 * same file?".
 *
 * Two paths can name the same file while differing as strings: separators go
 * both ways on win32, a directory may or may not carry a trailing one, and the
 * casing depends on how the path was reached (a case-only rename is enough).
 * Anything deciding file identity must fold all three, because getting it wrong
 * reads as "different file": a row is reported as its own duplicate, an ignored
 * path stops matching, a walked file is inserted beside its own row.
 *
 * Separators and case are folded on win32 only, and for the same reason:
 * elsewhere both carry meaning. `\` is an ordinary filename character on POSIX,
 * so folding it would collapse a directory `a` holding `b.png` onto a file
 * literally named `a\b.png` — and merging two distinct files is the worse
 * failure of the two. The walk would then upsert one onto the other's row,
 * overwriting its metadata, and the second file would never get a row at all.
 * A trailing separator is stripped everywhere; no filesystem lets one end a
 * name.
 *
 * ---------------------------------------------------------------------------
 * The other folds, and why they are not this one
 * ---------------------------------------------------------------------------
 * This split has been reviewed and is the intended design. Each fold answers a
 * different question, so unifying them would be wrong, not tidier. Flag a *new*
 * comparison site that folds incorrectly; do not re-open the split itself.
 *
 * - `main/lib/path-guard` — `realpath`-based. Authorizes protocol reads, where
 *   a string fold is not enough: it cannot see through symlinks or 8.3 short
 *   names, and two strings naming one file must not be allowed to name
 *   different ones.
 * - `services/folder-service.normalizeFolderPath` — `realpath`-based. Answers
 *   "is this folder already registered?", not "is this the same file".
 * - `server/lib/data-root-watcher.normalizeFsPath` — resolve + case, over
 *   DATA_ROOT entries that never reach this module.
 * - `web/hooks/useSubfolderState.subfolderKey` and
 *   `web/hooks/useDuplicateResolutionDialog` — deliberately do **not** fold
 *   case. The renderer cannot know the backend's filesystem; on a self-hosted
 *   server it is a different machine entirely. They do not need to, because
 *   `getSubfolderPaths` reports the on-disk spelling.
 * - `lib/repositories/prisma-image-repo` subfolder prefix filters lean on
 *   SQLite/MariaDB's case-insensitive default collation rather than folding in
 *   JS. Known and accepted; revisit if the collation or engine changes.
 *
 * Rejected on purpose: a branded `PathKey` type forcing this function at every
 * comparison (correct in principle, churn exceeds the defect rate), and
 * unifying the two renderer folds that still lower-case unconditionally
 * (`web/lib/folder-tree.ts`, `web/components/available-folders-dialog.tsx`) —
 * a real inconsistency, but it changes folder-tree nesting behaviour and needs
 * its own change rather than a drive-by.
 */
export function normalizePathKey(p: string): string {
  if (process.platform !== "win32") return p.replace(/\/+$/, "");
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
