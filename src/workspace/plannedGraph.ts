// Adds the accepted, not-yet-written functions of a plan to the graph of the current code, so the Graph tab
// can show where the feature is heading while planning is still going on.
// Pure and free of the TypeScript compiler, so the browser preview can use it too.

import type { CodeGraph, GraphEdge, GraphNode, PlannedFunction } from "../shared/schema";

type Graph = Omit<CodeGraph, "builtAt">;

/**
 * Accepted "new" proposals become planned nodes; accepted "change" proposals mark the existing node as a
 * planned change. Their `calls` and `calledBy` names become planned edges when they name a node in the graph.
 * Names like `ForecastCache.get` resolve to the function that returns that type, planned or existing.
 */
export function projectPlan(graph: Graph, functions: PlannedFunction[]): Graph {
  const accepted = functions.filter((f) => f.status === "accepted");
  if (accepted.length === 0) return graph;

  const nodes: GraphNode[] = graph.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const planIds = new Map<PlannedFunction, string>();

  for (const f of accepted) {
    const existing = byId.get(`${f.path}#${f.name}`) ?? (f.change === "change" ? nodes.find((n) => n.name === f.name && n.path === f.path) : undefined);
    if (existing) {
      if (!existing.planned) Object.assign(existing, { status: "changed", planned: true, purpose: f.purpose, purposeSource: "plan" });
      planIds.set(f, existing.id);
      continue;
    }
    const node: GraphNode = {
      id: `${f.path}#${f.name}`,
      name: f.name,
      kind: f.kind,
      path: f.path,
      startLine: 1,
      endLine: 1,
      exported: true,
      bodyHash: "",
      purpose: f.purpose,
      purposeSource: "plan",
      status: "new",
      planned: true,
      ...returnTypes(f.signature),
    };
    nodes.push(node);
    byId.set(node.id, node);
    planIds.set(f, node.id);
  }

  const edges = new Map<string, GraphEdge>(graph.edges.map((e) => [e.id, e]));
  const resolve = (ref: string, self: string): { ids: string[]; kind: GraphEdge["kind"] } => {
    const found = findNode(nodes, ref, self);
    return found ? { ids: [found.node.id], kind: found.via === "name" || found.via === "file" ? "call" : "dispatch" } : { ids: [], kind: "call" };
  };

  const add = (from: string, to: string, kind: GraphEdge["kind"]) => {
    if (from === to) return;
    const id = `${from}->${to}`;
    if (edges.has(id)) return;
    const target = byId.get(to);
    edges.set(id, { id, from, to, kind: target?.kind === "route" ? "registers" : kind, planned: true });
  };

  // A caller's own `calls` say how it calls (directly or through an interface), so they go first.
  for (const f of accepted) {
    for (const ref of f.calls) {
      const { ids, kind } = resolve(ref, planIds.get(f)!);
      for (const to of ids) add(planIds.get(f)!, to, kind);
    }
  }
  for (const f of accepted) {
    for (const ref of f.calledBy) {
      for (const from of resolve(ref, planIds.get(f)!).ids) add(from, planIds.get(f)!, "call");
    }
  }
  return { ...graph, nodes, edges: [...edges.values()] };
}

/**
 * The node a name from a plan refers to: a function or route with that name, a file's module node
 * (`server.ts`), or for `Type.member` the member itself or else the function that returns `Type`.
 * `exclude` leaves out the function the name was written for. Shared with the panel, which links these names.
 */
export function findNode(
  nodes: GraphNode[],
  ref: string,
  exclude?: string,
): { node: GraphNode; via: "name" | "file" | "member" | "returns" } | undefined {
  const name = cleanRef(ref);
  const candidates = nodes.filter((n) => n.id !== exclude);
  const exact = candidates.filter((n) => n.name === name);
  if (exact.length) return { node: pick(exact), via: "name" };
  const file = candidates.filter((n) => n.path.split("/").pop() === name && n.kind !== "function" && n.kind !== "method");
  if (file.length) return { node: pick(file), via: "file" };
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const member = candidates.filter((n) => n.name === name.slice(dot + 1));
  if (member.length) return { node: pick(member), via: "member" };
  const type = name.slice(0, dot);
  const makers = candidates.filter((n) => n.kind !== "test" && n.returns?.includes(type));
  return makers.length ? { node: pick(makers), via: "returns" } : undefined;
}

/** Type names at the start of a proposal's return type, e.g. `ForecastCache` in `(...): ForecastCache<V>`. */
function returnTypes(signature: string): { returns?: string[] } {
  const match = /\)\s*:\s*(.+)$/.exec(signature);
  const names = match ? [...match[1]!.matchAll(/\b([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]!) : [];
  return names.length ? { returns: [...new Set(names)] } : {};
}

function cleanRef(ref: string): string {
  return ref.replace(/\(\)$/, "").trim();
}

/** Planned nodes win over existing ones with the same name, since the plan is what the user just decided. */
function pick(candidates: GraphNode[]): GraphNode {
  return candidates.find((n) => n.planned) ?? candidates[0]!;
}
