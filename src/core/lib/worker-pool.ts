import { Worker } from "worker_threads";

// ---------------------------------------------------------------------------
// Generic worker pool — runs file-processing tasks across worker threads.
//
// Workers receive `{ id, filePath }` messages and must reply with an object
// containing `id` plus an arbitrary result field.  The `extractResult`
// callback pulls the typed result from each reply.
// ---------------------------------------------------------------------------

export type WorkerPoolOptions<T> = {
  /** Maximum number of worker threads */
  size: number;
  /** Absolute path to the worker JS file */
  workerPath: string;
  /**
   * When true, all workers are spawned immediately in the constructor.
   * When false (default), workers are created lazily as tasks arrive.
   */
  eager?: boolean;
  /**
   * If set and > 0, idle workers are terminated after this many ms of
   * inactivity and re-created on the next `run()` call.  Ignored when
   * `eager` is true.
   */
  idleTimeoutMs?: number;
  /** Extract the typed result from the raw worker message object */
  extractResult: (msg: Record<string, unknown>) => T;
};

export class WorkerPool<T> {
  private idle: Worker[] = [];
  private queue: Array<{
    filePath: string;
    resolve: (r: T) => void;
  }> = [];
  private callbacks = new Map<number, (r: T) => void>();
  private workerTask = new Map<Worker, number>();
  private seq = 0;
  private activeCount = 0;

  private readonly maxSize: number;
  private readonly workerPath: string;
  private readonly isEager: boolean;
  private readonly idleTimeoutMs: number;
  private readonly extractResult: (msg: Record<string, unknown>) => T;
  private readonly nullResult: T;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: WorkerPoolOptions<T>) {
    this.maxSize = options.size;
    this.workerPath = options.workerPath;
    this.isEager = options.eager ?? false;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 0;
    this.extractResult = options.extractResult;
    // Pre-compute the "failure" result so error handlers don't need the extractor
    this.nullResult = options.extractResult({});

    if (this.isEager) {
      for (let i = 0; i < this.maxSize; i++) this.addWorker();
    }
  }

  private ensureWorkers(): void {
    const total = this.idle.length + this.activeCount;
    const needed = Math.min(this.maxSize, this.queue.length) - total;
    for (let i = 0; i < needed; i++) this.addWorker();
  }

  private addWorker(): void {
    const w = new Worker(this.workerPath);
    w.on("message", (msg: Record<string, unknown>) => {
      const id = msg.id as number;
      this.activeCount--;
      this.workerTask.delete(w);
      this.callbacks.get(id)?.(this.extractResult(msg));
      this.callbacks.delete(id);
      this.dispatch(w);
    });
    w.on("error", () => {
      this.activeCount--;
      const id = this.workerTask.get(w);
      this.workerTask.delete(w);
      if (id !== undefined) {
        this.callbacks.get(id)?.(this.nullResult);
        this.callbacks.delete(id);
      }
      w.terminate().catch(() => {});
      if (this.queue.length > 0) {
        this.addWorker();
        this.flush();
      }
    });
    this.idle.push(w);
    this.flush();
  }

  private dispatch(w: Worker): void {
    const next = this.queue.shift();
    if (!next) {
      this.idle.push(w);
      this.scheduleIdleShutdown();
      return;
    }
    this.cancelIdleShutdown();
    const id = this.seq++;
    this.callbacks.set(id, next.resolve);
    this.workerTask.set(w, id);
    this.activeCount++;
    w.postMessage({ id, filePath: next.filePath });
  }

  private flush(): void {
    while (this.queue.length > 0 && this.idle.length > 0) {
      this.dispatch(this.idle.shift()!);
    }
  }

  private scheduleIdleShutdown(): void {
    if (this.idleTimeoutMs <= 0) return;
    if (this.activeCount > 0 || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.activeCount > 0) return;
      for (const w of this.idle) w.terminate().catch(() => {});
      this.idle.length = 0;
    }, this.idleTimeoutMs);
  }

  private cancelIdleShutdown(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  run(filePath: string): Promise<T> {
    return new Promise((resolve) => {
      this.queue.push({ filePath, resolve });
      this.cancelIdleShutdown();
      if (this.isEager) {
        this.flush();
      } else {
        this.ensureWorkers();
        this.flush();
      }
    });
  }

  /**
   * Terminate all workers and resolve pending tasks with the null result.
   * Used during process shutdown so worker threads exit cleanly instead of
   * being torn down by the event loop.
   */
  async shutdown(): Promise<void> {
    this.cancelIdleShutdown();
    const queued = this.queue.splice(0);
    for (const task of queued) task.resolve(this.nullResult);
    for (const [, cb] of this.callbacks) cb(this.nullResult);
    this.callbacks.clear();
    const allWorkers = new Set<Worker>(this.idle);
    for (const w of this.workerTask.keys()) allWorkers.add(w);
    this.idle.length = 0;
    this.workerTask.clear();
    this.activeCount = 0;
    await Promise.all(
      Array.from(allWorkers, (w) => w.terminate().catch(() => {})),
    );
  }
}
