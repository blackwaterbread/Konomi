import {
  isGroupRef,
  isWildcard,
  parseRawToken,
  splitPromptPartsWithRanges,
} from "@/lib/token";

export type PromptEmphasisSyntaxIssueKind =
  | "invalidExplicitWeight"
  | "invalidBracketEmphasis";

export type PromptEmphasisSyntaxIssue = {
  kind: PromptEmphasisSyntaxIssueKind;
  start: number;
  end: number;
  raw: string;
  anchorText: string;
};

export type PromptEmphasisHighlightRange =
  | {
      start: number;
      end: number;
      kind: "weight";
      weight: number;
    }
  | {
      start: number;
      end: number;
      kind: "group";
    };

const EXPLICIT_WEIGHT_PREFIX_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)::/;

function countOccurrences(source: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= source.length - needle.length) {
    const nextIndex = source.indexOf(needle, cursor);
    if (nextIndex === -1) break;
    count += 1;
    cursor = nextIndex + needle.length;
  }
  return count;
}

function hasInvalidBracketEmphasis(raw: string): boolean {
  const stack: string[] = [];

  for (const char of raw) {
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}") {
      if (stack.pop() !== "{") {
        return true;
      }
      continue;
    }

    if (char === "]") {
      if (stack.pop() !== "[") {
        return true;
      }
    }
  }

  return stack.length > 0;
}

function hasVisibleWeight(weight: number): boolean {
  return Math.abs(weight - 1.0) > 0.001;
}

export function getPromptEmphasisSyntaxIssueKind(
  rawToken: string,
): PromptEmphasisSyntaxIssueKind | null {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("@{") || trimmed.startsWith("%{")) {
    return null;
  }

  const explicitPrefixMatch = trimmed.match(EXPLICIT_WEIGHT_PREFIX_RE);
  let bracketValidationTarget = trimmed;

  if (explicitPrefixMatch) {
    const prefix = explicitPrefixMatch[0];
    const explicitDelimiterCount = countOccurrences(trimmed, "::");
    if (
      !trimmed.endsWith("::") ||
      explicitDelimiterCount !== 2 ||
      trimmed.length <= prefix.length + 2
    ) {
      return "invalidExplicitWeight";
    }
    bracketValidationTarget = trimmed.slice(prefix.length, -2);
  } else if (trimmed.includes("::")) {
    return "invalidExplicitWeight";
  }

  if (hasInvalidBracketEmphasis(bracketValidationTarget)) {
    return "invalidBracketEmphasis";
  }

  return null;
}

function getExplicitWeightPrefix(rawToken: string): string | null {
  return rawToken.match(EXPLICIT_WEIGHT_PREFIX_RE)?.[0] ?? null;
}

function isLikelyExplicitClosingDelimiter(
  source: string,
  start: number,
): boolean {
  let cursor = start;
  while (cursor < source.length && /\s/.test(source[cursor] ?? "")) {
    cursor += 1;
  }
  const nextChar = source[cursor];
  return (
    nextChar === undefined ||
    nextChar === "," ||
    nextChar === "}" ||
    nextChar === "]"
  );
}

function splitPromptSegments(prompt: string): Array<{
  raw: string;
  start: number;
  end: number;
}> {
  const segments: Array<{ raw: string; start: number; end: number }> = [];
  let segmentStart = 0;
  const stack: string[] = [];
  let explicitOpen = false;

  const pushSegment = (segmentEnd: number) => {
    const raw = prompt.slice(segmentStart, segmentEnd);
    if (raw.trim().length > 0) {
      segments.push({ raw, start: segmentStart, end: segmentEnd });
    }
    segmentStart = segmentEnd + 1;
  };

  for (let index = 0; index < prompt.length; index += 1) {
    if (explicitOpen) {
      if (
        prompt[index] === ":" &&
        prompt[index + 1] === ":" &&
        isLikelyExplicitClosingDelimiter(prompt, index + 2)
      ) {
        explicitOpen = false;
        index += 1;
      }
      continue;
    }

    const segmentPrefix = prompt.slice(segmentStart, index);
    if (
      stack.length === 0 &&
      segmentPrefix.trim().length === 0 &&
      prompt.slice(index).match(EXPLICIT_WEIGHT_PREFIX_RE)?.index === 0
    ) {
      explicitOpen = true;
      index += (getExplicitWeightPrefix(prompt.slice(index))?.length ?? 0) - 1;
      continue;
    }

    const char = prompt[index];
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char === "}") {
      if (stack[stack.length - 1] === "{") stack.pop();
      continue;
    }
    if (char === "]") {
      if (stack[stack.length - 1] === "[") stack.pop();
      continue;
    }
    if (char === "," && stack.length === 0) {
      pushSegment(index);
    }
  }

  pushSegment(prompt.length);
  return segments;
}

