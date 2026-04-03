import { readFileSync } from "fs";
import type { ImageMeta } from "@/types/image-meta";
import { readPngSize, readPngTextChunks } from "./png-meta";

type NodeId = string;
type NodeLink = [NodeId, number];

interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

type ComfyPrompt = Record<NodeId, ComfyNode>;

function isLink(v: unknown): v is NodeLink {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    (typeof v[0] === "string" || typeof v[0] === "number") &&
    typeof v[1] === "number"
  );
}

/** Follow a link reference and return the target node. */
function followLink(graph: ComfyPrompt, val: unknown): ComfyNode | null {
  if (!isLink(val)) return null;
  return graph[String(val[0])] ?? null;
}

/**
 * Resolve a numeric value from a node input.
 * The value can be an inline number, or a link to a node whose output holds it.
 */
function resolveNumber(
  graph: ComfyPrompt,
  node: ComfyNode,
  inputKey: string,
): number {
  const val = node.inputs[inputKey];
  if (typeof val === "number") return val;

  const target = followLink(graph, val);
  if (!target) return NaN;

  for (const key of ["seed", "noise_seed", "value", "INT"]) {
    if (typeof target.inputs[key] === "number") return target.inputs[key];
  }

  return NaN;
}

/**
 * Resolve a text value from a node input.
 * Recursively follows links through concatenation and string-processing nodes.
 */
function resolveText(
  graph: ComfyPrompt,
  node: ComfyNode,
  inputKey: string,
  depth = 0,
): string {
  if (depth > 16) return "";

  const val = node.inputs[inputKey];
  if (typeof val === "string") return val;

  const target = followLink(graph, val);
  if (!target) return "";

  // Text Concatenate (JPS) — join text1..text5
  if (/Text Concatenate/i.test(target.class_type)) {
    const d = target.inputs["delimiter"];
    const delim =
      d === "space" ? " " : d === "newline" ? "\n" : d === "none" ? "" : ", ";
    const parts: string[] = [];
    for (const key of ["text1", "text2", "text3", "text4", "text5"]) {
      const t = resolveText(graph, target, key, depth + 1);
      if (t) parts.push(t);
    }
    return parts.join(delim);
  }

  // StringFunction — pass through text_a
  if (/StringFunction/i.test(target.class_type)) {
    return resolveText(graph, target, "text_a", depth + 1);
  }

  // Generic text node — try common keys recursively
  for (const key of ["text", "text_a", "text_1", "string", "STRING"]) {
    const t = resolveText(graph, target, key, depth + 1);
    if (t) return t;
  }

  return "";
}

/**
 * Walk upstream through model links to find the checkpoint name.
 * Handles LoraLoader chains, Efficient Loader, and direct CheckpointLoader.
 */
function resolveModelFromNode(
  graph: ComfyPrompt,
  node: ComfyNode,
  depth = 0,
): string {
  if (depth > 8) return "";

  // Direct ckpt_name on this node (CheckpointLoaderSimple, Efficient Loader, etc.)
  if (typeof node.inputs["ckpt_name"] === "string") {
    return node.inputs["ckpt_name"];
  }

  // Follow "model" link upstream
  const upstream = followLink(graph, node.inputs["model"]);
  if (upstream) return resolveModelFromNode(graph, upstream, depth + 1);

  return "";
}

/** Collected generation parameters from the graph. */
interface ComfyParams {
  positive: string;
  negative: string;
  seed: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  model: string;
  width: number;
  height: number;
}

/**
 * Extract params from a standard KSampler / KSamplerAdvanced node
 * that has direct positive/negative/model/latent_image inputs.
 */
