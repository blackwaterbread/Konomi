// ---------------------------------------------------------------------------
// ComfyUI graph normalization + auto-layout for the workflow viewer
// ---------------------------------------------------------------------------

/** Normalized node for rendering */
export interface GraphNode {
  id: string;
  classType: string;
  x: number;
  y: number;
  w: number;
  h: number;
  inputs: { name: string; value: string; isLink: boolean }[];
  outputs: { name: string; slot: number }[];
}

/** Normalized edge for rendering */
export interface GraphEdge {
  srcNodeId: string;
  srcSlot: number;
  dstNodeId: string;
  dstSlot: number;
}

/** Full normalized graph ready for the viewer */
export interface NormalizedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  bounds: { width: number; height: number };
}

// ---------------------------------------------------------------------------
// Prompt graph types (ComfyUI API format)
// ---------------------------------------------------------------------------

interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

type ComfyPrompt = Record<string, ComfyNode>;

function isLink(v: unknown): v is [string | number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    (typeof v[0] === "string" || typeof v[0] === "number") &&
    typeof v[1] === "number"
  );
}

// ---------------------------------------------------------------------------
// Workflow types (ComfyUI UI format with positions)
// ---------------------------------------------------------------------------

interface WorkflowNodeIO {
  name: string;
  type: string;
  link?: number | number[] | null;
}

interface WorkflowNode {
  id: number;
  type: string;
  pos?: [number, number] | { 0: number; 1: number };
  size?: [number, number] | { 0: number; 1: number };
  inputs?: WorkflowNodeIO[];
  outputs?: WorkflowNodeIO[];
  widgets_values?: unknown[];
}

interface WorkflowLink {
  0: number; // link id
  1: number; // src node id
  2: number; // src slot
  3: number; // dst node id
  4: number; // dst slot
  5: string; // type
}

interface ComfyWorkflow {
  nodes?: WorkflowNode[];
  links?: (WorkflowLink | number[])[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NODE_W = 220;
const NODE_HEADER_H = 28;
const NODE_ROW_H = 22;
const LAYOUT_GAP_X = 280;
const LAYOUT_GAP_Y = 24;
const LAYOUT_PADDING = 40;

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.length > 40 ? v.slice(0, 37) + "..." : v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return "";
}

function calcNodeHeight(inputCount: number): number {
  return NODE_HEADER_H + Math.max(inputCount, 1) * NODE_ROW_H + 8;
}

function twoArr(v: unknown): [number, number] {
  if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v[1]) || 0];
  if (v && typeof v === "object")
    return [
      Number((v as Record<string, unknown>)["0"]) || 0,
      Number((v as Record<string, unknown>)["1"]) || 0,
    ];
  return [0, 0];
}

// ---------------------------------------------------------------------------
// Normalize from ComfyUI API Prompt graph (no positions → auto-layout)
// ---------------------------------------------------------------------------

function normalizeFromPrompt(prompt: ComfyPrompt): NormalizedGraph {
  const edges: GraphEdge[] = [];
  const outputSlots = new Map<string, Map<number, string>>(); // nodeId → slot → outputName

  // First pass: collect edges and infer output names
  for (const [nodeId, node] of Object.entries(prompt)) {
    let inputSlot = 0;
    for (const [key, val] of Object.entries(node.inputs)) {
      if (isLink(val)) {
        const srcId = String(val[0]);
        const srcSlot = val[1];
        edges.push({
          srcNodeId: srcId,
          srcSlot,
          dstNodeId: nodeId,
          dstSlot: inputSlot,
        });
        if (!outputSlots.has(srcId)) outputSlots.set(srcId, new Map());
        outputSlots.get(srcId)!.set(srcSlot, key);
      }
      inputSlot++;
    }
  }

  // Build nodes
  const rawNodes = new Map<string, GraphNode>();
  for (const [nodeId, node] of Object.entries(prompt)) {
    const inputs: GraphNode["inputs"] = [];
    for (const [key, val] of Object.entries(node.inputs)) {
      inputs.push({
        name: key,
        value: isLink(val) ? "" : formatValue(val),
        isLink: isLink(val),
      });
    }
    const outs = outputSlots.get(nodeId);
    const outputs: GraphNode["outputs"] = [];
    if (outs) {
      for (const [slot, name] of [...outs.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        outputs.push({ name, slot });
      }
    }

    rawNodes.set(nodeId, {
      id: nodeId,
      classType: node.class_type,
      x: 0,
      y: 0,
      w: NODE_W,
      h: calcNodeHeight(inputs.length),
      inputs,
      outputs,
    });
  }

  // Topological depth assignment (BFS from sinks)
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    if (!children.has(e.srcNodeId)) children.set(e.srcNodeId, []);
    children.get(e.srcNodeId)!.push(e.dstNodeId);
    if (!parents.has(e.dstNodeId)) parents.set(e.dstNodeId, []);
    parents.get(e.dstNodeId)!.push(e.srcNodeId);
  }

  const depth = new Map<string, number>();
  // Find sink nodes (no children)
  const sinks = [...rawNodes.keys()].filter(
    (id) => !children.has(id) || children.get(id)!.length === 0,
  );

  const queue = sinks.map((id) => ({ id, d: 0 }));
  for (const s of sinks) depth.set(s, 0);

  const maxIterations = rawNodes.size * rawNodes.size;
  let iterations = 0;
  while (queue.length > 0 && iterations < maxIterations) {
    iterations++;
    const { id, d } = queue.shift()!;
    for (const p of parents.get(id) ?? []) {
      const newD = d + 1;
      if (!depth.has(p) || depth.get(p)! < newD) {
        depth.set(p, newD);
        queue.push({ id: p, d: newD });
      }
    }
  }

  // Assign depth 0 to orphan nodes
  for (const id of rawNodes.keys()) {
    if (!depth.has(id)) depth.set(id, 0);
  }

  const maxDepth = Math.max(...depth.values(), 0);

  // Group by depth level, reverse so sources are on the left
  const levels = new Map<number, string[]>();
  for (const [id, d] of depth) {
    const col = maxDepth - d;
    if (!levels.has(col)) levels.set(col, []);
    levels.get(col)!.push(id);
  }

  // Position nodes
  let totalW = 0;
  let totalH = 0;
  for (const col of [...levels.keys()].sort((a, b) => a - b)) {
    const ids = levels.get(col)!;
    let y = LAYOUT_PADDING;
    for (const id of ids) {
      const node = rawNodes.get(id)!;
      node.x = LAYOUT_PADDING + col * LAYOUT_GAP_X;
      node.y = y;
      y += node.h + LAYOUT_GAP_Y;
      totalW = Math.max(totalW, node.x + node.w);
      totalH = Math.max(totalH, node.y + node.h);
    }
  }

  return {
    nodes: [...rawNodes.values()],
    edges,
    bounds: {
      width: totalW + LAYOUT_PADDING,
      height: totalH + LAYOUT_PADDING,
    },
  };
}

