import { describe, expect, it } from "vitest";
import { parsePromptTokens } from "@core/lib/token";

describe("parsePromptTokens", () => {
  it("parses simple comma-separated tokens and normalizes whitespace", () => {
    expect(parsePromptTokens("  girl  , blue   hair ,  solo ")).toEqual([
      { text: "girl", weight: 1 },
      { text: "blue hair", weight: 1 },
      { text: "solo", weight: 1 },
    ]);
  });

  it("applies nested bracket weighting", () => {
    const tokens = parsePromptTokens("{{sparkles}}, [[blurry]]");

    expect(tokens).toHaveLength(2);
    expect(tokens[0].text).toBe("sparkles");
    expect(tokens[0].weight).toBeCloseTo(1.05 ** 2, 8);
    expect(tokens[1].text).toBe("blurry");
    expect(tokens[1].weight).toBeCloseTo(1.05 ** -2, 8);
  });

  it("keeps explicit weight syntax and nested comma groups intact", () => {
    const tokens = parsePromptTokens(
      "masterpiece, 1.20::best quality::, {sparkles, glow}",
    );

    expect(tokens).toHaveLength(4);
    expect(tokens[0]).toEqual({ text: "masterpiece", weight: 1 });
    expect(tokens[1]).toEqual({ text: "best quality", weight: 1.2 });
    expect(tokens[2].text).toBe("sparkles");
    expect(tokens[2].weight).toBeCloseTo(1.05, 8);
    expect(tokens[3].text).toBe("glow");
    expect(tokens[3].weight).toBeCloseTo(1.05, 8);
  });
});
