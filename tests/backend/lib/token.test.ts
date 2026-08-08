import { describe, expect, it } from "vitest";
import { parsePromptTokens } from "@core/lib/token";

describe("parsePromptTokens", () => {
  it("parses simple comma-separated tokens and normalizes whitespace", () => {
    expect(parsePromptTokens("  girl  , blue   hair ,  solo ")).toEqual([
      { text: "girl", weight: 1 },
      { text: "blue hair", weight: 1, raw: "blue   hair" },
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
    expect(tokens[1]).toEqual({
      text: "best quality",
      weight: 1.2,
      raw: "1.20::best quality::",
    });
    expect(tokens[2].text).toBe("sparkles");
    expect(tokens[2].weight).toBeCloseTo(1.05, 8);
    expect(tokens[3].text).toBe("glow");
    expect(tokens[3].weight).toBeCloseTo(1.05, 8);
  });

  it("keeps the author's spacing and weight literal in raw", () => {
    expect(parsePromptTokens("2.5::sometag ::")).toEqual([
      { text: "sometag", weight: 2.5, raw: "2.5::sometag ::" },
    ]);
    expect(parsePromptTokens("{ sparkles }")).toEqual([
      { text: "sparkles", weight: 1.05, raw: "{ sparkles }" },
    ]);
  });

  it("omits raw when the token round-trips from text and weight", () => {
    expect(parsePromptTokens("girl, solo")).toEqual([
      { text: "girl", weight: 1 },
      { text: "solo", weight: 1 },
    ]);
  });

  it("omits raw when one source block yields several tokens", () => {
    expect(parsePromptTokens("2.5::a, b ::")).toEqual([
      { text: "a", weight: 2.5 },
      { text: "b", weight: 2.5 },
    ]);

    const nested = parsePromptTokens("{a, b}");
    expect(nested.map((token) => token.raw)).toEqual([undefined, undefined]);
  });
});
