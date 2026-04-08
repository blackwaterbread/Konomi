/**
 * Benchmark worker — measures each scan pipeline stage individually.
 * Used only by scripts/bench-scan-pipeline.mjs.
 */
import { parentPort } from "worker_threads";
import { statSync } from "fs";
import { readImageMeta } from "./image-meta";
import { parsePromptTokens } from "./token";
import { performance } from "perf_hooks";

parentPort!.on(
  "message",
  ({ id, filePath }: { id: number; filePath: string }) => {
    const timings: Record<string, number> = {};

    let t0 = performance.now();
    const stat = statSync(filePath);
    timings.stat = performance.now() - t0;

    t0 = performance.now();
    const meta = readImageMeta(filePath);
    timings.readAndParse = performance.now() - t0;

    t0 = performance.now();
    if (meta) {
      parsePromptTokens(meta.prompt ?? "");
      parsePromptTokens(meta.negativePrompt ?? "");
      for (const cp of meta.characterPrompts ?? []) parsePromptTokens(cp);
    }
    timings.parseTokens = performance.now() - t0;

    parentPort!.postMessage({
      id,
      timings,
      source: meta?.source ?? "null",
      fileSize: stat.size,
    });
  },
);
