/**
 * Benchmark: scan pipeline stage breakdown
 *
 * Uses bench-scan-worker to measure each stage per file:
 *   1. stat        - fs.statSync
 *   2. readFile    - fs.readFileSync
 *   3. parseMeta   - readImageMetaFromBuffer
 *   4. parseTokens - parsePromptTokens
 *
 * Also compares nai.worker pool throughput at different concurrency levels.
 *
 * Requires build first: bun run build
 *
 * Usage:
 *   node scripts/run-electron-node.mjs scripts/bench-scan-pipeline.mjs <png-dir> [pool-sizes...]
 *
 * Example:
 *   node scripts/run-electron-node.mjs scripts/bench-scan-pipeline.mjs D:/images 1 4 8
 *   (default pool sizes: 1 2 4 8)
 */
import { readdirSync, statSync } from "fs";
import { join, extname, dirname } from "path";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";
import { performance } from "perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "out", "main");
const BENCH_WORKER_PATH = join(OUT_DIR, "bench-scan-worker.js");
const NAI_WORKER_PATH = join(OUT_DIR, "nai.worker.js");

const pngDir = process.argv[2];
const poolSizes = process.argv
  .slice(3)
  .map(Number)
  .filter((n) => n > 0);
if (poolSizes.length === 0) poolSizes.push(1, 2, 4, 8);

if (!pngDir) {
  console.error(
    "Usage: node scripts/run-electron-node.mjs scripts/bench-scan-pipeline.mjs <png-dir> [pool-sizes...]",
  );
  process.exit(1);
}

// -- Collect files (recursive) --------------------------------------------
function walkDir(dir) {
  const results = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (
        entry.isFile() &&
        [".png", ".webp"].includes(extname(entry.name).toLowerCase())
      ) {
        results.push(full);
      }
    }
  }
  return results;
}

const walkT0 = performance.now();
const files = walkDir(pngDir);
const walkMs = performance.now() - walkT0;

if (files.length === 0) {
  console.error("No PNG/WebP files found in", pngDir);
  process.exit(1);
}

const totalSize = files.reduce((sum, f) => sum + statSync(f).size, 0);
const avgSizeMB = (totalSize / files.length / 1024 / 1024).toFixed(2);
const totalSizeMB = (totalSize / 1024 / 1024).toFixed(1);

console.log(`\nDir: ${pngDir}`);
console.log(
  `Files: ${files.length}  Total: ${totalSizeMB} MB  Avg: ${avgSizeMB} MB`,
);
console.log(`Walk: ${walkMs.toFixed(1)} ms\n`);

// -- Per-file stage breakdown (single worker, sequential) -----------------
console.log("--- Per-stage breakdown (sequential, 1 worker) ---\n");
console.log(
  "  stage          |   total ms |  ms/file |  files/s | % of total",
);
console.log(
  "  ---------------+------------+----------+----------+-----------",
);

const results = await runBenchWorker(files);

const stages = ["stat", "readAndParse", "parseTokens"];
const stageTotals = {};
for (const stage of stages) {
  stageTotals[stage] = results.reduce((sum, r) => sum + r.timings[stage], 0);
}
const grandTotal = Object.values(stageTotals).reduce((a, b) => a + b, 0);

for (const stage of stages) {
  const ms = stageTotals[stage];
  const pct = ((ms / grandTotal) * 100).toFixed(1);
  console.log(
    `  ${stage.padEnd(15)} | ${fmt(ms)} | ${fmtPer(ms, files.length)} | ${fmtTps(files.length, ms)} | ${pct.padStart(6)}%`,
  );
}
console.log(
  `  ${"TOTAL".padEnd(15)} | ${fmt(grandTotal)} | ${fmtPer(grandTotal, files.length)} | ${fmtTps(files.length, grandTotal)} | 100.0%`,
);

// -- Source breakdown -----------------------------------------------------
console.log("\n--- Source breakdown ---\n");
const bySource = new Map();
for (const r of results) {
  if (!bySource.has(r.source)) bySource.set(r.source, []);
  bySource.get(r.source).push(r);
}

console.log(
  "  source       | count |  avg size | read+parse |    total |  ms/file",
);
console.log(
  "  -------------+-------+-----------+------------+----------+---------",
);

for (const [source, rows] of [...bySource.entries()].sort(
  (a, b) => b[1].length - a[1].length,
)) {
  const count = rows.length;
  const avgSize = (
    rows.reduce((s, r) => s + r.fileSize, 0) /
    count /
    1024 /
    1024
  ).toFixed(2);
  const readParseMs = rows.reduce((s, r) => s + r.timings.readAndParse, 0);
  const totalMs = rows.reduce(
    (s, r) =>
      s + r.timings.stat + r.timings.readAndParse + r.timings.parseTokens,
    0,
  );
  console.log(
    `  ${source.padEnd(13)} | ${String(count).padStart(5)} | ${(avgSize + " MB").padStart(9)} | ${fmt(readParseMs)} | ${fmt(totalMs)} | ${fmtPer(totalMs, count)}`,
  );
}

// -- Worker pool concurrency comparison -----------------------------------
console.log("\n--- Worker pool throughput (end-to-end) ---\n");
console.log("  workers |   total ms |  ms/file |  files/s");
console.log("  --------+------------+----------+---------");

for (const poolSize of poolSizes) {
  const elapsed = await benchNaiWorkerPool(poolSize, files);
  console.log(
    `  ${String(poolSize).padStart(7)} | ${fmt(elapsed)} | ${fmtPer(elapsed, files.length)} | ${fmtTps(files.length, elapsed)}`,
  );
}

console.log("");
process.exit(0);

// -- Helpers --------------------------------------------------------------
function fmt(ms) {
  return ms.toFixed(1).padStart(10);
}
function fmtPer(totalMs, count) {
  return (totalMs / count).toFixed(2).padStart(8);
}
function fmtTps(count, totalMs) {
  return ((count / totalMs) * 1000).toFixed(1).padStart(8);
}

function runBenchWorker(filePaths) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(BENCH_WORKER_PATH);
    const results = [];
    const queue = [...filePaths];
    let seq = 0;

    function dispatch() {
      const filePath = queue.shift();
      if (!filePath) {
        worker.terminate();
        resolve(results);
        return;
      }
      worker.postMessage({ id: seq++, filePath });
    }

    worker.on("message", (msg) => {
      results.push(msg);
      dispatch();
    });
    worker.on("error", reject);
    dispatch();
  });
}

function benchNaiWorkerPool(size, filePaths) {
  return new Promise((resolve) => {
    const queue = [...filePaths];
    const callbacks = new Map();
    let seq = 0;
    let completed = 0;
    const t0 = performance.now();

    function dispatch(w) {
      const filePath = queue.shift();
      if (!filePath) return;
      const id = seq++;
      callbacks.set(id, () => {
        callbacks.delete(id);
        completed++;
        if (completed === filePaths.length) {
          workers.forEach((w) => w.terminate());
          resolve(performance.now() - t0);
        } else {
          dispatch(w);
        }
      });
      w.postMessage({ id, filePath });
    }

    const workers = Array.from({ length: size }, () => {
      const w = new Worker(NAI_WORKER_PATH);
      w.on("message", ({ id }) => callbacks.get(id)?.());
      w.on("error", () => {
        completed++;
        if (completed === filePaths.length) {
          workers.forEach((w) => w.terminate());
          resolve(performance.now() - t0);
        }
      });
      return w;
    });

    for (const w of workers) dispatch(w);
  });
}
