// Groups the function graph into clusters of related functions for the zoomed-out view, and names them.
// Pure and free of the TypeScript compiler, so the panel computes clusters from whatever graph it shows.
//
// Grouping: Louvain community detection on an undirected weighted graph. Calls connect functions, and files
// and folders add weaker ties, so functions that call each other and live together end up in one cluster.
// Naming: the words that best tell a cluster apart from the others, taken from folder, file and function names.

import type { GraphEdge, GraphNode } from "../shared/schema";

export type Cluster = {
  id: string;
  /** Short name of what the cluster is responsible for, like "Cache" or "Weather route". */
  name: string;
  /** Member node ids, in graph order. */
  nodeIds: string[];
  /** Files the members live in, most members first. */
  paths: string[];
};

export type MetaEdge = {
  id: string;
  from: string;
  to: string;
  /** How many function-level connections it stands for, and which kind most of them are. */
  count: number;
  kind: GraphEdge["kind"];
  planned: boolean;
};

const CALL_WEIGHT = 1;
const SAME_FILE_WEIGHT = 0.6;
const SAME_FOLDER_WEIGHT = 0.15;

/**
 * Clusters for these nodes. Small graphs still get at least two clusters when the calls allow it, so the
 * zoomed-out view always says something; a graph with nothing to separate gets a single cluster.
 */
export function clusterGraph(nodes: GraphNode[], edges: GraphEdge[]): Cluster[] {
  if (nodes.length === 0) return [];
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const links = weightedLinks(nodes, edges, index);

  let membership = louvain(nodes.length, links, 1);
  // Raise the resolution until there is more than one cluster, for graphs that are one tight knot.
  for (const resolution of [1.6, 2.4, 3.5]) {
    if (new Set(membership).size > 1 || nodes.length < 4) break;
    membership = louvain(nodes.length, links, resolution);
  }

  const groups = new Map<number, number[]>();
  membership.forEach((c, i) => groups.set(c, [...(groups.get(c) ?? []), i]));
  const members = [...groups.values()].sort((a, b) => b.length - a.length || a[0]! - b[0]!);
  const names = nameClusters(members.map((m) => m.map((i) => nodes[i]!)));

  return members.map((m, k) => {
    const counts = new Map<string, number>();
    for (const i of m) counts.set(nodes[i]!.path, (counts.get(nodes[i]!.path) ?? 0) + 1);
    return {
      id: `cluster-${k}`,
      name: names[k]!,
      nodeIds: m.map((i) => nodes[i]!.id),
      paths: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p),
    };
  });
}

/** Function-level edges between clusters, merged into one edge per ordered pair of clusters. */
export function metaEdges(clusters: Cluster[], edges: GraphEdge[]): MetaEdge[] {
  const clusterOf = new Map(clusters.flatMap((c) => c.nodeIds.map((id) => [id, c.id] as const)));
  const merged = new Map<string, { from: string; to: string; kinds: Map<GraphEdge["kind"], number>; count: number; planned: boolean }>();
  for (const e of edges) {
    const from = clusterOf.get(e.from);
    const to = clusterOf.get(e.to);
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    const entry = merged.get(key) ?? { from, to, kinds: new Map(), count: 0, planned: true };
    entry.count += 1;
    entry.kinds.set(e.kind, (entry.kinds.get(e.kind) ?? 0) + 1);
    entry.planned &&= !!e.planned;
    merged.set(key, entry);
  }
  return [...merged].map(([id, m]) => ({
    id,
    from: m.from,
    to: m.to,
    count: m.count,
    kind: [...m.kinds].sort((a, b) => b[1] - a[1])[0]![0],
    planned: m.planned,
  }));
}

// ---------------------------------------------------------------- grouping

type Link = { a: number; b: number; w: number };

function weightedLinks(nodes: GraphNode[], edges: GraphEdge[], index: Map<string, number>): Link[] {
  const weights = new Map<string, number>();
  const add = (a: number, b: number, w: number) => {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    weights.set(key, (weights.get(key) ?? 0) + w);
  };
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined) add(a, b, CALL_WEIGHT);
  }
  // Files and folders tie their functions together in a star around the first member, so a big file costs
  // as many links as it has functions rather than every pair of them.
  const firstInFile = new Map<string, number>();
  const firstInFolder = new Map<string, number>();
  nodes.forEach((n, i) => {
    const file = firstInFile.get(n.path);
    if (file === undefined) {
      firstInFile.set(n.path, i);
      const folder = folderOf(n.path);
      const anchor = firstInFolder.get(folder);
      if (anchor === undefined) firstInFolder.set(folder, i);
      else add(anchor, i, SAME_FOLDER_WEIGHT);
    } else add(file, i, SAME_FILE_WEIGHT);
  });
  return [...weights].map(([key, w]) => {
    const [a, b] = key.split(":").map(Number) as [number, number];
    return { a, b, w };
  });
}

/**
 * Multi-level Louvain: move each node to the neighbouring community that raises modularity most, then merge
 * communities into single nodes and repeat until nothing moves. Deterministic: nodes are visited in order.
 */
