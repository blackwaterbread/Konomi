import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerPool } from "@core/lib/worker-pool";

// A `worker_threads.Worker` stand-in that never answers on its own: each test
// decides when a worker finishes or fails, so the pool's bookkeeping can be
// checked between events. It also enforces the pool's contract of one task per
// worker at a time — posting to a busy or terminated worker throws.
const fake = vi.hoisted(() => {
  type Listener = (value: unknown) => void;
  type Task = { id: number; filePath: string };

  class FakeWorker {
    static created: FakeWorker[] = [];
    readonly inbox: Task[] = [];
    terminated = false;
    private readonly listeners = new Map<string, Listener[]>();

    constructor() {
      FakeWorker.created.push(this);
    }

    on(event: string, listener: Listener): this {
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
      return this;
    }

    postMessage(task: Task): void {
      if (this.terminated)
        throw new Error("task posted to a terminated worker");
      if (this.inbox.length > 0)
        throw new Error("task posted to a busy worker");
      this.inbox.push(task);
    }

    terminate(): Promise<number> {
      this.terminated = true;
      return Promise.resolve(1);
    }

    get task(): string | undefined {
      return this.inbox[0]?.filePath;
    }

    finish(): void {
      const task = this.inbox.shift();
      if (!task) throw new Error("worker has no task");
      this.emit("message", { id: task.id, result: `done:${task.filePath}` });
    }

    crash(): void {
      this.inbox.length = 0;
      this.emit("error", new Error("worker crashed"));
    }

    private emit(event: string, value: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener(value);
    }
  }

  return { FakeWorker };
});

vi.mock("worker_threads", () => ({ Worker: fake.FakeWorker }));

const workers = () => fake.FakeWorker.created;
const live = () => workers().filter((w) => !w.terminated);
const runningTasks = () =>
  live()
    .map((w) => w.task)
    .filter((t) => t !== undefined);

function createPool(
  size: number,
  options: { eager?: boolean; idleTimeoutMs?: number } = {},
): WorkerPool<string | null> {
  return new WorkerPool<string | null>({
    size,
    workerPath: "fake.worker.js",
    ...options,
    extractResult: (msg) => (msg.result as string | undefined) ?? null,
  });
}

function finishAll(): void {
  while (live().some((w) => w.task !== undefined)) {
    for (const w of live()) if (w.task !== undefined) w.finish();
  }
}

beforeEach(() => {
  fake.FakeWorker.created.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkerPool (lazy)", () => {
  it("never runs more than maxSize workers; queued tasks go to the first worker that frees up", async () => {
    const pool = createPool(2);
    const files = ["1.png", "2.png", "3.png", "4.png", "5.png"];
    const results = files.map((file) => pool.run(file));
    expect(workers()).toHaveLength(2);
    expect(runningTasks()).toEqual(["1.png", "2.png"]);

    workers()[1].finish();
    expect(workers()[1].task).toBe("3.png");

    results.push(pool.run("6.png"));
    expect(workers()).toHaveLength(2);

    finishAll();
    await expect(Promise.all(results)).resolves.toEqual(
      [...files, "6.png"].map((file) => `done:${file}`),
    );
    expect(workers()).toHaveLength(2);
  });

  it("keeps an idle worker for the next task until the idle timeout, then starts a fresh one", async () => {
    vi.useFakeTimers();
    const pool = createPool(4, { idleTimeoutMs: 1000 });
    const first = pool.run("a.png");
    workers()[0].finish();
    await first;

    // A task just before the deadline reuses the worker and cancels the
    // retirement.
    vi.advanceTimersByTime(999);
    const second = pool.run("b.png");
    expect(workers()).toHaveLength(1);
    expect(workers()[0].task).toBe("b.png");
    vi.advanceTimersByTime(5000);
    expect(live()).toHaveLength(1);
    workers()[0].finish();
    await second;

    // Once retired, the worker is gone from the count: later work starts a
    // new one instead of waiting on (or posting to) the terminated worker.
    vi.advanceTimersByTime(1000);
    expect(live()).toHaveLength(0);
    const third = pool.run("c.png");
    expect(workers()).toHaveLength(2);
    expect(workers()[1].task).toBe("c.png");
    workers()[1].finish();
    await expect(third).resolves.toBe("done:c.png");
  });

  it("replaces a worker that fails mid-task without growing past maxSize", async () => {
    const pool = createPool(2);
    const a = pool.run("a.png");
    const b = pool.run("b.png");
    const c = pool.run("c.png");
    expect(workers()).toHaveLength(2);

    workers()[0].crash();
    await expect(a).resolves.toBeNull();
    expect(workers()[0].terminated).toBe(true);
    expect(live()).toHaveLength(2);
    expect(workers()[2].task).toBe("c.png");

    const d = pool.run("d.png");
    expect(live()).toHaveLength(2);
    workers()[1].finish();
    expect(workers()[1].task).toBe("d.png");

    finishAll();
    await expect(Promise.all([b, c, d])).resolves.toEqual([
      "done:b.png",
      "done:c.png",
      "done:d.png",
    ]);
    expect(workers()).toHaveLength(3);
  });
});

describe("WorkerPool (eager)", () => {
  it("keeps its fixed workers and queues work beyond them", async () => {
    const pool = createPool(2, { eager: true });
    expect(workers()).toHaveLength(2);

    const results = ["a.png", "b.png", "c.png"].map((file) => pool.run(file));
    expect(workers()).toHaveLength(2);
    expect(runningTasks()).toEqual(["a.png", "b.png"]);

    workers()[1].finish();
    expect(workers()[1].task).toBe("c.png");

    finishAll();
    await expect(Promise.all(results)).resolves.toEqual([
      "done:a.png",
      "done:b.png",
      "done:c.png",
    ]);
    expect(workers()).toHaveLength(2);
  });
});
