import type { CancelToken } from "../lib/scanner";

/** Cooperative cancellation for the work represented by the header status. */
export function createBackgroundTasks() {
  const tokens = new Set<CancelToken>();
  async function track<T>(
    work: (signal: CancelToken) => Promise<T>,
  ): Promise<T> {
    const signal = { cancelled: false };
    tokens.add(signal);
    try {
      return await work(signal);
    } finally {
      tokens.delete(signal);
    }
  }
  return {
    track,
    isCancelling: () => [...tokens].some((token) => token.cancelled),
    run<T>(work: (signal: CancelToken) => Promise<T>): Promise<T | null> {
      return track(async (signal) => {
        const result = await work(signal);
        return signal.cancelled ? null : result;
      });
    },
    cancel(): void {
      for (const token of tokens) token.cancelled = true;
    },
  };
}