function extractFromStandardSampler(
  graph: ComfyPrompt,
  node: ComfyNode,
): ComfyParams {
  const positive = resolveText(graph, node, "positive");
  const negative = resolveText(graph, node, "negative");

  // Follow positive/negative links to CLIPTextEncode → text
  const posNode = followLink(graph, node.inputs["positive"]);
  const negNode = followLink(graph, node.inputs["negative"]);
  const posText =
    positive || (posNode ? resolveText(graph, posNode, "text") : "");
  const negText =
    negative || (negNode ? resolveText(graph, negNode, "text") : "");

  // Model
  const modelNode = followLink(graph, node.inputs["model"]);
  const model = modelNode ? resolveModelFromNode(graph, modelNode) : "";

  // Size from latent_image
  const latentNode = followLink(graph, node.inputs["latent_image"]);
  const width = Number(latentNode?.inputs["width"] ?? 0);
  const height = Number(latentNode?.inputs["height"] ?? 0);

  return {
    positive: posText,
    negative: negText,
    seed: resolveNumber(graph, node, "seed") || resolveNumber(graph, node, "noise_seed") || 0,
    steps: Number(node.inputs["steps"] ?? 0),
    cfg: Number(node.inputs["cfg"] ?? 0),
    samplerName: String(node.inputs["sampler_name"] ?? ""),
    scheduler: String(node.inputs["scheduler"] ?? ""),
    model,
    width,
    height,
  };
}

/**
 * Extract params from an Efficient-style sampler that uses a "context" input
 * pointing to an Efficient Loader node which holds prompt/model/size.
 */
function extractFromContextSampler(
  graph: ComfyPrompt,
  samplerNode: ComfyNode,
  loaderNode: ComfyNode,
): ComfyParams {
  const positive = resolveText(graph, loaderNode, "positive");
  const negative = resolveText(graph, loaderNode, "negative");
  const model =
    typeof loaderNode.inputs["ckpt_name"] === "string"
      ? loaderNode.inputs["ckpt_name"]
      : "";

  // Efficient Loader stores size as image_width/image_height or width/height
  const width = Number(
    loaderNode.inputs["image_width"] ?? loaderNode.inputs["width"] ?? 0,
  );
  const height = Number(
    loaderNode.inputs["image_height"] ?? loaderNode.inputs["height"] ?? 0,
  );

  // Sampler params — prefer sampler's own values, but fall back to loader
  const fromContext =
    samplerNode.inputs["set_seed_cfg_sampler"] === "from context";
  const src = fromContext ? loaderNode : samplerNode;

  return {
    positive,
    negative,
    seed: resolveNumber(graph, samplerNode, "seed") || resolveNumber(graph, src, "seed") || 0,
    steps: Number(samplerNode.inputs["steps"] ?? 0),
    cfg: Number(src.inputs["cfg"] ?? 0),
    samplerName: String(src.inputs["sampler_name"] ?? ""),
    scheduler: String(src.inputs["scheduler"] ?? ""),
    model,
    width,
    height,
  };
}

function isSamplerNode(classType: string): boolean {
  return /KSampler/i.test(classType);
}

function isLoaderNode(classType: string): boolean {
  return /Loader/i.test(classType) && /ckpt|checkpoint|efficient/i.test(classType);
}

// ---------------------------------------------------------------------------
// Workflow fallback: extract params from widgets_values when prompt graph fails
// ---------------------------------------------------------------------------

interface WorkflowNode {
  id: number;
  type: string;
  widgets_values?: unknown[];
}

interface ComfyWorkflow {
  nodes?: WorkflowNode[];
}

function findWorkflowNode(
  wf: ComfyWorkflow,
  predicate: (type: string) => boolean,
): WorkflowNode | undefined {
  return wf.nodes?.find((n) => predicate(n.type));
}

function wfStr(val: unknown): string {
  return typeof val === "string" ? val : "";
}
function wfNum(val: unknown): number {
  return typeof val === "number" ? val : 0;
}

/**
 * Known widget orders for common node types.
 * These are positional — the index in widgets_values maps to a specific field.
 */
