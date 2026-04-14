import { readFileSync } from "fs";
import type { ImageMeta } from "../types/image-meta";
import { readPngSize, readPngTextChunks } from "./png-meta";

function parseParameters(
  text: string,
  imgW: number,
  imgH: number,
): ImageMeta {
  const lines = text.split("\n");

  const negStart = lines.findIndex((l) => l.startsWith("Negative prompt:"));
  const paramsStart = lines.findIndex((l) => l.startsWith("Steps:"));

  const promptEnd =
    negStart !== -1
      ? negStart
      : paramsStart !== -1
        ? paramsStart
        : lines.length;
  const prompt = lines.slice(0, promptEnd).join("\n").trim();

  let negativePrompt = "";
  if (negStart !== -1) {
    const negEnd = paramsStart !== -1 ? paramsStart : lines.length;
    const negLines = lines.slice(negStart, negEnd);
    negLines[0] = negLines[0].replace(/^Negative prompt:\s*/, "");
    negativePrompt = negLines.join("\n").trim();
  }

  let seed = 0,
    sampler = "",
    steps = 0,
    cfgScale = 0,
    model = "";
  let width = imgW,
    height = imgH;

  if (paramsStart !== -1) {
    const paramsText = lines.slice(paramsStart).join(", ");
    const kv = (key: string): string => {
      const m = paramsText.match(new RegExp(`${key}:\\s*([^,]+)`));
      return m ? m[1].trim() : "";
    };
    seed = parseInt(kv("Seed")) || 0;
    sampler = kv("Sampler");
    steps = parseInt(kv("Steps")) || 0;
    cfgScale = parseFloat(kv("CFG scale")) || 0;
    model = kv("Model");
    const size = kv("Size");
    if (size) {
      const [sw, sh] = size.split("x").map(Number);
      if (sw) width = sw;
      if (sh) height = sh;
    }
  }

  return {
    source: "webui",
    prompt,
    negativePrompt,
    characterPrompts: [],
    characterNegativePrompts: [],
    characterPositions: [],
    seed,
    model,
    sampler,
    steps,
    cfgScale,
    cfgRescale: 0,
    noiseSchedule: "",
    varietyPlus: false,
    width,
    height,
    raw: { parameters: text },
  };
}

export function readWebuiMeta(filePath: string): ImageMeta | null {
  try {
    const buf = readFileSync(filePath);
    return readWebuiMetaFromBuffer(buf);
  } catch {
    return null;
  }
}

export function readWebuiMetaFromBuffer(buf: Buffer): ImageMeta | null {
  try {
    const { width: w, height: h } = readPngSize(buf);
    const chunks = readPngTextChunks(buf);
    const params = chunks["parameters"];
    if (!params) return null;
    return parseParameters(params, w, h);
  } catch {
    return null;
  }
}
