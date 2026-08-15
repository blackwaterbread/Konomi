/**
 * Comparison key for a filesystem path.
 *
 * Two paths can name the same file while differing as strings: separators go
 * both ways on win32, a directory may or may not carry a trailing one, and the
 * casing depends on how the path was reached — sidebar subfolder paths are
 * lower-cased (see `folder-service.getSubfolderPaths`) while a directory walk
 * reports the on-disk casing. Anything that decides "is this the same file?"
 * must fold all three, because getting it wrong reads as "different file":
 * a row is reported as its own duplicate, or an ignored path stops matching.
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
 * This is a string fold, not a filesystem lookup: it cannot see through
 * symlinks or 8.3 short names. `main/lib/path-guard` therefore keeps its own
 * `realpath`-based fold — it authorizes protocol reads, where two strings
 * naming one file must not be allowed to name different ones.
 */
export function normalizePathKey(p: string): string {
  if (process.platform !== "win32") return p.replace(/\/+$/, "");
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
