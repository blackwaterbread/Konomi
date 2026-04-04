export interface AnnouncementAction {
  id: string;
  labelKey: string;
  descriptionKey: string;
}

export interface Announcement {
  id: string;
  titleKey: string;
  bodyKey: string;
  /** Version that fixed this issue — first-run users on this version+ auto-skip. null = always show */
  fixedInVersion: string | null;
  actions?: AnnouncementAction[];
}

export type AnnouncementActionHandler = (
  actionId: string,
) => Promise<unknown> | void;

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "v0.6.0-similarity-fix",
    titleKey: "announcement.v060SimilarityFix.title",
    bodyKey: "announcement.v060SimilarityFix.body",
    fixedInVersion: "0.6.0",
  },
  {
    id: "v0.9.0-metadata-webp",
    titleKey: "announcement.v090Upgrade.title",
    bodyKey: "announcement.v090Upgrade.body",
    fixedInVersion: "0.9.0",
    actions: [
      {
        id: "rescanMetadata",
        labelKey: "announcement.v090Upgrade.rescanAction",
        descriptionKey: "announcement.v090Upgrade.rescanDescription",
      },
      {
        id: "resetHashes",
        labelKey: "announcement.v090Upgrade.hashResetAction",
        descriptionKey: "announcement.v090Upgrade.hashResetDescription",
      },
    ],
  },
];

export function getAnnouncementStorageKey(id: string): string {
  return `konomi-announcement-${id}`;
}

/** Simple semver compare: returns -1 | 0 | 1 */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function getLatestUnacknowledged(): Announcement | null {
  const isFirstRun = localStorage.getItem("konomi-tour-completed") !== "true";

  // First-run users on fixedInVersion+ are unaffected — auto-acknowledge
  if (isFirstRun) {
    const appVersion = __APP_VERSION__;
    for (const a of ANNOUNCEMENTS) {
      if (
        a.fixedInVersion &&
        compareSemver(appVersion, a.fixedInVersion) >= 0
      ) {
        try {
          localStorage.setItem(getAnnouncementStorageKey(a.id), "true");
        } catch {
          /* ignore */
        }
      }
    }
    return null;
  }

  for (let i = ANNOUNCEMENTS.length - 1; i >= 0; i--) {
    const a = ANNOUNCEMENTS[i];
    if (localStorage.getItem(getAnnouncementStorageKey(a.id)) !== "true") {
      return a;
    }
  }
  return null;
}

export function resetAnnouncement(id: string): void {
  localStorage.removeItem(getAnnouncementStorageKey(id));
}