function extractFromWorkflow(
  workflowJson: string,
  imgW: number,
  imgH: number,
): ComfyParams | null {
  let wf: ComfyWorkflow;
  try {
    wf = JSON.parse(workflowJson) as ComfyWorkflow;
  } catch {
    return null;
  }
  if (!wf.nodes?.length) return null;

  let positive = "";
  let negative = "";
  let seed = 0;
  let steps = 0;
  let cfg = 0;
  let samplerName = "";
  let scheduler = "";
  let model = "";
  let width = 0;
  let height = 0;

  // --- Efficient Loader 패턴 ---
  // widgets_values: [ckpt_name, vae, clip_skip, paint_mode, batch, seed, ?, cfg, sampler, scheduler, w, h]
  const effLoader = findWorkflowNode(wf, (t) => /Efficient Loader/i.test(t));
  if (effLoader?.widgets_values) {
    const v = effLoader.widgets_values;
    model = model || wfStr(v[0]);
    cfg = cfg || wfNum(v[7]);
    samplerName = samplerName || wfStr(v[8]);
    scheduler = scheduler || wfStr(v[9]);
    width = width || wfNum(v[10]);
    height = height || wfNum(v[11]);
  }

  // --- KSampler (Efficient) 패턴 ---
  // widgets_values: [set_seed_cfg_sampler, seed, "randomize", steps, cfg, sampler, scheduler, denoise, ...]
  const effSampler = findWorkflowNode(wf, (t) =>
    /KSampler.*Efficient/i.test(t),
  );
  if (effSampler?.widgets_values) {
    const v = effSampler.widgets_values;
    seed = seed || wfNum(v[1]);
    steps = steps || wfNum(v[3]);
    // Only use sampler params if not "from context"
    if (v[0] !== "from context") {
      cfg = cfg || wfNum(v[4]);
      samplerName = samplerName || wfStr(v[5]);
      scheduler = scheduler || wfStr(v[6]);
    }
  }

  // --- Standard KSampler ---
  // widgets_values: [seed, "randomize", steps, cfg, sampler, scheduler, denoise]
  if (!effSampler) {
    const stdSampler = findWorkflowNode(wf, (t) => /KSampler/i.test(t));
    if (stdSampler?.widgets_values) {
      const v = stdSampler.widgets_values;
      seed = seed || wfNum(v[0]);
      steps = steps || wfNum(v[2]);
      cfg = cfg || wfNum(v[3]);
      samplerName = samplerName || wfStr(v[4]);
      scheduler = scheduler || wfStr(v[5]);
    }
  }

  // --- CheckpointLoaderSimple ---
  // widgets_values: [ckpt_name]
  if (!model) {
    const ckptLoader = findWorkflowNode(wf, (t) =>
      /Checkpoint/i.test(t),
    );
    if (ckptLoader?.widgets_values) {
      model = wfStr(ckptLoader.widgets_values[0]);
    }
  }

  // --- EmptyLatentImage ---
  // widgets_values: [width, height, batch_size]
  if (!width || !height) {
    const latent = findWorkflowNode(wf, (t) => /EmptyLatentImage/i.test(t));
    if (latent?.widgets_values) {
      width = width || wfNum(latent.widgets_values[0]);
      height = height || wfNum(latent.widgets_values[1]);
    }
  }

  // --- Text nodes (prompt / negative) ---
  // Heuristic: find CLIPTextEncode or Simple Text nodes.
  // The first text found is positive, second is negative.
  const textNodes = (wf.nodes ?? []).filter(
    (n) =>
      /CLIPTextEncode|Simple Text/i.test(n.type) &&
      n.widgets_values?.length &&
      typeof n.widgets_values[0] === "string",
  );
  // Sort by node order field if available, then by id
  textNodes.sort((a, b) => a.id - b.id);
  if (textNodes.length >= 1) positive = wfStr(textNodes[0].widgets_values![0]);
  if (textNodes.length >= 2) negative = wfStr(textNodes[1].widgets_values![0]);

  // Must have extracted at least a prompt or model to consider it valid
  if (!positive && !model) return null;

  return {
    positive,
    negative,
    seed,
    steps,
    cfg,
    samplerName,
    scheduler,
    model,
    width: width || imgW,
    height: height || imgH,
  };
}

