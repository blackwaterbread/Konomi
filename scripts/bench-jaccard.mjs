/**
 * Benchmark: native computeAllPairs (C++ inverted index) vs pure-JS O(N²) loop
 *
 * Usage:
 *   node scripts/bench-jaccard.mjs [--n 500] [--seed 42]
 *
 * Options:
 *   --n <num>    Number of synthetic images to generate (default: 500)
 *   --seed <num> RNG seed for reproducible data (default: 1)
 *   --real <db>  Path to a real konomi.db to load images from (optional)
 */

import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// ── Load native addon ─────────────────────────────────────────────────────────

const addonPath = join(root, "prebuilds", `${process.platform}-${process.arch}`, "konomi-image.node");
let native = null;
try {
  native = require(addonPath);
  console.log("Native addon:", addonPath);
} catch (e) {
  console.error("Failed to load native addon:", e.message);
  process.exit(1);
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const N_TARGET = parseInt(getArg("--n", "500"), 10);
const SEED     = parseInt(getArg("--seed", "1"), 10);
const REAL_DB  = getArg("--real", null);

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

function mkRng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const rng = mkRng(SEED);

// ── Synthetic data generation ─────────────────────────────────────────────────
// Mimics NAI/SD prompt structure:
//   - A pool of "common" tokens (high DF, low IDF) like "masterpiece"
//   - A pool of "character" tokens (medium DF)
//   - A pool of "unique" tokens (low DF, high IDF)
//
// Each image draws from each pool with different probabilities.

const COMMON_POOL  = Array.from({ length: 30  }, (_, i) => `common_${i}`);   // df ~80%
const CHAR_POOL    = Array.from({ length: 200 }, (_, i) => `char_${i}`);     // df ~5-20%
const UNIQUE_POOL  = Array.from({ length: 2000 }, (_, i) => `unique_${i}`);  // df ~1-3%
const NEG_POOL     = Array.from({ length: 50  }, (_, i) => `neg_${i}`);      // negative

function pickN(pool, n, r) {
  const result = new Set();
  while (result.size < Math.min(n, pool.length)) {
    result.add(pool[Math.floor(r() * pool.length)]);
  }
  return result;
}

function generateImages(count) {
  return Array.from({ length: count }, (_, i) => {
    const common    = pickN(COMMON_POOL, Math.floor(rng() * 15 + 10), rng);
    const chars     = pickN(CHAR_POOL,  Math.floor(rng() * 4  + 1),  rng);
    const unique    = pickN(UNIQUE_POOL, Math.floor(rng() * 8  + 2), rng);
    const negTokens = pickN(NEG_POOL,   Math.floor(rng() * 5  + 2), rng);

    const prompt   = new Set([...common, ...unique]);
    const character = chars;
    const negative  = negTokens;
    const positive  = new Set([...prompt, ...character]);

    // fake 64-bit pHash: random with occasional matches
    const pHashBig = rng() < 0.1
      ? BigInt(Math.floor(rng() * 0xFFFFFF))   // similar-looking cluster
      : BigInt(Math.floor(rng() * 0xFFFFFFFFFF));
    const pHash = pHashBig.toString(16).padStart(16, "0");

    return { id: i + 1, pHash, prompt, character, negative, positive };
  });
}

// ── IDF computation ───────────────────────────────────────────────────────────

function buildIdfMap(images) {
  const df = new Map();
  for (const img of images) {
    const seen = new Set([...img.prompt, ...img.character, ...img.negative]);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const total = Math.max(images.length, 1);
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log((total + 1) / (d + 1)) + 1);
  return idf;
}

function sumWeights(tokens, idf) {
  let s = 0;
  for (const t of tokens) s += idf.get(t) ?? 1;
  return s;
}

function buildSimilarityImages(images, idf) {
  return images.map(img => ({
    ...img,
    promptWeightSum:    sumWeights(img.prompt, idf),
    characterWeightSum: sumWeights(img.character, idf),
    negativeWeightSum:  sumWeights(img.negative, idf),
    positiveWeightSum:  sumWeights(img.positive, idf),
  }));
}

// ── Pure-JS implementation (from phash.ts) ────────────────────────────────────

const UI_THRESHOLD_MAX  = 16;
const HYBRID_PHASH_W    = 0.72;
const HYBRID_TEXT_W     = 0.28;
const CONFLICT_PENALTY  = 0.25;
const TEXT_LOOSE        = 0.54;
const HYBRID_LOOSE      = 0.66;

const POPCOUNT4 = [0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4];
function hammingDist(a, b) {
  let d = 0;
  for (let i = 0; i < 16; i++) d += POPCOUNT4[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

function weightedIntersection(a, b, idf) {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let s = 0;
  for (const t of small) if (large.has(t)) s += idf.get(t) ?? 1;
  return s;
}

function wJacc(inter, wa, wb) {
  const u = wa + wb - inter;
  return u <= 0 ? 0 : inter / u;
}

function computeTextScore(a, b, idf) {
  const pi = weightedIntersection(a.prompt,   b.prompt,   idf);
  const ci = weightedIntersection(a.character,b.character,idf);
  const xi = weightedIntersection(a.positive, b.positive, idf);

  const hp = a.prompt.size > 0 || b.prompt.size > 0;
  const hc = a.character.size > 0 || b.character.size > 0;
  const pw = hp ? 0.55 : 0, cw = hc ? 0.25 : 0, xw = 1 - pw - cw;
  const base = pw * wJacc(pi, a.promptWeightSum, b.promptWeightSum)
             + cw * wJacc(ci, a.characterWeightSum, b.characterWeightSum)
             + xw * wJacc(xi, a.positiveWeightSum, b.positiveWeightSum);

  const cabI = weightedIntersection(a.positive, b.negative, idf);
  const cbaI = weightedIntersection(b.positive, a.negative, idf);
  const cab = wJacc(cabI, a.positiveWeightSum, b.negativeWeightSum);
  const cba = wJacc(cbaI, b.positiveWeightSum, a.negativeWeightSum);
  const pen = Math.max(cab, cba);

  return Math.min(1, Math.max(0, base - pen * CONFLICT_PENALTY));
}

function shouldPersist(dist, hasPhash, ts) {
  if (hasPhash && dist <= UI_THRESHOLD_MAX) return true;
  if (ts >= TEXT_LOOSE) return true;
  if (!hasPhash) return false;
  return HYBRID_PHASH_W * (1 - dist / 64) + HYBRID_TEXT_W * ts >= HYBRID_LOOSE;
}

function computeAllPairsJS(images, idf) {
  const out = [];
  for (let i = 0; i < images.length - 1; i++) {
    const a = images[i];
    for (let j = i + 1; j < images.length; j++) {
      const b = images[j];
      const hp = a.pHash?.length === 16 && b.pHash?.length === 16;
      const dist = hp ? hammingDist(a.pHash, b.pHash) : -1;
      const ts = computeTextScore(a, b, idf);
      if (shouldPersist(dist, hp, ts))
        out.push({ imageAId: a.id, imageBId: b.id, phashDistance: hp ? dist : null, textScore: ts });
    }
  }
  return out;
}

// ── Encode for native ─────────────────────────────────────────────────────────

function encodeForNative(images, idf) {
  const vocab = new Map();
  for (const t of idf.keys()) vocab.set(t, vocab.size);
  const vsz = vocab.size;
  const N = images.length;

  const imageIds   = new Int32Array(N);
  const pHashHex   = new Array(N);
  const promptWts  = new Float64Array(N);
  const charWts    = new Float64Array(N);
  const negWts     = new Float64Array(N);
  const posWts     = new Float64Array(N);
  const hasPrompt  = new Uint8Array(N);
  const hasChar    = new Uint8Array(N);

  let tp = 0, tc = 0, tn = 0, tx = 0;
  for (const img of images) { tp += img.prompt.size; tc += img.character.size; tn += img.negative.size; tx += img.positive.size; }

  const promptData = new Uint32Array(tp); const promptOffsets = new Int32Array(N + 1);
  const charData   = new Uint32Array(tc); const charOffsets   = new Int32Array(N + 1);
  const negData    = new Uint32Array(tn); const negOffsets    = new Int32Array(N + 1);
  const posData    = new Uint32Array(tx); const posOffsets    = new Int32Array(N + 1);

  let pi = 0, ci = 0, ni = 0, xi = 0;
  for (let i = 0; i < N; i++) {
    const img = images[i];
    imageIds[i]  = img.id;
    pHashHex[i]  = img.pHash?.length === 16 ? img.pHash : "";
    promptWts[i] = img.promptWeightSum;
    charWts[i]   = img.characterWeightSum;
    negWts[i]    = img.negativeWeightSum;
    posWts[i]    = img.positiveWeightSum;
    hasPrompt[i] = img.prompt.size > 0 ? 1 : 0;
    hasChar[i]   = img.character.size > 0 ? 1 : 0;

    promptOffsets[i] = pi;
    for (const t of img.prompt)    { const id = vocab.get(t); if (id !== undefined) promptData[pi++] = id; }
    charOffsets[i] = ci;
    for (const t of img.character) { const id = vocab.get(t); if (id !== undefined) charData[ci++] = id; }
    negOffsets[i] = ni;
    for (const t of img.negative)  { const id = vocab.get(t); if (id !== undefined) negData[ni++] = id; }
    posOffsets[i] = xi;
    for (const t of img.positive)  { const id = vocab.get(t); if (id !== undefined) posData[xi++] = id; }
  }
  promptOffsets[N] = pi; charOffsets[N] = ci; negOffsets[N] = ni; posOffsets[N] = xi;

  const tokenWeights = new Float64Array(vsz);
  for (const [t, w] of idf) { const id = vocab.get(t); if (id !== undefined) tokenWeights[id] = w; }

  return {
    imageIds, pHashHex,
    promptData, promptOffsets, charData, charOffsets,
    negData, negOffsets, posData, posOffsets,
    promptWts, charWts, negWts, posWts,
    hasPrompt, hasChar, tokenWeights,
    uiThresholdMax: UI_THRESHOLD_MAX,
    textThreshold: TEXT_LOOSE,
    hybridThreshold: HYBRID_LOOSE,
    hybridPHashWeight: HYBRID_PHASH_W,
    hybridTextWeight: HYBRID_TEXT_W,
    conflictPenaltyWeight: CONFLICT_PENALTY,
  };
}

// ── Run benchmarks ────────────────────────────────────────────────────────────

function bench(label, fn) {
  fn(); // warmup
  const t0 = performance.now();
  const result = fn();
  const ms = performance.now() - t0;
  return { ms, result };
}

function runForN(n) {
  const images = generateImages(n);
  const idf    = buildIdfMap(images);
  const simImg = buildSimilarityImages(images, idf);

  const jsRes     = bench("js",     () => computeAllPairsJS(simImg, idf));
  const encoded   = encodeForNative(simImg, idf);
  const nativeRes = bench("native", () => native.computeAllPairs(encoded));

  const totalPairs = n * (n - 1) / 2;

  console.log(`\n── N=${n} (${totalPairs.toLocaleString()} total pairs) ─────────────────`);
  console.log(`  pure-JS   ${jsRes.ms.toFixed(1).padStart(8)} ms   →  ${jsRes.result.length.toLocaleString().padStart(6)} pairs persisted`);
  console.log(`  native    ${nativeRes.ms.toFixed(1).padStart(8)} ms   →  ${nativeRes.result.length.toLocaleString().padStart(6)} pairs persisted`);
  console.log(`  speedup   ${(jsRes.ms / nativeRes.ms).toFixed(2)}x`);

  // Correctness: check pair counts roughly match (native skips high-df tokens, so
  // it may find fewer text-only pairs; pHash-only pairs should be identical)
  const jsPhashOnly  = jsRes.result.filter(r => r.phashDistance !== null && r.textScore < TEXT_LOOSE).length;
  const natPhashOnly = nativeRes.result.filter(r => r.phashDistance !== null && r.textScore < TEXT_LOOSE).length;
  console.log(`  pHash-only pairs: JS=${jsPhashOnly}  native=${natPhashOnly}  ${jsPhashOnly === natPhashOnly ? "✓" : "✗ mismatch"}`);
}

const sizes = REAL_DB
  ? [N_TARGET]
  : [100, 300, 500, 1000, N_TARGET].filter((v, i, a) => a.indexOf(v) === i && v > 0).sort((a, b) => a - b);

console.log(`\nBenchmark: native computeAllPairs vs pure-JS`);
console.log(`Platform: ${process.platform}-${process.arch}   Node: ${process.version}`);

for (const n of sizes) runForN(n);

console.log("\nDone.");
