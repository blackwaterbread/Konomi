import { describe, expect, it } from "vitest";
import { normalizeGraph } from "@/lib/comfy-graph-layout";

describe("normalizeGraph", () => {
  it("returns null for data with neither prompt nor workflow", () => {
    expect(normalizeGraph({ random: "data" })).toBeNull();
  });

  it("normalizes a prompt graph with auto-layout", () => {
    const raw = {
      prompt: {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: { ckpt_name: "model.safetensors" },
        },
        "2": {
          class_type: "CLIPTextEncode",
          inputs: { text: "1girl", clip: ["1", 1] },
        },
        "3": {
          class_type: "KSampler",
          inputs: {
            model: ["1", 0],
            positive: ["2", 0],
            seed: 42,
            steps: 28,
          },
        },
      },
    };

    const graph = normalizeGraph(raw);
    expect(graph).not.toBeNull();
    expect(graph!.nodes).toHaveLength(3);
    expect(graph!.edges).toHaveLength(3);
    expect(graph!.bounds.width).toBeGreaterThan(0);
    expect(graph!.bounds.height).toBeGreaterThan(0);

    // Source nodes should be left of sinks
    const nodeMap = new Map(graph!.nodes.map((n) => [n.id, n]));
    expect(nodeMap.get("1")!.x).toBeLessThan(nodeMap.get("3")!.x);
  });

  it("handles orphan nodes (no edges) without crashing", () => {
    const raw = {
      prompt: {
        "1": { class_type: "NodeA", inputs: { val: "hello" } },
        "2": { class_type: "NodeB", inputs: { val: 42 } },
      },
    };

    const graph = normalizeGraph(raw);
    expect(graph).not.toBeNull();
    expect(graph!.nodes).toHaveLength(2);
    expect(graph!.edges).toHaveLength(0);
  });

  it("survives cyclic graphs without infinite loop", () => {
    const raw = {
      prompt: {
        "1": {
          class_type: "NodeA",
          inputs: { input: ["2", 0] },
        },
        "2": {
          class_type: "NodeB",
          inputs: { input: ["1", 0] },
        },
      },
    };

    const graph = normalizeGraph(raw);
    expect(graph).not.toBeNull();
    expect(graph!.nodes).toHaveLength(2);
  });

  it("normalizes a workflow with existing positions", () => {
    const raw = {
      workflow: {
        nodes: [
          { id: 1, type: "NodeA", pos: [100, 200], size: [220, 100], inputs: [], outputs: [{ name: "out", type: "MODEL" }] },
          { id: 2, type: "NodeB", pos: [400, 200], size: [220, 100], inputs: [{ name: "in", type: "MODEL", link: 1 }], outputs: [] },
        ],
        links: [[1, 1, 0, 2, 0, "MODEL"]],
      },
    };

    const graph = normalizeGraph(raw);
    expect(graph).not.toBeNull();
    expect(graph!.nodes).toHaveLength(2);
    expect(graph!.edges).toHaveLength(1);

    // Positions should be normalized (offset to padding)
    const nodeA = graph!.nodes.find((n) => n.id === "1")!;
    expect(nodeA.x).toBeGreaterThanOrEqual(0);
    expect(nodeA.y).toBeGreaterThanOrEqual(0);
  });

  it("returns null for empty workflow", () => {
    expect(normalizeGraph({ workflow: { nodes: [], links: [] } })).toMatchObject({
      nodes: [],
      edges: [],
    });
  });
});
