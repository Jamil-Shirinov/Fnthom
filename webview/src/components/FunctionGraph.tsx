import { useMemo, useState, type CSSProperties } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { EDGE_COLORS, type CodeGraph, type GraphEdge, type GraphNode } from "../../../src/shared/schema";

const NODE_WIDTH = 230;
const NODE_HEIGHT = 62;

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
  calls: string[];
  calledBy: string[];
  onOpen: () => void;
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
      <Handle type="target" position={Position.Left} />
      <div className="fn__name" title={node.name}>
        {node.name}
      </div>
      <div className="fn__meta">
        <span className="fn__file">{file}</span>
        <span className="fn__kind">{KIND_LABEL[node.kind]}</span>
        {status && <span className={`badge badge--${node.status}`}>{status}</span>}
      </div>
      <Handle type="source" position={Position.Right} />

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
            <span>Calls</span> {data.calls.join(", ")}
          </div>
        )}
        {data.calledBy.length > 0 && (
          <div className="popup__rel">
            <span>Called by</span> {data.calledBy.join(", ")}
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

const nodeTypes = { fn: FunctionNodeView };

export function FunctionGraph(props: {
  graph: CodeGraph;
  showTests: boolean;
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
  onOpen: (nodeId: string) => void;
}) {
  const { graph, showTests, selectedId, onSelect, onOpen } = props;

  const visible = useMemo(() => {
    const nodes = graph.nodes.filter((n) => showTests || n.kind !== "test");
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  }, [graph, showTests]);

  const positions = useMemo(() => layout(visible.nodes, visible.edges), [visible]);
  const files = useMemo(() => [...new Set(graph.nodes.map((n) => n.path))].sort(), [graph]);

  const nodes = useMemo<FunctionFlowNode[]>(() => {
    const name = new Map(graph.nodes.map((n) => [n.id, n.name]));
    const neighbors = new Set(
      selectedId ? visible.edges.flatMap((e) => (e.from === selectedId ? [e.to] : e.to === selectedId ? [e.from] : [])) : [],
    );
    return visible.nodes.map((node) => ({
      id: node.id,
      type: "fn",
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        node,
        hue: fileHue(node.path, files),
        selected: node.id === selectedId,
        dimmed: !!selectedId && node.id !== selectedId && !neighbors.has(node.id),
        calls: visible.edges.filter((e) => e.from === node.id).map((e) => name.get(e.to) ?? e.to),
        calledBy: visible.edges.filter((e) => e.to === node.id).map((e) => name.get(e.from) ?? e.from),
        onOpen: () => onOpen(node.id),
        onClose: () => onSelect(null),
      },
      draggable: true,
      connectable: false,
      zIndex: node.id === selectedId ? 10 : 0,
    }));
  }, [visible, positions, files, graph, selectedId, onOpen, onSelect]);

  const edges = useMemo<Edge[]>(
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
  const kinds = useMemo(() => new Set(visible.edges.map((e) => e.kind)), [visible]);
  const [legendOpen, setLegendOpen] = useState(true);

  return (
    <div className="graph" aria-label="Function graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => {
          onSelect(node.id);
          const target = graph.nodes.find((n) => n.id === node.id);
          if (!(target?.planned && target.status === "new")) onOpen(node.id);
        }}
        onPaneClick={() => onSelect(null)}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        <Panel position="top-right">
          {legendOpen ? (
            <EdgeLegend present={kinds} onClose={() => setLegendOpen(false)} />
          ) : (
            <button type="button" className="legend-toggle" onClick={() => setLegendOpen(true)} aria-expanded={false}>
              Arrow colors
            </button>
          )}
        </Panel>
      </ReactFlow>
    </div>
  );
}

function EdgeLegend(props: { present: ReadonlySet<GraphEdge["kind"]>; onClose: () => void }) {
  return (
    <div className="edge-legend" role="dialog" aria-label="What the arrow colors mean">
      <div className="edge-legend__head">
        <strong>What the arrows mean</strong>
        <button type="button" className="icon" aria-label="Close legend" onClick={props.onClose}>
          ×
        </button>
      </div>
      <ul>
        {(Object.keys(EDGE_STYLE) as GraphEdge["kind"][]).map((kind) => {
          const style = EDGE_STYLE[kind];
          return (
            <li key={kind} className={props.present.has(kind) ? "" : "edge-legend__absent"}>
              <svg width="34" height="10" aria-hidden="true">
                <line x1="1" y1="5" x2="26" y2="5" stroke={style.color} strokeWidth="2.5" strokeDasharray={style.dash} />
                <path d="M26 1 L33 5 L26 9 Z" fill={style.color} />
              </svg>
              <div>
                <div className="edge-legend__label" style={{ color: style.color }}>
                  {style.label}
                  {!props.present.has(kind) && <span className="hint"> (none in this graph)</span>}
                </div>
                <div className="hint">{style.meaning}</div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="hint">
        Arrows point from the caller to the function it uses. Faded arrows are planned and not in the code yet. Click a box to highlight its arrows.
      </div>
    </div>
  );
}

/** Left-to-right layers: callers on the left, the functions they call to the right. */
function layout(nodes: GraphNode[], edges: CodeGraph["edges"]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    if (p) positions.set(n.id, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 });
  }
  return positions;
}
