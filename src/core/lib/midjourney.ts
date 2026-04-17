import { readFileSync } from "fs";
import type { ImageMeta } from "../types/image-meta";
import { readPngSize, readPngTextChunks } from "./png-meta";

type MidjourneyParsedDescription = {
  prompt: string;
  paramsText: string;
  jobId: string;
  aspectRatio: string;
  version: string;
  nijiVersion: string;
  seed: string;
};

function parseMidjourneyDescription(
  description: string,
): MidjourneyParsedDescription {
  const normalized = description.replace(/\0/g, "").trim();

  const jobIdMatch = normalized.match(/\s+Job ID:\s*([a-z0-9-]+)\s*$/i);
  const jobId = jobIdMatch?.[1] ?? "";
  const withoutJobId =
    jobIdMatch && jobIdMatch.index !== undefined
      ? normalized.slice(0, jobIdMatch.index).trim()
      : normalized;

  const firstParamIdx = withoutJobId.search(/\s--[a-zA-Z]/);
  const prompt =
    firstParamIdx === -1
      ? withoutJobId.replace(/[,\s]+$/, "").trim()
      : withoutJobId
          .slice(0, firstParamIdx)
          .replace(/[,\s]+$/, "")
          .trim();
  const paramsText =
    firstParamIdx === -1 ? "" : withoutJobId.slice(firstParamIdx).trim();

  const extractParam = (name: string): string => {
    const match = paramsText.match(
      new RegExp(`(?:^|\\s)--${name}\\s+([^\\s]+)`, "i"),
    );
    return match?.[1]?.trim() ?? "";
  };

  return {
    prompt,
    paramsText,
    jobId,
    aspectRatio: extractParam("ar"),
    version: extractParam("v(?:ersion)?"),
    nijiVersion: extractParam("niji"),
    seed: extractParam("seed"),
  };
}

function extractXmpGuid(xmp: string): string {
  const match = xmp.match(/DigImageGUID="([^"]+)"/i);
  return match?.[1]?.trim() ?? "";
}

function hasMidjourneySignals(
  author: string,
  xmp: string,
  parsed: MidjourneyParsedDescription,
  jobId: string,
): boolean {
  const hasAuthorSignal = /^u\d+$/i.test(author);
  const hasJobSignal = Boolean(jobId);
  const hasParamSignal =
    /(?:^|\s)--(?:ar|v(?:ersion)?|niji|seed|stylize|chaos|quality|q|weird|iw|sref|oref|cref|no|tile|raw)\b/i.test(
      parsed.paramsText,
    );
  const hasXmpSignal =
    Boolean(extractXmpGuid(xmp)) || /trainedAlgorithmicMedia/i.test(xmp);

  const signalCount = [
    hasAuthorSignal,
    hasJobSignal,
    hasParamSignal,
    hasXmpSignal,
  ].filter(Boolean).length;

  return signalCount >= 2;
}

function resolveModel(parsed: MidjourneyParsedDescription): string {
  if (parsed.nijiVersion) return `niji-${parsed.nijiVersion}`;
  if (parsed.version) return `midjourney-v${parsed.version}`;
  return "midjourney";
}

function buildMidjourneyMeta(
  chunks: Record<string, string>,
  width: number,
  height: number,
): ImageMeta | null {
  const description = chunks["Description"]?.trim();
  if (!description) return null;

  const parsed = parseMidjourneyDescription(description);
  const author = chunks["Author"]?.trim() ?? "";
  const xmp = chunks["XML:com.adobe.xmp"] ?? "";
  const guid = extractXmpGuid(xmp);
  const jobId = parsed.jobId || guid;

  // Require multiple Midjourney-specific signals to avoid misclassifying
  // arbitrary PNG Description text as Midjourney metadata.
  if (!parsed.prompt || !hasMidjourneySignals(author, xmp, parsed, jobId)) {
    return null;
  }

  return {
    source: "midjourney",
    prompt: parsed.prompt,
    negativePrompt: "",
    characterPrompts: [],
    characterNegativePrompts: [],
    characterPositions: [],
    seed: parsed.seed,
    model: resolveModel(parsed),
    sampler: "",
    steps: 0,
    cfgScale: 0,
    cfgRescale: 0,
    noiseSchedule: "",
    varietyPlus: false,
    width,
    height,
    raw: {
      author,
      creationTime: chunks["Creation Time"] ?? "",
      description,
      parameters: parsed.paramsText,
      aspectRatio: parsed.aspectRatio,
      version: parsed.version,
      nijiVersion: parsed.nijiVersion,
      jobId,
      xmp,
    },
  };
}

export function readMidjourneyMeta(filePath: string): ImageMeta | null {
  try {
    const buf = readFileSync(filePath);
    return readMidjourneyMetaFromBuffer(buf);
  } catch {
    return null;
  }
}

export function readMidjourneyMetaFromBuffer(buf: Buffer): ImageMeta | null {
  try {
    const { width, height } = readPngSize(buf);
    const chunks = readPngTextChunks(buf);
    return buildMidjourneyMeta(chunks, width, height);
  } catch {
    return null;
  }
}
