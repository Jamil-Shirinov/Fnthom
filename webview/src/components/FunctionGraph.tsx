import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useInternalNode,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { EDGE_COLORS, type CodeGraph, type GraphEdge, type GraphNode } from "../../../src/shared/schema";
import { clusterGraph, metaEdges, type Cluster, type MetaEdge } from "../../../src/workspace/clusters";

const NODE_WIDTH = 230;
const NODE_HEIGHT = 62;

// Level of detail, like a map: below OVERVIEW_BELOW the graph shows one blob per cluster, above DETAIL_ABOVE the
// functions. The gap between the two keeps the view from flickering at the boundary.
const OVERVIEW_BELOW = 0.34;
const DETAIL_ABOVE = 0.41;
/** Zoom used when the user opens a cluster; comfortably inside the detail range. */
const OPEN_CLUSTER_ZOOM = 0.8;

// Text carries the kind and status as well as color, so the graph reads without color vision.
const KIND_LABEL: Record<GraphNode["kind"], string> = {
  function: "function",
  method: "method",
  route: "route",
  module: "entry",
  test: "tests",
};
const STATUS_LABEL: Record<GraphNode["status"], string | null> = { new: "New", changed: "Changed", unchanged: null };
const PLANNED_LABEL: Record<GraphNode["status"], string | null> = { new: "Planned", changed: "Change planned", unchanged: null };

/**
 * One color per kind of connection, mid-tones that read on light and dark themes and stay clear of the
 * green/yellow used for new/changed nodes. Each kind also has its own dash pattern for color-blind readers.
 */
export const EDGE_STYLE: Record<GraphEdge["kind"], { color: string; dash?: string; label: string; meaning: string }> = {
  call: { color: EDGE_COLORS.call, label: "Direct call", meaning: "The function calls the other one by name." },
  dispatch: {
    color: EDGE_COLORS.dispatch,
    dash: "6 4",
    label: "Call through an interface",
    meaning: "The call goes through an interface or object type (like upstream.fetchForecast); any function that returns that type may be the one that runs.",
  },
  registers: {
    color: EDGE_COLORS.registers,
    dash: "2 3",
    label: "Registers a route",
    meaning: "The function sets up an HTTP route; the route's handler runs when a request arrives.",
  },
};

/** One stable hue per file, so functions from the same file read as a group. */
const FILE_HUES = [210, 32, 140, 280, 350, 180, 60, 250, 0, 100];
export function fileHue(path: string, files: string[]): number {
  return FILE_HUES[files.indexOf(path) % FILE_HUES.length] ?? 210;
}

type FunctionNodeData = {
  node: GraphNode;
  hue: number;
  selected: boolean;
  dimmed: boolean;
  calls: GraphNode[];
  calledBy: GraphNode[];
  onOpen: () => void;
  onJump: (node: GraphNode) => void;
  onClose: () => void;
};
type FunctionFlowNode = Node<FunctionNodeData, "fn">;

