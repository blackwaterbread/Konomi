export type PromptToken = {
  text: string;
  weight: number;
  /**
   * Original source text of this token, kept only when it carries formatting
   * that `text` + `weight` cannot reproduce (spacing inside `w::tag ::`,
   * bracket emphasis, the author's own weight literal). Omitted when the token
   * round-trips exactly, so the stored JSON stays small.
   */
  raw?: string;
};

const MULT = 1.05;

function hasEnclosingPair(text: string, open: string, close: string): boolean {
  if (text.length < 2) return false;
  if (!text.startsWith(open) || !text.endsWith(close)) return false;

  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth < 0) return false;
      // The first outer pair must close at the very end.
      if (depth === 0 && i < text.length - 1) return false;
    }
  }
  return depth === 0;
}

function splitTopLevelComma(raw: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let angleDepth = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") braceDepth++;
    else if (ch === "}" && braceDepth > 0) braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]" && bracketDepth > 0) bracketDepth--;
    else if (ch === "(") parenDepth++;
    else if (ch === ")" && parenDepth > 0) parenDepth--;
    else if (ch === "<") angleDepth++;
    else if (ch === ">" && angleDepth > 0) angleDepth--;

    if (
      ch === "," &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0 &&
      angleDepth === 0
    ) {
      parts.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}

function normalizeTokenText(raw: string): string {
  return (
    raw
      .trim()
      // Remove (tag:weight) style weight suffixes (SD/NAI hybrid syntax)
      .replace(/:[\d.]+\s*(?=[)}\]>])/g, "")
      .trim()
      .replace(/\s+/g, " ")
  );
}

function unwrapBracketWeight(raw: string): { text: string; power: number } {
  let text = raw.trim();
  let power = 0;

  let changed = true;
  while (changed) {
    changed = false;
    if (hasEnclosingPair(text, "{", "}")) {
      text = text.slice(1, -1).trim();
      power++;
      changed = true;
      continue;
    }
    if (hasEnclosingPair(text, "[", "]")) {
      text = text.slice(1, -1).trim();
      power--;
      changed = true;
      continue;
    }
  }
  return { text, power };
}

function parseWeightedPart(raw: string, inheritedPower = 0): PromptToken[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const { text, power } = unwrapBracketWeight(trimmed);
  const totalPower = inheritedPower + power;
  const parts = splitTopLevelComma(text);
  if (parts.length > 1) {
    const nested: PromptToken[] = [];
    for (const part of parts) {
      nested.push(...parseWeightedPart(part, totalPower));
    }
    return nested;
  }

  const normalized = normalizeTokenText(text);
  if (!normalized) return [];
  const token: PromptToken = {
    text: normalized,
    weight: Math.pow(MULT, totalPower),
  };
  // Only a leaf reached without inherited bracket power still contains its own
  // emphasis; deeper leaves lost their wrapper to the split above, so their
  // source text no longer round-trips the weight.
  if (inheritedPower === 0 && trimmed !== normalized) token.raw = trimmed;
  return [token];
}

export function parsePromptTokens(prompt: string): PromptToken[] {
  const result: PromptToken[] = [];

  // Extract explicit weight::content:: blocks before comma-splitting
  const segments: Array<{
    text: string;
    explicitWeight: number | null;
    weightLiteral: string | null;
  }> = [];
  const re = /(-?[\d.]+)::([\s\S]*?)::/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(prompt)) !== null) {
    if (m.index > lastIdx)
      segments.push({
        text: prompt.slice(lastIdx, m.index),
        explicitWeight: null,
        weightLiteral: null,
      });
    segments.push({
      text: m[2],
      explicitWeight: parseFloat(m[1]),
      weightLiteral: m[1],
    });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < prompt.length)
    segments.push({
      text: prompt.slice(lastIdx),
      explicitWeight: null,
      weightLiteral: null,
    });

  for (const seg of segments) {
    const tokens = parseWeightedPart(seg.text);
    if (seg.explicitWeight === null) {
      result.push(...tokens);
      continue;
    }
    // The whole `w::...::` block shares one weight. Its source only round-trips
    // when it produced a single token — otherwise the weight sits outside the
    // per-token text and cannot be split back out.
    const raw =
      tokens.length === 1 ? `${seg.weightLiteral}::${seg.text}::` : null;
    for (const token of tokens) {
      const next: PromptToken = {
        text: token.text,
        weight: seg.explicitWeight,
      };
      if (raw !== null) next.raw = raw;
      result.push(next);
    }
  }

  return result;
}
