export type TokenWeightExpression = "keyword" | "numerical";

export type PromptToken = {
  text: string;
  weight: number;
  raw?: string;
  weightExpression?: TokenWeightExpression;
};

export type GroupRefToken = {
  kind: "group";
  groupName: string;
  overrideTags?: string[]; // if set, overrides the DB group's tokens (one-time local edit)
  weight?: number; // per-instance weight (default 1.0), serialized as #weight suffix
  weightExpression?: TokenWeightExpression; // how weight is applied to expanded tags (default "numerical")
};

export type WildcardToken = {
  kind: "wildcard";
  options: string[]; // raw token strings, e.g. ["red hair", "1.2::blue hair::"]
  resolved?: string; // last resolved value (set by resolveWildcardsInString callers for display)
};

export type AnyToken = PromptToken | GroupRefToken | WildcardToken;
export type PromptPartRange = {
  raw: string;
  start: number;
  end: number;
};

export function isGroupRef(token: AnyToken): token is GroupRefToken {
  return (token as GroupRefToken).kind === "group";
}

export function isWildcard(token: AnyToken): token is WildcardToken {
  return (token as WildcardToken).kind === "wildcard";
}

const MULT = 1.05;

function parseBracketWeight(raw: string): PromptToken {
  let text = raw.trim();
  let power = 0;

  let changed = true;
  while (changed) {
    changed = false;
    if (text.startsWith("{") && text.endsWith("}") && text.length > 1) {
      power++;
      text = text.slice(1, -1).trim();
      changed = true;
    } else if (text.startsWith("[") && text.endsWith("]") && text.length > 1) {
      power--;
      text = text.slice(1, -1).trim();
      changed = true;
    }
  }

  text = text
    .replace(/:[\d.]+\s*(?=[)}\]>])/g, "")
    .trim()
    .replace(/\s+/g, " ");

  return { text, weight: Math.pow(MULT, power), raw: raw.trim() };
}

export function tokenToRawString(token: AnyToken): string {
  if (isGroupRef(token)) {
    const exprSuffix = token.weightExpression === "keyword" ? "k" : "";
    const weightSuffix =
      token.weight !== undefined && Math.abs(token.weight - 1.0) > 0.001
        ? `#${token.weight.toFixed(2).replace(/\.?0+$/, "")}${exprSuffix}`
        : exprSuffix
          ? `#1${exprSuffix}`
          : "";
    if (token.overrideTags !== undefined) {
      return `@{${token.groupName}:${token.overrideTags.join("|")}${weightSuffix}}`;
    }
    return `@{${token.groupName}${weightSuffix}}`;
  }
  if (isWildcard(token)) {
    return `%{${token.options.join("|")}}`;
  }
  if (token.raw && token.raw.trim()) return token.raw.trim();
  if (Math.abs(token.weight - 1.0) <= 0.001) return token.text;
  return `${token.weight.toFixed(2)}::${token.text}::`;
}

export function splitPromptPartsWithRanges(
  source: string,
  startOffset = 0,
): PromptPartRange[] {
  const parts: PromptPartRange[] = [];
  let partStart = 0;
  const stack: string[] = [];

  const pushPart = (partEnd: number) => {
    const raw = source.slice(partStart, partEnd);
    if (raw.trim().length > 0) {
      parts.push({
        raw,
        start: startOffset + partStart,
        end: startOffset + partEnd,
      });
    }
    partStart = partEnd + 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}") {
      if (stack[stack.length - 1] === "{") {
        stack.pop();
      }
      continue;
    }

    if (char === "]") {
      if (stack[stack.length - 1] === "[") {
        stack.pop();
      }
      continue;
    }

    if (char === "," && stack.length === 0) {
      pushPart(index);
    }
  }

  pushPart(source.length);
  return parts;
}

