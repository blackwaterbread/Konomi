import { describe, expect, it } from "vitest";
import { parsePromptTokens, tokenToRawString } from "@/lib/token";

describe("parsePromptTokens raw fidelity", () => {
  it("keeps the author's spacing and weight literal inside a weight block", () => {
    expect(parsePromptTokens("2.5::sometag ::")).toEqual([
      { text: "sometag", weight: 2.5, raw: "2.5::sometag ::" },
    ]);
    expect(parsePromptTokens("2.50::sometag::")).toEqual([
      { text: "sometag", weight: 2.5, raw: "2.50::sometag::" },
    ]);
  });

  it("omits raw when one weight block yields several tokens", () => {
    expect(parsePromptTokens("2.5::a, b ::")).toEqual([
      { text: "a", weight: 2.5 },
      { text: "b", weight: 2.5 },
    ]);
  });

  it("still parses wildcards and group refs inside a weight block", () => {
    expect(parsePromptTokens("%{a|b}, @{grp}")).toEqual([
      { kind: "wildcard", options: ["a", "b"] },
      { kind: "group", groupName: "grp" },
    ]);
  });
});

describe("tokenToRawString", () => {
  it("round-trips a parsed token back to its source", () => {
    const [token] = parsePromptTokens("2.5::sometag ::");
    expect(tokenToRawString(token)).toBe("2.5::sometag ::");
  });

  it("rebuilds a weight block without padding the decimals", () => {
    expect(tokenToRawString({ text: "sometag", weight: 2.5 })).toBe(
      "2.5::sometag::",
    );
    expect(tokenToRawString({ text: "sometag", weight: 2.05 })).toBe(
      "2.05::sometag::",
    );
    expect(tokenToRawString({ text: "sometag", weight: 1 })).toBe("sometag");
  });
});