function extractIssueAnchorText(rawSegment: string): string {
  const trimmedSegment = rawSegment.trim();
  const explicitPrefix = getExplicitWeightPrefix(trimmedSegment);
  const candidate =
    explicitPrefix !== null
      ? trimmedSegment.slice(explicitPrefix.length)
      : trimmedSegment;
  const [firstPart] = splitPromptPartsWithRanges(candidate);
  return (firstPart?.raw ?? candidate).trim();
}

function trimRangeBounds(
  raw: string,
  start: number,
  end: number,
): {
  raw: string;
  start: number;
  end: number;
} {
  const leadingWhitespace = raw.match(/^\s*/)?.[0].length ?? 0;
  const trailingWhitespace = raw.match(/\s*$/)?.[0].length ?? 0;
  return {
    raw: raw.trim(),
    start: start + leadingWhitespace,
    end: end - trailingWhitespace,
  };
}

function getPromptSegmentIssueKind(
  trimmedSegment: string,
): PromptEmphasisSyntaxIssueKind | null {
  const explicitPrefix = getExplicitWeightPrefix(trimmedSegment);

  if (explicitPrefix !== null) {
    if (!trimmedSegment.endsWith("::")) {
      return "invalidExplicitWeight";
    }

    const explicitContent = trimmedSegment.slice(explicitPrefix.length, -2);
    const nestedExplicit = splitPromptPartsWithRanges(explicitContent).some(
      ({ raw }, index) =>
        index > 0 && getExplicitWeightPrefix(raw.trim()) !== null,
    );
    if (nestedExplicit) {
      return "invalidExplicitWeight";
    }

    if (hasInvalidBracketEmphasis(explicitContent)) {
      return "invalidBracketEmphasis";
    }

    return null;
  }

  return getPromptEmphasisSyntaxIssueKind(trimmedSegment);
}

export function findPromptEmphasisSyntaxIssues(
  prompt: string,
): PromptEmphasisSyntaxIssue[] {
  if (!prompt) return [];

  const issues: PromptEmphasisSyntaxIssue[] = [];

  for (const segment of splitPromptSegments(prompt)) {
    const trimmedSegment = trimRangeBounds(
      segment.raw,
      segment.start,
      segment.end,
    );
    const issueKind = getPromptSegmentIssueKind(trimmedSegment.raw);

    if (issueKind) {
      issues.push({
        kind: issueKind,
        start: trimmedSegment.start,
        end: trimmedSegment.end,
        raw: trimmedSegment.raw,
        anchorText: extractIssueAnchorText(trimmedSegment.raw),
      });
    }
  }
  return issues;
}

export function findPromptEmphasisHighlightRanges(
  prompt: string,
): PromptEmphasisHighlightRange[] {
  if (!prompt) return [];

  const ranges: PromptEmphasisHighlightRange[] = [];

  for (const segment of splitPromptSegments(prompt)) {
    const trimmedSegment = trimRangeBounds(
      segment.raw,
      segment.start,
      segment.end,
    );
    if (!trimmedSegment.raw) continue;
    if (getPromptSegmentIssueKind(trimmedSegment.raw) !== null) continue;

    const explicitPrefix = getExplicitWeightPrefix(trimmedSegment.raw);
    if (explicitPrefix !== null) {
      const explicitWeight = Number.parseFloat(explicitPrefix.slice(0, -2));
      if (Number.isFinite(explicitWeight) && hasVisibleWeight(explicitWeight)) {
        ranges.push({
          start: trimmedSegment.start,
          end: trimmedSegment.end,
          kind: "weight",
          weight: explicitWeight,
        });
      }
      continue;
    }

    for (const part of splitPromptPartsWithRanges(segment.raw, segment.start)) {
      const trimmedPart = trimRangeBounds(part.raw, part.start, part.end);
      if (!trimmedPart.raw) continue;
      if (getPromptEmphasisSyntaxIssueKind(trimmedPart.raw) !== null) {
        continue;
      }

      const token = parseRawToken(trimmedPart.raw);
      if (isGroupRef(token)) {
        ranges.push({
          start: trimmedPart.start,
          end: trimmedPart.end,
          kind: "group",
        });
        continue;
      }

      if (isWildcard(token) || !hasVisibleWeight(token.weight)) {
        continue;
      }

      ranges.push({
        start: trimmedPart.start,
        end: trimmedPart.end,
        kind: "weight",
        weight: token.weight,
      });
    }
  }

  return ranges.sort((left, right) =>
    left.start === right.start
      ? right.end - left.end
      : left.start - right.start,
  );
}
