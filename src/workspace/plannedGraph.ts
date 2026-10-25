// Adds the accepted, not-yet-written functions of a plan to the graph of the current code, so the Graph tab
// can show where the feature is heading while planning is still going on.
// Pure and free of the TypeScript compiler, so the browser preview can use it too.

import type { CodeGraph, GraphEdge, GraphNode, PlannedFunction } from "../shared/schema";

type Graph = Omit<CodeGraph, "builtAt">;

/**
 * Accepted "new" proposals become planned nodes; accepted "change" proposals mark the existing node as a
 * planned change. Their `calls` and `calledBy` names become planned edges when they name a node in the graph.
 * Names like `ForecastCache.get` resolve to the planned function whose signature returns that type.
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
    };
    nodes.push(node);
    byId.set(node.id, node);
    planIds.set(f, node.id);
  }

  const edges = new Map<string, GraphEdge>(graph.edges.map((e) => [e.id, e]));
  const returnsType = (type: string) =>
    accepted.filter((f) => new RegExp(`\\)\\s*:\\s*${escape(type)}\\b`).test(f.signature)).map((f) => planIds.get(f)!);

  const resolve = (ref: string): { ids: string[]; kind: GraphEdge["kind"] } => {
    const found = findNode(nodes, ref);
    if (found) return { ids: [found.node.id], kind: found.via === "member" ? "dispatch" : "call" };
    const name = cleanRef(ref);
    const dot = name.lastIndexOf(".");
    return { ids: dot > 0 ? returnsType(name.slice(0, dot)) : [], kind: "dispatch" };
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
      const { ids, kind } = resolve(ref);
      for (const to of ids) add(planIds.get(f)!, to, kind);
    }
  }
  for (const f of accepted) {
    for (const ref of f.calledBy) {
      for (const from of resolve(ref).ids) add(from, planIds.get(f)!, "call");
    }
  }
  return { ...graph, nodes, edges: [...edges.values()] };
}

/**
 * The node a name from a plan refers to: a function or route with that name, a file's module node
 * (`server.ts`), or the member of `Type.member`. Shared with the panel, which links these names to code.
 */
export function findNode(nodes: GraphNode[], ref: string): { node: GraphNode; via: "name" | "file" | "member" } | undefined {
  const name = cleanRef(ref);
  const exact = nodes.filter((n) => n.name === name);
  if (exact.length) return { node: pick(exact), via: "name" };
  const file = nodes.filter((n) => n.path.split("/").pop() === name && n.kind !== "function" && n.kind !== "method");
  if (file.length) return { node: pick(file), via: "file" };
  const dot = name.lastIndexOf(".");
  const member = dot > 0 ? nodes.filter((n) => n.name === name.slice(dot + 1)) : [];
  return member.length ? { node: pick(member), via: "member" } : undefined;
}

function cleanRef(ref: string): string {
  return ref.replace(/\(\)$/, "").trim();
}

/** Planned nodes win over existing ones with the same name, since the plan is what the user just decided. */
function pick(candidates: GraphNode[]): GraphNode {
  return candidates.find((n) => n.planned) ?? candidates[0]!;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