function collectLoras(graph: ComfyPrompt): string[] {
  const loras: string[] = [];
  for (const node of Object.values(graph)) {
    if (
      /LoraLoader/i.test(node.class_type) &&
      typeof node.inputs["lora_name"] === "string"
    ) {
      const strength = Number(node.inputs["strength_model"] ?? 1);
      loras.push(
        strength === 1
          ? node.inputs["lora_name"]
          : `${node.inputs["lora_name"]}:${strength}`,
      );
    }
  }
  return loras;
}

function parseComfyPrompt(
  promptJson: string,
  imgW: number,
  imgH: number,
): ImageMeta | null {
  let graph: ComfyPrompt;
  try {
    graph = JSON.parse(promptJson) as ComfyPrompt;
  } catch {
    return null;
  }

  if (typeof graph !== "object" || graph === null) return null;

  // Find a sampler node
  let samplerEntry: { id: NodeId; node: ComfyNode } | null = null;
  for (const [id, node] of Object.entries(graph)) {
    if (isSamplerNode(node.class_type)) {
      samplerEntry = { id, node };
      break;
    }
  }
  if (!samplerEntry) return null;

  const { node: samplerNode } = samplerEntry;
  let params: ComfyParams;

  // Check if sampler uses a "context" input (Efficient workflow pattern)
  const contextTarget = followLink(graph, samplerNode.inputs["context"]);
  if (contextTarget && isLoaderNode(contextTarget.class_type)) {
    params = extractFromContextSampler(graph, samplerNode, contextTarget);
  } else {
    params = extractFromStandardSampler(graph, samplerNode);
  }

  const loras = collectLoras(graph);

  return buildMeta(
    { ...params, width: params.width || imgW, height: params.height || imgH },
    { prompt: graph, loras },
  );
}

function buildMeta(params: ComfyParams, raw: Record<string, unknown>): ImageMeta {
  return {
    source: "comfyui",
    prompt: params.positive,
    negativePrompt: params.negative,
    characterPrompts: [],
    characterNegativePrompts: [],
    characterPositions: [],
    seed: params.seed,
    model: params.model,
    sampler: params.scheduler
      ? `${params.samplerName} (${params.scheduler})`
      : params.samplerName,
    steps: params.steps,
    cfgScale: params.cfg,
    cfgRescale: 0,
    noiseSchedule: "",
    varietyPlus: false,
    width: params.width,
    height: params.height,
    raw,
  };
}

export function readComfyuiMetaFromBuffer(buf: Buffer): ImageMeta | null {
  try {
    const { width, height } = readPngSize(buf);
    const chunks = readPngTextChunks(buf);

    // ComfyUI stores its API prompt graph under the "prompt" tEXt key
    const promptJson = chunks["prompt"];
    if (!promptJson) return null;

    // Quick validation: must be a JSON object (not the plain-text WebUI format)
    const trimmed = promptJson.trimStart();
    if (!trimmed.startsWith("{")) return null;

    // Primary: parse from prompt graph
    const result = parseComfyPrompt(promptJson, width, height);
    if (result) return result;

    // Fallback: extract from workflow widgets_values
    const workflowJson = chunks["workflow"];
    if (!workflowJson) return null;

    const params = extractFromWorkflow(workflowJson, width, height);
    if (!params) return null;

    return buildMeta(params, { workflow: JSON.parse(workflowJson) });
  } catch {
    return null;
  }
}

export function readComfyuiMeta(filePath: string): ImageMeta | null {
  try {
    const buf = readFileSync(filePath);
    return readComfyuiMetaFromBuffer(buf);
  } catch {
    return null;
  }
}
