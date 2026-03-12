export type PromptToken = { text: string; weight: number };

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
  return raw
    .trim()
    // Remove (tag:weight) style weight suffixes (SD/NAI hybrid syntax)
    .replace(/:[\d.]+\s*(?=[)}\]>])/g, "")
    .trim()
    .replace(/\s+/g, " ");
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
  return [{ text: normalized, weight: Math.pow(MULT, totalPower) }];
}

export function parsePromptTokens(prompt: string): PromptToken[] {
  const result: PromptToken[] = [];

  // Extract explicit weight::content:: blocks before comma-splitting
  const segments: Array<{ text: string; explicitWeight: number | null }> = [];
  const re = /(-?[\d.]+)::([\s\S]*?)::/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(prompt)) !== null) {
    if (m.index > lastIdx)
      segments.push({
        text: prompt.slice(lastIdx, m.index),
        explicitWeight: null,
      });
    segments.push({ text: m[2], explicitWeight: parseFloat(m[1]) });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < prompt.length)
    segments.push({ text: prompt.slice(lastIdx), explicitWeight: null });

  for (const seg of segments) {
    const tokens = parseWeightedPart(seg.text);
    for (const token of tokens) {
      result.push({
        text: token.text,
        weight: seg.explicitWeight !== null ? seg.explicitWeight : token.weight,
      });
    }
  }

  return result;
}