// ---------------------------------------------------------------------------
// Normalize from ComfyUI Workflow (has positions)
// ---------------------------------------------------------------------------

function normalizeFromWorkflow(workflow: ComfyWorkflow): NormalizedGraph {
  const wfNodes = workflow.nodes ?? [];
  const wfLinks = (workflow.links ?? []) as (WorkflowLink | number[])[];

  const edges: GraphEdge[] = [];
  // Build link lookup: linkId → { srcNodeId, srcSlot }
  const linkSrcMap = new Map<
    number,
    { srcNodeId: number; srcSlot: number; dstNodeId: number; dstSlot: number }
  >();
  for (const link of wfLinks) {
    const arr = Array.isArray(link)
      ? link
      : [link[0], link[1], link[2], link[3], link[4]];
    const linkId = Number(arr[0]);
    linkSrcMap.set(linkId, {
      srcNodeId: Number(arr[1]),
      srcSlot: Number(arr[2]),
      dstNodeId: Number(arr[3]),
      dstSlot: Number(arr[4]),
    });
    edges.push({
      srcNodeId: String(arr[1]),
      srcSlot: Number(arr[2]),
      dstNodeId: String(arr[3]),
      dstSlot: Number(arr[4]),
    });
  }

  let minX = Infinity;
  let minY = Infinity;

  const nodes: GraphNode[] = wfNodes.map((wn) => {
    const [px, py] = wn.pos ? twoArr(wn.pos) : [0, 0];
    const [sw, sh] = wn.size ? twoArr(wn.size) : [NODE_W, 100];
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);

    const inputs: GraphNode["inputs"] = (wn.inputs ?? []).map((inp) => ({
      name: inp.name,
      value: "",
      isLink: inp.link != null,
    }));

    const outputs: GraphNode["outputs"] = (wn.outputs ?? []).map((out, i) => ({
      name: out.name,
      slot: i,
    }));

    return {
      id: String(wn.id),
      classType: wn.type,
      x: px,
      y: py,
      w: Math.max(sw, 140),
      h: Math.max(sh, 60),
      inputs,
      outputs,
    };
  });

  // Normalize positions so top-left is at padding
  const offsetX = minX - LAYOUT_PADDING;
  const offsetY = minY - LAYOUT_PADDING;
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    n.x -= offsetX;
    n.y -= offsetY;
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }

  return {
    nodes,
    edges,
    bounds: {
      width: maxX + LAYOUT_PADDING,
      height: maxY + LAYOUT_PADDING,
    },
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function normalizeGraph(
  raw: Record<string, unknown>,
): NormalizedGraph | null {
  try {
    // Case 1: API prompt graph
    if (raw.prompt && typeof raw.prompt === "object") {
      return normalizeFromPrompt(raw.prompt as ComfyPrompt);
    }
    // Case 2: Workflow with nodes
    if (raw.workflow && typeof raw.workflow === "object") {
      return normalizeFromWorkflow(raw.workflow as ComfyWorkflow);
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Node color classification
// ---------------------------------------------------------------------------

export function nodeHeaderColor(classType: string): string {
  const ct = classType.toLowerCase();
  if (/ksampler/i.test(ct)) return "#7f5539";
  if (/cliptext|cliptextencode/i.test(ct)) return "#2d6a4f";
  if (/checkpoint|loader.*ckpt/i.test(ct)) return "#6930c3";
  if (/loraloader/i.test(ct)) return "#c1121f";
  if (/emptylatent/i.test(ct)) return "#1d3557";
  if (/save|preview|output/i.test(ct)) return "#606c38";
  if (/vae/i.test(ct)) return "#9d4edd";
  if (/controlnet|ipadapter/i.test(ct)) return "#e07a5f";
  if (/efficient/i.test(ct)) return "#d4a373";
  return "#374151";
}