function FunctionNodeView({ data }: NodeProps<FunctionFlowNode>) {
  const { node, hue, selected, dimmed } = data;
  const status = node.planned ? PLANNED_LABEL[node.status] : STATUS_LABEL[node.status];
  const unwritten = node.planned && node.status === "new";
  const file = node.path.split("/").pop();
  return (
    <div
      className={`fn fn--${node.status}${node.planned ? " fn--planned" : ""}${selected ? " fn--selected" : ""}${dimmed ? " fn--dimmed" : ""}`}
      style={{ "--file-hue": hue } as CSSProperties}
    >
      <Handle type="target" position={Position.Top} />
      <div className="fn__name" title={node.name}>
        {node.name}
      </div>
      <div className="fn__meta">
        <span className="fn__file">{file}</span>
        <span className="fn__kind">{KIND_LABEL[node.kind]}</span>
        {status && <span className={`badge badge--${node.status}`}>{status}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />

      <NodeToolbar isVisible={selected} position={Position.Bottom} offset={12} className="popup" align="start">
        <div className="popup__head">
          <strong>{node.name}</strong>
          <button type="button" className="icon" aria-label="Close" onClick={(e) => (e.stopPropagation(), data.onClose())}>
            ×
          </button>
        </div>
        <div className="popup__where">
          <code>{unwritten ? node.path : `${node.path}:${node.startLine}-${node.endLine}`}</code>
          {status && <span className={`badge badge--${node.status}`}>{node.planned ? status : `${status} in this feature`}</span>}
        </div>
        <p className={node.purpose ? "" : "hint"}>{node.purpose ?? "No description yet."}</p>
        {node.purposeSource && (
          <div className="popup__source">
            {node.purposeSource === "plan" ? "From the plan you accepted" : node.purposeSource === "comment" ? "From the code's comment" : "Described by the agent"}
          </div>
        )}
        {data.calls.length > 0 && (
          <div className="popup__rel">
            <span>Calls</span> <NodeLinks nodes={data.calls} onJump={data.onJump} />
          </div>
        )}
        {data.calledBy.length > 0 && (
          <div className="popup__rel">
            <span>Called by</span> <NodeLinks nodes={data.calledBy} onJump={data.onJump} />
          </div>
        )}
        {unwritten ? (
          <div className="hint">Accepted in the plan. The code is written once every function is planned.</div>
        ) : (
          <>
            {node.planned && <div className="hint">The change is planned; the editor shows the current code.</div>}
            <button type="button" className="link" onClick={(e) => (e.stopPropagation(), data.onOpen())}>
              Show in editor
            </button>
          </>
        )}
      </NodeToolbar>
    </div>
  );
}

/** Names in a pop-up that move the selection to that function and open its code. */
function NodeLinks(props: { nodes: GraphNode[]; onJump: (node: GraphNode) => void }) {
  return (
    <>
      {props.nodes.map((n, i) => (
        <span key={n.id}>
          {i > 0 && ", "}
          <button type="button" className="code-link" title={`${n.path}:${n.startLine}`} onClick={(e) => (e.stopPropagation(), props.onJump(n))}>
            {n.name}
          </button>
        </span>
      ))}
    </>
  );
}

type RegionNodeData = { cluster: Cluster; hue: number };
type RegionFlowNode = Node<RegionNodeData, "region">;

/** The faint outline behind a cluster's functions in the detailed view, so the groups stay visible up close. */
function RegionNodeView({ data }: NodeProps<RegionFlowNode>) {
  return (
    <div className="region" style={{ "--cluster-hue": data.hue } as CSSProperties}>
      <span className="region__label">{data.cluster.name}</span>
    </div>
  );
}

type ClusterNodeData = {
  cluster: Cluster;
  hue: number;
  counts: { new: number; changed: number; planned: number };
  holdsSelection: boolean;
  onOpen: () => void;
};
type ClusterFlowNode = Node<ClusterNodeData, "cluster">;

/** A cluster drawn as a circle when zoomed out. Its text keeps a readable size at any zoom. */
function ClusterNodeView({ data, width }: NodeProps<ClusterFlowNode>) {
  const zoom = useStore((s) => s.transform[2]);
  const { cluster, counts } = data;
  const files = cluster.paths.length;
  // Keep the text a constant size on screen, but never wider than the circle.
  const scale = Math.min(1 / zoom, ((width ?? 200) * 0.8) / 150);
  return (
    <div
      className={`blob${data.holdsSelection ? " blob--selected" : ""}`}
      style={{ "--cluster-hue": data.hue } as CSSProperties}
      title={`${cluster.name}: ${cluster.paths.join(", ")}`}
      onDoubleClick={data.onOpen}
    >
      <Handle type="target" position={Position.Top} className="blob__handle" />
      <div className="blob__text" style={{ transform: `scale(${scale})` }}>
        <strong>{cluster.name}</strong>
        <span>
          {cluster.nodeIds.length} {cluster.nodeIds.length === 1 ? "function" : "functions"} · {files} {files === 1 ? "file" : "files"}
        </span>
        {(counts.new > 0 || counts.changed > 0 || counts.planned > 0) && (
          <span className="blob__badges">
            {counts.new > 0 && <span className="badge badge--new">{counts.new} new</span>}
            {counts.changed > 0 && <span className="badge badge--changed">{counts.changed} changed</span>}
            {counts.planned > 0 && <span className="badge">{counts.planned} planned</span>}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="blob__handle" />
    </div>
  );
}

const nodeTypes = { fn: FunctionNodeView, region: RegionNodeView, cluster: ClusterNodeView };

type MetaFlowEdge = Edge<{ meta: MetaEdge; bend: number }, "meta">;

/**
 * An arrow between two cluster circles: from rim to rim along the line between their centers, bent a little
 * so the two directions of a pair do not overlap. Its width stays the same on screen at any zoom.
 */
function MetaEdgeView({ id, source, target, data, markerEnd, style }: EdgeProps<MetaFlowEdge>) {
  const zoom = useStore((s) => s.transform[2]);
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  if (!from || !to || !data) return null;
  const circle = (n: typeof from) => {
    const w = n.measured.width ?? 0;
    return { x: n.internals.positionAbsolute.x + w / 2, y: n.internals.positionAbsolute.y + w / 2, r: w / 2 };
  };
  const a = circle(from);
  const b = circle(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / length, dy / length];
  const start = { x: a.x + ux * a.r, y: a.y + uy * a.r };
  const end = { x: b.x - ux * (b.r + 4 / zoom), y: b.y - uy * (b.r + 4 / zoom) };
  const bend = data.bend * Math.min(length * 0.15, 120);
  const control = { x: (start.x + end.x) / 2 - uy * bend, y: (start.y + end.y) / 2 + ux * bend };
  const path = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  const width = (1.5 + 1.2 * Math.log2(data.meta.count)) / zoom;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: width }} />
      <text
        className="meta-edge__label"
        x={(start.x + 2 * control.x + end.x) / 4}
        y={(start.y + 2 * control.y + end.y) / 4}
        style={{ fontSize: 11 / zoom, strokeWidth: 3 / zoom }}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {data.meta.count}
      </text>
    </>
  );
}

