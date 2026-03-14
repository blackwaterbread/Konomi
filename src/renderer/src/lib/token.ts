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
};

export type AnyToken = PromptToken | GroupRefToken;

export function isGroupRef(token: AnyToken): token is GroupRefToken {
  return (token as GroupRefToken).kind === "group";
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
  if (isGroupRef(token)) return `@{${token.groupName}}`;
  if (token.raw && token.raw.trim()) return token.raw.trim();
  if (Math.abs(token.weight - 1.0) <= 0.001) return token.text;
  return `${token.weight.toFixed(2)}::${token.text}::`;
}

export function parseRawToken(raw: string): AnyToken {
  const trimmed = raw.trim();
  const groupMatch = trimmed.match(/^@\{([^}]+)\}$/);
  if (groupMatch) return { kind: "group", groupName: groupMatch[1] };
  const parsed = parsePromptTokens(trimmed).at(0);
  if (parsed && !isGroupRef(parsed)) return { ...parsed, raw: trimmed };
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
    for (const part of seg.text.split(",")) {
      const trimmedPart = part.trim();
      const groupMatch = trimmedPart.match(/^@\{([^}]+)\}$/);
      if (groupMatch) {
        result.push({ kind: "group", groupName: groupMatch[1] });
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
