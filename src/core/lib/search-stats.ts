import type { SearchStatSource } from "../types/repository";

// ── Types ──────────────────────────────────────────────────────

export type SearchStatDelta = {
  kind: "resolution" | "model" | "tag";
  key: string;
  width: number | null;
  height: number | null;
  model: string | null;
  delta: number;
};

export type SearchStatMutationInput = {
  before: SearchStatSource | null;
  after: SearchStatSource | null;
};

// ── Constants ──────────────────────────────────────────────────

const TOKEN_TEXT_FIELDS = [
  "promptTokens",
  "negativePromptTokens",
  "characterPromptTokens",
] as const;

const MAX_TAG_SUGGEST_LIMIT = 24;
const MIN_TAG_CONTAINS_QUERY_LENGTH = 3;

// ── Token text extraction ──────────────────────────────────────

function splitTopLevelTagParts(raw: string): string[] {
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

function unwrapExplicitWeightTagBlock(raw: string): string {
  const text = raw.trim();
  const match = text.match(/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)::([\s\S]*?)::$/);
  if (!match) return text;
  return match[1].trim();
}

function hasEnclosingPair(text: string, open: string, close: string): boolean {
  if (text.length < 2) return false;
  if (!text.startsWith(open) || !text.endsWith(close)) return false;

  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === open) {
      depth++;
      continue;
    }
    if (ch !== close) continue;
    depth--;
    if (depth < 0) return false;
    if (depth === 0 && i < text.length - 1) return false;
  }
  return depth === 0;
}

function normalizeTagSegment(value: string): string {
  let text = value.trim();
  if (!text) return "";

  let changed = true;
  while (changed) {
    changed = false;
    if (hasEnclosingPair(text, "{", "}")) {
      text = text.slice(1, -1).trim();
      changed = true;
      continue;
    }
    if (hasEnclosingPair(text, "[", "]")) {
      text = text.slice(1, -1).trim();
      changed = true;
      continue;
    }
  }

  return text
    .replace(/^(?:\{|\}|\[|\])+/, "")
    .replace(/(?:\{|\}|\[|\])+$/, "")
    .trim();
}

export function normalizeTagSuggestionText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const segments = trimmed.split(":");
  const normalized = segments.map((segment) => normalizeTagSegment(segment));
  return normalized.join(":").replace(/\s+/g, " ").trim();
}

export function normalizeTagSuggestionCandidates(value: string): string[] {
  const base = unwrapExplicitWeightTagBlock(value);
  const parts = splitTopLevelTagParts(base);
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const part of parts) {
    const tag = normalizeTagSuggestionText(part);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }
  return normalized;
}

export function extractTokenTexts(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const texts: string[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const text = (item as { text?: unknown }).text;
      if (typeof text !== "string") continue;
      const normalized = normalizeTagSuggestionCandidates(text);
      if (normalized.length === 0) continue;
      texts.push(...normalized);
    }
    return texts;
  } catch {
    return [];
  }
}

// ── Delta computation ──────────────────────────────────────────

export function collectTokenCountMap(
  source: SearchStatSource,
): Map<string, { tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const field of TOKEN_TEXT_FIELDS) {
    const tokenTexts = extractTokenTexts(source[field]);
    for (const tokenText of tokenTexts) {
      const key = tokenText.toLowerCase();
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { tag: tokenText, count: 1 });
      }
    }
  }
  return counts;
}

function addStatDelta(
  map: Map<string, SearchStatDelta>,
  next: SearchStatDelta,
): void {
  const id = `${next.kind}\0${next.key}`;
  const existing = map.get(id);
  if (existing) {
    existing.delta += next.delta;
    if (
      next.kind === "tag" &&
      (!existing.model || existing.model.length === 0) &&
      next.model
    ) {
      existing.model = next.model;
    }
    return;
  }
  map.set(id, { ...next });
}

function collectSourceStatDeltas(
  source: SearchStatSource,
  sign: 1 | -1,
  map: Map<string, SearchStatDelta>,
): void {
  if (source.width > 0 && source.height > 0) {
    addStatDelta(map, {
      kind: "resolution",
      key: `${source.width}x${source.height}`,
      width: source.width,
      height: source.height,
      model: null,
      delta: sign,
    });
  }

  addStatDelta(map, {
    kind: "model",
    key: source.model ?? "",
    width: null,
    height: null,
    model: source.model ?? "",
    delta: sign,
  });

  const tokenCounts = collectTokenCountMap(source);
  for (const [key, value] of tokenCounts) {
    addStatDelta(map, {
      kind: "tag",
      key,
      width: null,
      height: null,
      model: value.tag,
      delta: sign * value.count,
    });
  }
}

export function buildStatDeltasFromMutations(
  mutations: SearchStatMutationInput[],
): SearchStatDelta[] {
  const deltaMap = new Map<string, SearchStatDelta>();
  for (const mutation of mutations) {
    if (mutation.before) {
      collectSourceStatDeltas(mutation.before, -1, deltaMap);
    }
    if (mutation.after) {
      collectSourceStatDeltas(mutation.after, 1, deltaMap);
    }
  }
  return Array.from(deltaMap.values()).filter((delta) => delta.delta !== 0);
}

// ── Tag suggestion helpers ─────────────────────────────────────

export function normalizeSuggestLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 8;
  const integer = Math.floor(value!);
  if (integer < 1) return 1;
  return Math.min(integer, MAX_TAG_SUGGEST_LIMIT);
}

export function normalizeExcludedTagKeys(
  values: string[] | undefined,
): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? "")
      .trim()
      .toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export type TagSuggestion = {
  tag: string;
  count: number;
};

export function mergeAndSortTagSuggestions(
  rows: Array<{ key: string; model: string | null; count: number }>,
  prefix: string,
  excludedSet: Set<string>,
  limit: number,
): TagSuggestion[] {
  const containsEnabled = prefix.length >= MIN_TAG_CONTAINS_QUERY_LENGTH;
  const merged = new Map<string, TagSuggestion>();

  for (const row of rows) {
    const count = Math.max(0, Math.floor(row.count ?? 0));
    for (const tag of normalizeTagSuggestionCandidates(row.model ?? row.key)) {
      const key = tag.toLowerCase().replace(/_/g, " ");
      if (containsEnabled) {
        if (!key.includes(prefix)) continue;
      } else if (!key.startsWith(prefix)) {
        continue;
      }
      if (excludedSet.has(key)) continue;
      const existing = merged.get(key);
      if (existing) {
        existing.count += count;
      } else {
        merged.set(key, { tag, count });
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      const aExact = a.tag.toLowerCase() === prefix;
      const bExact = b.tag.toLowerCase() === prefix;
      if (aExact !== bExact) return aExact ? -1 : 1;
      if (containsEnabled) {
        const aPrefix = a.tag.toLowerCase().startsWith(prefix);
        const bPrefix = b.tag.toLowerCase().startsWith(prefix);
        if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      }
      if (a.count !== b.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag);
    })
    .slice(0, limit);
}

export { MIN_TAG_CONTAINS_QUERY_LENGTH };
