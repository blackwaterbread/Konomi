import type { PrismaClient } from "../../../../generated/prisma/client";

/**
 * Read/write split for repository DB access. Writer holds the single
 * mutating connection; reader is an independent connection that can serve
 * read-only queries in parallel with writer transactions (WAL mode only).
 *
 * For single-DB callers (tests, MariaDB-backed konomi-server) the same
 * client is fine for both — see `resolveAccessors`.
 */
export type RepoDbAccessors = {
  read: () => PrismaClient;
  write: () => PrismaClient;
};

/**
 * Accept either a single accessor (legacy / MariaDB) or a {read, write}
 * pair. The single-fn form expands into both slots so existing callers
 * (tests, konomi-server) keep working unchanged.
 */
export function resolveAccessors(
  arg: (() => PrismaClient) | RepoDbAccessors,
): RepoDbAccessors {
  if (typeof arg === "function") return { read: arg, write: arg };
  return arg;
}
