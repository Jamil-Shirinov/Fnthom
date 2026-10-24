import type { FeaturePlan } from "../../../src/shared/schema";

export type Position = { x: number; y: number };

const COLUMN_WIDTH = 300;
const ROW_HEIGHT = 120;

/**
 * Left-to-right layers by longest path from concepts with no incoming edges, so data flows rightward.
 * A concept's first outgoing edge stays on its row and later branches drop to new rows, which keeps
 * a hit/miss split readable as two lanes. Data flow may contain cycles; back edges are ignored for layout.
 */
export function layoutConcepts(plan: FeaturePlan): Map<string, Position> {
  const outgoing = new Map<string, string[]>(plan.concepts.map((c) => [c.id, []]));
  const incoming = new Map<string, number>(plan.concepts.map((c) => [c.id, 0]));
  for (const edge of plan.edges) {
    outgoing.get(edge.fromConceptId)?.push(edge.toConceptId);
    incoming.set(edge.toConceptId, (incoming.get(edge.toConceptId) ?? 0) + 1);
  }

  const roots = plan.concepts.filter((c) => (incoming.get(c.id) ?? 0) === 0).map((c) => c.id);
  const starts = roots.length ? roots : plan.concepts.slice(0, 1).map((c) => c.id);

  const level = new Map<string, number>();
  const visitLevel = (id: string, depth: number, path: Set<string>) => {
    if (path.has(id) || (level.get(id) ?? -1) >= depth) return;
    level.set(id, depth);
    path.add(id);
    for (const next of outgoing.get(id) ?? []) visitLevel(next, depth + 1, path);
    path.delete(id);
  };
  for (const id of starts) visitLevel(id, 0, new Set());
  for (const c of plan.concepts) if (!level.has(c.id)) visitLevel(c.id, 0, new Set());

  const row = new Map<string, number>();
  let nextFreeRow = 0;
  const visitRow = (id: string, r: number) => {
    if (row.has(id)) return;
    row.set(id, r);
    nextFreeRow = Math.max(nextFreeRow, r + 1);
    (outgoing.get(id) ?? []).forEach((next, i) => visitRow(next, i === 0 ? r : nextFreeRow));
  };
  for (const id of starts) visitRow(id, nextFreeRow);
  for (const c of plan.concepts) visitRow(c.id, nextFreeRow);

  // Two concepts can land on the same cell; nudge later ones down.
  const taken = new Set<string>();
  const positions = new Map<string, Position>();
  for (const c of plan.concepts) {
    const l = level.get(c.id) ?? 0;
    let r = row.get(c.id) ?? 0;
    while (taken.has(`${l}:${r}`)) r += 1;
    taken.add(`${l}:${r}`);
    positions.set(c.id, { x: l * COLUMN_WIDTH, y: r * ROW_HEIGHT });
  }
  return positions;
}
