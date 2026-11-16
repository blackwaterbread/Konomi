import { describe, expect, it } from "vitest";
import {
  accumulateStatMutation,
  buildStatDeltasFromMutations,
  createStatDeltaAccumulator,
  extractTokenTexts,
  getAccumulatedStatDeltas,
} from "@core/lib/search-stats";
import type { SearchStatMutationInput } from "@core/lib/search-stats";
import type { SearchStatSource } from "@core/types/repository";

function source(
  width: number,
  height: number,
  model: string,
  tags: string[],
  negativeTags: string[] = [],
): SearchStatSource {
  const tokens = (texts: string[]) =>
    JSON.stringify(texts.map((text) => ({ text, weight: 1 })));
  return {
    width,
    height,
    model,
    promptTokens: tokens(tags),
    negativePromptTokens: tokens(negativeTags),
    characterPromptTokens: "[]",
  };
}

function accumulateInBatches(
  mutations: SearchStatMutationInput[],
  batchSize: number,
) {
  const accumulator = createStatDeltaAccumulator();
  for (let i = 0; i < mutations.length; i += batchSize) {
    for (const mutation of mutations.slice(i, i + batchSize)) {
      accumulateStatMutation(accumulator, mutation);
    }
  }
  return getAccumulatedStatDeltas(accumulator);
}

describe("search stat delta accumulator", () => {
  it("drops keys whose increments and decrements cancel out", () => {
    const accumulator = createStatDeltaAccumulator();
    accumulateStatMutation(accumulator, {
      before: source(832, 1216, "nai", ["blue hair", "smile"]),
      after: source(832, 1216, "nai", ["smile"]),
    });
    accumulateStatMutation(accumulator, {
      before: null,
      after: source(1024, 1024, "nai", ["blue hair"]),
    });

    expect(getAccumulatedStatDeltas(accumulator)).toEqual([
      {
        kind: "model",
        key: "nai",
        width: null,
        height: null,
        model: "nai",
        delta: 1,
      },
      {
        kind: "resolution",
        key: "1024x1024",
        width: 1024,
        height: 1024,
        model: null,
        delta: 1,
      },
    ]);
  });

  it("gives the same deltas however a folder's mutations are split into batches", () => {
    const tagged = source(832, 1216, "nai", ["1girl", "Blue Hair"]);
    const changedFrom = source(832, 1216, "nai", ["1girl", "blue hair"]);
    const changedTo = source(1024, 1024, "nai", ["1girl"]);
    const rewritten = source(1024, 1024, "sdxl", ["landscape"]);
    const first = source(512, 512, "nai", ["smile"]);
    const second = source(512, 512, "nai", ["smile", "blue hair"]);
    const third = source(512, 512, "nai", ["BLUE HAIR"]);
    const moved = source(832, 1216, "nai", ["1girl"]);
    const mutations: SearchStatMutationInput[] = [
      { before: null, after: tagged }, // new file
      { before: changedFrom, after: changedTo }, // edited file
      { before: rewritten, after: { ...rewritten } }, // new mtime, same tags
      { before: first, after: second }, // one row written twice
      { before: second, after: third },
      { before: source(640, 640, "nai", ["night"]), after: null }, // stale row
      { before: moved, after: { ...moved } }, // row taken from a nested folder
    ];
    // "blue hair" sums to zero after the edit and comes back: it keeps the
    // spelling that first touched it, which a new ImageSearchStat row takes.
    const expected = [
      { kind: "tag", key: "1girl", model: "1girl", delta: 1 },
      { kind: "tag", key: "blue hair", model: "Blue Hair", delta: 1 },
      {
        kind: "resolution",
        key: "1024x1024",
        width: 1024,
        height: 1024,
        delta: 1,
      },
      { kind: "tag", key: "smile", model: "smile", delta: -1 },
      {
        kind: "resolution",
        key: "640x640",
        width: 640,
        height: 640,
        delta: -1,
      },
      { kind: "tag", key: "night", model: "night", delta: -1 },
    ].map((delta) => ({ width: null, height: null, model: null, ...delta }));

    expect(buildStatDeltasFromMutations(mutations)).toEqual(expected);
    for (let batchSize = 1; batchSize <= mutations.length; batchSize++) {
      expect(accumulateInBatches(mutations, batchSize)).toEqual(expected);
    }
  });
});

describe("search stat token texts", () => {
  it("leaves out tags longer than a stat key or spelling can hold", () => {
    const atLimit = "a".repeat(700);
    const tooLong = "b".repeat(701);
    // 400 characters as written, 800 once lower-cased into the key.
    const longOnceLowered = "İ".repeat(400);
    const raw = JSON.stringify([
      { text: `${atLimit}, ${tooLong}`, weight: 1 },
      { text: longOnceLowered, weight: 1 },
      { text: "smile", weight: 1 },
    ]);

    expect(extractTokenTexts(raw)).toEqual([atLimit, "smile"]);
  });
});