function louvain(count: number, links: Link[], resolution: number): number[] {
  let membership = Array.from({ length: count }, (_, i) => i);
  let level = { count, links };
  for (let pass = 0; pass < 10; pass++) {
    const local = moveNodes(level.count, level.links, resolution);
    const ids = renumber(local);
    const communities = Math.max(-1, ...ids) + 1;
    membership = membership.map((c) => ids[c]!);
    if (communities === level.count) break;
    const merged = new Map<string, number>();
    for (const { a, b, w } of level.links) {
      const ca = ids[a]!;
      const cb = ids[b]!;
      const key = ca <= cb ? `${ca}:${cb}` : `${cb}:${ca}`;
      merged.set(key, (merged.get(key) ?? 0) + w);
    }
    level = {
      count: communities,
      links: [...merged].map(([key, w]) => {
        const [a, b] = key.split(":").map(Number) as [number, number];
        return { a, b, w };
      }),
    };
  }
  return membership;
}

function moveNodes(count: number, links: Link[], resolution: number): number[] {
  const neighbours: Array<Array<[number, number]>> = Array.from({ length: count }, () => []);
  const strength = new Array<number>(count).fill(0);
  let total = 0;
  for (const { a, b, w } of links) {
    if (a === b) {
      // A merged community's inner weight stays with it.
      strength[a]! += 2 * w;
      total += w;
      continue;
    }
    neighbours[a]!.push([b, w]);
    neighbours[b]!.push([a, w]);
    strength[a]! += w;
    strength[b]! += w;
    total += w;
  }
  const community = Array.from({ length: count }, (_, i) => i);
  if (total === 0) return community;
  const communityStrength = [...strength];
  const m2 = 2 * total;

  for (let sweep = 0, moved = true; moved && sweep < 50; sweep++) {
    moved = false;
    for (let i = 0; i < count; i++) {
      const current = community[i]!;
      const toCommunity = new Map<number, number>();
      for (const [j, w] of neighbours[i]!) toCommunity.set(community[j]!, (toCommunity.get(community[j]!) ?? 0) + w);
      communityStrength[current]! -= strength[i]!;
      let best = current;
      let bestGain = (toCommunity.get(current) ?? 0) - (resolution * strength[i]! * communityStrength[current]!) / m2;
      for (const [c, w] of toCommunity) {
        const gain = w - (resolution * strength[i]! * communityStrength[c]!) / m2;
        if (gain > bestGain + 1e-12) {
          best = c;
          bestGain = gain;
        }
      }
      communityStrength[best]! += strength[i]!;
      if (best !== current) {
        community[i] = best;
        moved = true;
      }
    }
  }
  return community;
}

function renumber(values: number[]): number[] {
  const ids = new Map<number, number>();
  return values.map((v) => {
    if (!ids.has(v)) ids.set(v, ids.size);
    return ids.get(v)!;
  });
}

// ---------------------------------------------------------------- naming

/** Words that say how code is written rather than what it is for. */
const STOP_WORDS = new Set(
  (
    "a an and the of to for in on by with from at as is are be or not no new get set has have create make build " +
    "handle handler init run do use util utils helper helpers index main lib src source module modules test tests " +
    "spec specs mock mocks default impl internal common shared core base value data item items list map file files " +
    "ts tsx js jsx mjs cjs fn func function functions method methods class type types app api post put patch delete"
  ).split(" "),
);

/** Names for each cluster from the words that are frequent inside it and rare in the others. */
function nameClusters(groups: GraphNode[][]): string[] {
  const bags = groups.map((group) => {
    const bag = new Map<string, number>();
    const add = (word: string, weight: number) => bag.set(word, (bag.get(word) ?? 0) + weight);
    for (const n of group) {
      // Folders usually name a feature, so they count most; flat projects fall back to file and function names.
      for (const w of words(folderOf(n.path).split("/").pop() ?? "")) add(w, 2);
      for (const w of words(fileStem(n.path))) add(w, 1);
      for (const w of words(n.kind === "module" || n.kind === "test" ? "" : n.name)) add(w, 0.75);
    }
    return bag;
  });
  const spread = new Map<string, number>();
  for (const bag of bags) for (const w of bag.keys()) spread.set(w, (spread.get(w) ?? 0) + 1);

  const used = new Set<string>();
  return bags.map((bag, k) => {
    const ranked = [...bag]
      .map(([w, tf]) => [w, tf * Math.log(1 + groups.length / spread.get(w)!)] as const)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    let name = ranked.length ? titleCase(ranked[0]![0]) : `Group ${k + 1}`;
    // A second word when it is nearly as telling, or when the first alone is already taken.
    const second = ranked[1];
    if (second && (second[1] >= ranked[0]![1] * 0.6 || used.has(name))) name = `${name} ${second[0]}`;
    for (let n = 2; used.has(name); n++) name = `${name.replace(/ \d+$/, "")} ${n}`;
    used.add(name);
    return name;
  });
}

/** Lowercase words of an identifier or path piece: camelCase, snake_case, kebab-case and digits split apart. */
function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function fileStem(path: string): string {
  return (path.split("/").pop() ?? "").replace(/\.(test|spec)?\.?[cm]?[jt]sx?$/i, "");
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