const edgeTypes = { meta: MetaEdgeView };

type GraphProps = {
  graph: CodeGraph;
  showTests: boolean;
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
  onOpen: (nodeId: string) => void;
};

export function FunctionGraph(props: GraphProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

function GraphCanvas(props: GraphProps) {
  const { graph, showTests, selectedId, onSelect, onOpen } = props;
  const flow = useReactFlow();

  const visible = useMemo(() => {
    const nodes = graph.nodes.filter((n) => showTests || n.kind !== "test");
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  }, [graph, showTests]);

  const clusters = useMemo(() => clusterGraph(visible.nodes, visible.edges), [visible]);
  const grouped = clusters.length > 1;
  const { positions, boxes } = useMemo(() => layout(visible.nodes, visible.edges, grouped ? clusters : []), [visible, clusters, grouped]);
  const files = useMemo(() => [...new Set(graph.nodes.map((n) => n.path))].sort(), [graph]);
  const clusterOf = useMemo(() => new Map(clusters.flatMap((c) => c.nodeIds.map((id) => [id, c] as const))), [clusters]);

  const [overview, setOverview] = useState(false);
  const zoomToCluster = (cluster: Cluster) => {
    const box = boxes.get(cluster.id);
    if (!box) return;
    const { width, height } = flowSize.current;
    const fit = Math.min(width / (box.width + 80), height / (box.height + 80));
    void flow.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom: Math.min(1.1, Math.max(OPEN_CLUSTER_ZOOM, fit)), duration: 500 });
  };
  const flowSize = useRef({ width: 800, height: 600 });

  // A function chosen elsewhere (a link on a proposal card) while zoomed out: fly to it.
  useEffect(() => {
    if (!selectedId || !overview) return;
    const p = positions.get(selectedId);
    if (p) void flow.setCenter(p.x + NODE_WIDTH / 2, p.y + NODE_HEIGHT / 2, { zoom: 0.9, duration: 500 });
    // Only when the selection changes, not when the zoom does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const functionNodes = useMemo<Node[]>(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const neighbors = new Set(
      selectedId ? visible.edges.flatMap((e) => (e.from === selectedId ? [e.to] : e.to === selectedId ? [e.from] : [])) : [],
    );
    const fns: FunctionFlowNode[] = visible.nodes.map((node) => ({
      id: node.id,
      type: "fn",
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        node,
        hue: fileHue(node.path, files),
        selected: node.id === selectedId,
        dimmed: !!selectedId && node.id !== selectedId && !neighbors.has(node.id),
        calls: visible.edges.filter((e) => e.from === node.id).flatMap((e) => byId.get(e.to) ?? []),
        calledBy: visible.edges.filter((e) => e.to === node.id).flatMap((e) => byId.get(e.from) ?? []),
        onOpen: () => onOpen(node.id),
        onJump: (target) => {
          onSelect(target.id);
          if (!(target.planned && target.status === "new")) onOpen(target.id);
        },
        onClose: () => onSelect(null),
      },
      draggable: true,
      connectable: false,
      zIndex: node.id === selectedId ? 10 : 0,
    }));
    const regions: RegionFlowNode[] = grouped
      ? clusters.flatMap((cluster, k) => {
          const box = boxes.get(cluster.id);
          if (!box) return [];
          return [
            {
              id: `region:${cluster.id}`,
              type: "region",
              position: { x: box.x, y: box.y },
              style: { width: box.width, height: box.height },
              data: { cluster, hue: clusterHue(k) },
              selectable: false,
              draggable: false,
              connectable: false,
              focusable: false,
              zIndex: -1,
            },
          ];
        })
      : [];
    return [...regions, ...fns];
  }, [visible, positions, boxes, clusters, grouped, files, graph, selectedId, onOpen, onSelect]);

  const functionEdges = useMemo<Edge[]>(
    () =>
      visible.edges.map((edge) => {
        const touched = selectedId && (edge.from === selectedId || edge.to === selectedId);
        const style = EDGE_STYLE[edge.kind];
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          markerEnd: { type: MarkerType.ArrowClosed, color: style.color, width: 18, height: 18 },
          style: { stroke: style.color, strokeWidth: touched ? 3 : 1.75, ...(style.dash ? { strokeDasharray: style.dash } : {}) },
          className: `call call--${edge.kind}${edge.planned ? " call--planned" : ""}${selectedId && !touched ? " call--dimmed" : ""}`,
          animated: !!touched,
          ...(edge.kind === "registers" ? { label: "route", labelStyle: { fill: style.color } } : {}),
        };
      }),
    [visible, selectedId],
  );

  const clusterNodes = useMemo<ClusterFlowNode[]>(() => {
    const byId = new Map(visible.nodes.map((n) => [n.id, n]));
    const selectedCluster = selectedId ? clusterOf.get(selectedId)?.id : undefined;
    const circles = placeCircles(clusters, boxes);
    return clusters.flatMap((cluster, k) => {
      const circle = circles.get(cluster.id);
      if (!circle) return [];
      const size = circle.r * 2;
      const members = cluster.nodeIds.map((id) => byId.get(id)!).filter(Boolean);
      return [
        {
          id: cluster.id,
          type: "cluster",
          position: { x: circle.x - circle.r, y: circle.y - circle.r },
          width: size,
          height: size,
          style: { width: size, height: size },
          data: {
            cluster,
            hue: clusterHue(k),
            counts: {
              new: members.filter((n) => n.status === "new" && !n.planned).length,
              changed: members.filter((n) => n.status === "changed" && !n.planned).length,
              planned: members.filter((n) => n.planned).length,
            },
            holdsSelection: cluster.id === selectedCluster,
            onOpen: () => zoomToCluster(cluster),
          },
          draggable: false,
          connectable: false,
        },
      ];
    });
    // zoomToCluster only reads layout data that is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, boxes, visible, selectedId, clusterOf]);

  const clusterEdges = useMemo<MetaFlowEdge[]>(() => {
    const meta = metaEdges(clusters, visible.edges);
    const pairs = new Set(meta.map((m) => `${m.from}->${m.to}`));
    return meta.map((m) => {
      const style = EDGE_STYLE[m.kind];
      return {
        id: `meta:${m.id}`,
        type: "meta",
        source: m.from,
        target: m.to,
        data: { meta: m, bend: pairs.has(`${m.to}->${m.from}`) ? 1 : 0.35 },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.color, width: 14, height: 14 },
        style: { stroke: style.color, ...(m.planned ? { strokeDasharray: "8 6", opacity: 0.6 } : {}) },
        className: `meta-edge meta-edge--${m.kind}`,
      };
    });
  }, [clusters, visible]);

  const showOverview = grouped && overview;

  return (
    <div className="graph" aria-label="Function graph">
      <ReactFlow
        nodes={showOverview ? clusterNodes : functionNodes}
        edges={showOverview ? clusterEdges : functionEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => {
          if (node.type === "cluster") return zoomToCluster((node as ClusterFlowNode).data.cluster);
          if (node.type !== "fn") return;
          onSelect(node.id);
          const target = graph.nodes.find((n) => n.id === node.id);
          if (!(target?.planned && target.status === "new")) onOpen(node.id);
        }}
        onPaneClick={() => onSelect(null)}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.1, minZoom: 0.05 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <ZoomLevel
          overview={overview}
          onChange={setOverview}
          onSize={(width, height) => {
            flowSize.current = { width, height };
          }}
        />
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        {showOverview && (
          <Panel position="bottom-center" className="lod-hint">
            Zoomed out: functions are grouped by what they do. Click a group or zoom in to see its functions.
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

/** Watches the zoom and switches between the detailed and the clustered view, with some slack at the boundary. */
function ZoomLevel(props: { overview: boolean; onChange: (overview: boolean) => void; onSize: (width: number, height: number) => void }) {
  const zoom = useStore((s) => s.transform[2]);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const { overview, onChange, onSize } = props;
  useEffect(() => {
    if (!overview && zoom < OVERVIEW_BELOW) onChange(true);
    else if (overview && zoom > DETAIL_ABOVE) onChange(false);
  }, [zoom, overview, onChange]);
  useEffect(() => onSize(width, height), [width, height, onSize]);
  return null;
}

/**
 * One circle per cluster, centered where its functions are, so zooming out keeps everything in place. Circles
 * grow with the area their functions take up and are then nudged apart until none overlap.
 */
function placeCircles(clusters: Cluster[], boxes: Map<string, Box>) {
  const circles = new Map<string, { x: number; y: number; r: number }>();
  for (const c of clusters) {
    const box = boxes.get(c.id);
    if (box) circles.set(c.id, { x: box.x + box.width / 2, y: box.y + box.height / 2, r: Math.max(110, Math.sqrt(box.width * box.height) * 0.36) });
  }
  const list = [...circles.values()];
  const gap = 60;
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d === 0) [dx, dy, d] = [1, 0, 1];
        const overlap = a.r + b.r + gap - d;
        if (overlap <= 0) continue;
        const push = overlap / 2 / d;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return circles;
}

const CLUSTER_HUES = [205, 28, 145, 275, 340, 175, 55, 240, 5, 95, 310, 125];
function clusterHue(index: number): number {
  return CLUSTER_HUES[index % CLUSTER_HUES.length]!;
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * Top-to-bottom layers: callers above the functions they call. With clusters, each cluster is laid out as one
 * compound block, so its functions stay together and the block becomes the cluster's circle when zoomed out.
 */
function layout(nodes: GraphNode[], edges: CodeGraph["edges"], clusters: Cluster[]) {
  const run = (compound: boolean) => {
    const g = new dagre.graphlib.Graph({ compound });
    g.setGraph({ rankdir: "TB", nodesep: 36, ranksep: 72, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    if (compound) {
      for (const c of clusters) {
        g.setNode(c.id, {});
        for (const id of c.nodeIds) g.setParent(id, c.id);
      }
    }
    for (const e of edges) g.setEdge(e.from, e.to);
    dagre.layout(g);
    return g;
  };
  let g: ReturnType<typeof run>;
  try {
    g = run(clusters.length > 1);
  } catch {
    g = run(false);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    if (p) positions.set(n.id, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 });
  }
  // Cluster boxes from their members, padded, so they are right even when dagre could not lay out compounds.
  const boxes = new Map<string, Box>();
  const pad = 24;
  for (const c of clusters) {
    const points = c.nodeIds.flatMap((id) => positions.get(id) ?? []);
    if (!points.length) continue;
    const x = Math.min(...points.map((p) => p.x)) - pad;
    const y = Math.min(...points.map((p) => p.y)) - pad - 14;
    const right = Math.max(...points.map((p) => p.x + NODE_WIDTH)) + pad;
    const bottom = Math.max(...points.map((p) => p.y + NODE_HEIGHT)) + pad;
    boxes.set(c.id, { x, y, width: right - x, height: bottom - y });
  }
  return { positions, boxes };
}