// Split s at '|' characters that are at brace depth 0 (not inside any {...} pair)
function splitOptionsByPipe(s: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of s) {
    if (ch === "{") {
      depth++;
      current += ch;
    } else if (ch === "}") {
      depth--;
      current += ch;
    } else if (ch === "|" && depth === 0) {
      const opt = current.trim();
      if (opt) parts.push(opt);
      current = "";
    } else {
      current += ch;
    }
  }
  const opt = current.trim();
  if (opt) parts.push(opt);
  return parts;
}

function parseWildcardToken(raw: string): WildcardToken | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("%{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(2, -1);
  // Validate balanced braces in the inner content
  let depth = 0;
  for (const ch of inner) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;
  const options = splitOptionsByPipe(inner);
  if (options.length === 0) return null;
  return { kind: "wildcard", options };
}

function parseGroupToken(raw: string): GroupRefToken | null {
  // Matches @{groupName}, @{groupName:tag1|tag2}, @{groupName#1.3},
  // @{groupName:tag1|tag2#0.8}, @{groupName#1.3k} (k = keyword expression)
  const m = raw.match(/^@\{([^:}#]+)(?::([^}#]*?))?(?:#(-?[\d.]+)(k)?)?\}$/);
  if (!m) return null;
  const groupName = m[1];
  const result: GroupRefToken = { kind: "group", groupName };
  if (m[2] !== undefined) {
    result.overrideTags = m[2]
      .split("|")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }
  if (m[3] !== undefined) {
    const w = parseFloat(m[3]);
    if (Number.isFinite(w) && Math.abs(w - 1.0) > 0.001) {
      result.weight = w;
    }
  }
  if (m[4] === "k") {
    result.weightExpression = "keyword";
  }
  return result;
}

export function parseRawToken(raw: string): AnyToken {
  const trimmed = raw.trim();
  const wildcard = parseWildcardToken(trimmed);
  if (wildcard) return wildcard;
  const group = parseGroupToken(trimmed);
  if (group) return group;
  const parsed = parsePromptTokens(trimmed).at(0);
  if (parsed && !isGroupRef(parsed) && !isWildcard(parsed))
    return { ...parsed, raw: trimmed };
  return { text: trimmed, weight: 1, raw: trimmed };
}

export function parsePromptTokens(prompt: string): AnyToken[] {
  const result: AnyToken[] = [];

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
    for (const { raw: part } of splitPromptPartsWithRanges(seg.text)) {
      const trimmedPart = part.trim();
      const wildcard = parseWildcardToken(trimmedPart);
      if (wildcard) {
        result.push(wildcard);
        continue;
      }
      const group = parseGroupToken(trimmedPart);
      if (group) {
        result.push(group);
        continue;
      }
      const token = parseBracketWeight(part);
      if (!token.text) continue;
      result.push({
        text: token.text,
        weight: seg.explicitWeight !== null ? seg.explicitWeight : token.weight,
        raw:
          seg.explicitWeight !== null
            ? `${seg.explicitWeight}::${part.trim()}::`
            : part.trim(),
      });
    }
  }

  return result;
}

// Resolves all %{opt1|opt2} wildcards in a prompt string by picking a random option each.
// Handles nested @{...} group refs inside options (e.g. %{red hair|@{someGroup}|blue hair}).
export function resolveWildcardsInString(prompt: string): string {
  let result = "";
  let i = 0;
  while (i < prompt.length) {
    if (prompt[i] === "%" && prompt[i + 1] === "{") {
      // Find the matching closing } using brace depth tracking
      let depth = 1;
      let j = i + 2;
      while (j < prompt.length && depth > 0) {
        if (prompt[j] === "{") depth++;
        else if (prompt[j] === "}") depth--;
        j++;
      }
      if (depth === 0) {
        const inner = prompt.slice(i + 2, j - 1);
        const opts = splitOptionsByPipe(inner);
        result += opts[Math.floor(Math.random() * opts.length)] ?? "";
        i = j;
      } else {
        result += prompt[i++];
      }
    } else {
      result += prompt[i++];
    }
  }
  return result;
}
