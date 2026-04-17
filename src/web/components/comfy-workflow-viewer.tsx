import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Minus, Plus, Maximize, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  normalizeGraph,
  nodeHeaderColor,
  type NormalizedGraph,
  type GraphNode,
  type GraphEdge,
} from "@/lib/comfy-graph-layout";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 1.15;
const PORT_R = 4;
const NODE_HEADER_H = 28;
const NODE_ROW_H = 22;

// ---------------------------------------------------------------------------
// Bezier edge SVG
// ---------------------------------------------------------------------------

function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dx = Math.abs(x2 - x1);
  const cp = Math.max(dx * 0.4, 50);
  return `M ${x1} ${y1} C ${x1 + cp} ${y1}, ${x2 - cp} ${y2}, ${x2} ${y2}`;
}

const Edges = memo(function Edges({
  edges,
  nodeMap,
}: {
  edges: GraphEdge[];
  nodeMap: Map<string, GraphNode>;
}) {
  const paths: React.ReactElement[] = [];
  for (const e of edges) {
    const src = nodeMap.get(e.srcNodeId);
    const dst = nodeMap.get(e.dstNodeId);
    if (!src || !dst) continue;

    const x1 = src.x + src.w;
    const y1 =
      src.y + NODE_HEADER_H + e.srcSlot * NODE_ROW_H + NODE_ROW_H / 2;
    const x2 = dst.x;
    const linkInputs = dst.inputs.filter((inp) => inp.isLink);
    const dstIdx = Math.min(e.dstSlot, linkInputs.length - 1);
    const y2 = dst.y + NODE_HEADER_H + Math.max(dstIdx, 0) * NODE_ROW_H + NODE_ROW_H / 2;

    paths.push(
      <path
        key={`${e.srcNodeId}-${e.srcSlot}-${e.dstNodeId}-${e.dstSlot}`}
        d={edgePath(x1, y1, x2, y2)}
        fill="none"
        stroke="#6b7280"
        strokeWidth={1.5}
        strokeOpacity={0.6}
      />,
    );
  }
  return <>{paths}</>;
});

// ---------------------------------------------------------------------------
// Single node
// ---------------------------------------------------------------------------

const WorkflowNode = memo(function WorkflowNode({
  node,
}: {
  node: GraphNode;
}) {
  const headerBg = nodeHeaderColor(node.classType);

  return (
    <div
      className="absolute select-none"
      style={{
        left: node.x,
        top: node.y,
        width: node.w,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center px-2 text-[11px] font-semibold text-white/90 truncate rounded-t"
        style={{
          height: NODE_HEADER_H,
          backgroundColor: headerBg,
        }}
      >
        {node.classType}
      </div>
      {/* Body */}
      <div className="bg-[#2a2a3d] border border-t-0 border-[#3a3a5c] rounded-b">
        {node.inputs.map((inp, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 px-2 text-[10px] leading-normal"
            style={{ height: NODE_ROW_H }}
          >
            {/* Input port dot */}
            {inp.isLink && (
              <span
                className="shrink-0 rounded-full bg-[#6b7280]"
                style={{ width: PORT_R * 2, height: PORT_R * 2 }}
              />
            )}
            <span className="text-[#a0a0b8] truncate">{inp.name}</span>
            {!inp.isLink && inp.value && (
              <span className="ml-auto text-[#e0e0e0] truncate font-mono text-[9px] max-w-[110px]">
                {inp.value}
              </span>
            )}
          </div>
        ))}
        {node.inputs.length === 0 && (
          <div style={{ height: NODE_ROW_H }} />
        )}
      </div>
      {/* Output ports (right side) */}
      {node.outputs.map((out, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-[#6b7280]"
          style={{
            width: PORT_R * 2,
            height: PORT_R * 2,
            right: -PORT_R,
            top: NODE_HEADER_H + i * NODE_ROW_H + NODE_ROW_H / 2 - PORT_R,
          }}
          title={out.name}
        />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Zoom controls
// ---------------------------------------------------------------------------

function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFitAll,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitAll: () => void;
  onReset: () => void;
}) {
  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-[#1a1a2e]/90 border border-[#3a3a5c] rounded-lg px-1 py-0.5 z-10">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-[#a0a0b8] hover:text-white hover:bg-[#3a3a5c]"
        onClick={onZoomOut}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className="text-[10px] text-[#a0a0b8] w-10 text-center tabular-nums select-none">
        {Math.round(zoom * 100)}%
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-[#a0a0b8] hover:text-white hover:bg-[#3a3a5c]"
        onClick={onZoomIn}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-[#a0a0b8] hover:text-white hover:bg-[#3a3a5c]"
        onClick={onReset}
        title="Reset (100%)"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-[#a0a0b8] hover:text-white hover:bg-[#3a3a5c]"
        onClick={onFitAll}
        title="Fit All"
      >
        <Maximize className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main viewer
// ---------------------------------------------------------------------------

export interface WorkflowMeta {
  fileName: string;
  model: string;
  width: number;
  height: number;
  seed: string;
  sampler: string;
  steps: number;
  cfgScale: number;
}

interface ComfyWorkflowViewerProps {
  raw: Record<string, unknown> | null;
  meta?: WorkflowMeta | null;
  loading?: boolean;
}

function MetaOverlay({ meta }: { meta: WorkflowMeta }) {
  const hasSeed = !!meta.seed;
  return (
    <div className="absolute bottom-3 left-3 bg-[#1a1a2e]/90 border border-[#3a3a5c] rounded-lg px-3 py-2 z-10 max-w-xs select-none">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px]">
        <span className="text-[#6b7280]">File</span>
        <span className="text-[#e0e0e0] truncate">{meta.fileName}</span>
        {meta.model && (
          <>
            <span className="text-[#6b7280]">Model</span>
            <span className="text-[#e0e0e0] truncate">{meta.model}</span>
          </>
        )}
        <span className="text-[#6b7280]">Size</span>
        <span className="text-[#e0e0e0] font-mono">
          {meta.width}×{meta.height}
        </span>
        {hasSeed && (
          <>
            <span className="text-[#6b7280]">Seed</span>
            <span className="text-[#e0e0e0] font-mono">{meta.seed}</span>
          </>
        )}
        {meta.sampler && (
          <>
            <span className="text-[#6b7280]">Sampler</span>
            <span className="text-[#e0e0e0] truncate">{meta.sampler}</span>
          </>
        )}
        {meta.steps > 0 && (
          <>
            <span className="text-[#6b7280]">Steps</span>
            <span className="text-[#e0e0e0] font-mono">{meta.steps}</span>
          </>
        )}
        {meta.cfgScale > 0 && (
          <>
            <span className="text-[#6b7280]">CFG</span>
            <span className="text-[#e0e0e0] font-mono">{meta.cfgScale}</span>
          </>
        )}
      </div>
    </div>
  );
}

export const ComfyWorkflowViewer = memo(function ComfyWorkflowViewer({
  raw,
  meta,
  loading = false,
}: ComfyWorkflowViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const graph: NormalizedGraph | null = useMemo(
    () => (raw ? normalizeGraph(raw) : null),
    [raw],
  );

  const nodeMap = useMemo(() => {
    if (!graph) return new Map<string, GraphNode>();
    return new Map(graph.nodes.map((n) => [n.id, n]));
  }, [graph]);

  // Fit all nodes into view
  const fitAll = useCallback(() => {
    if (!graph || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / graph.bounds.width;
    const scaleY = rect.height / graph.bounds.height;
    const newZoom = Math.min(scaleX, scaleY, 1) * 0.9;
    const cx = (rect.width - graph.bounds.width * newZoom) / 2;
    const cy = (rect.height - graph.bounds.height * newZoom) / 2;
    setZoom(newZoom);
    setPan({ x: cx, y: cy });
  }, [graph]);

  // Initial fit
  useEffect(() => {
    if (graph) fitAll();
  }, [graph, fitAll]);

  // Pan: mouse drag
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Zoom: wheel (cursor-centered)
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setPan((p) => ({
        x: mx - (mx - p.x) * (newZoom / zoom),
        y: my - (my - p.y) * (newZoom / zoom),
      }));
      setZoom(newZoom);
    },
    [zoom],
  );

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX_ZOOM, z * ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, z / ZOOM_STEP));
  }, []);


  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#1e1e2e]">
        <Loader2 className="h-6 w-6 animate-spin text-[#6b7280]" />
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#1e1e2e] text-[#6b7280] text-sm">
        No workflow data
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[#1e1e2e] cursor-grab active:cursor-grabbing"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          width: graph.bounds.width,
          height: graph.bounds.height,
          position: "relative",
        }}
      >
        {/* Edge layer */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={graph.bounds.width}
          height={graph.bounds.height}
        >
          <Edges edges={graph.edges} nodeMap={nodeMap} />
        </svg>

        {/* Node layer */}
        {graph.nodes.map((node) => (
          <WorkflowNode key={node.id} node={node} />
        ))}
      </div>

      {meta && <MetaOverlay meta={meta} />}
      <ZoomControls
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitAll={fitAll}
        onReset={fitAll}
      />
    </div>
  );
});
