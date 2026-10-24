// Builds the feature reference from session state alone, with no model call (application-spec.md, section 11).

import { EDGE_COLORS, type ApplicationState } from "./schema";

const mermaidId = (id: string) => `n_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
const mermaidText = (text: string) => text.replace(/"/g, "'").replace(/[[\]{}|<>]/g, " ");

export function buildFeatureReference(state: ApplicationState): string {
  const { plan, graph } = state;
  const lines: string[] = [];
  lines.push(`# ${plan?.intent ?? "Function graph"}`, "");
  if (plan) lines.push(plan.summary, "");

  if (plan) {
    lines.push("## Planned functions", "");
    const accepted = plan.functions.filter((f) => f.status === "accepted");
    accepted.forEach((f, i) => {
      lines.push(`${i + 1}. **${f.name}** in \`${f.path}\` (${f.change === "new" ? "new" : "changed"}): ${f.purpose}`);
      for (const d of f.details) lines.push(`   - ${d}`);
    });
    const rejected = plan.functions.filter((f) => f.status === "rejected");
    if (rejected.length) {
      lines.push("", "### Rejected designs", "");
      for (const f of rejected) lines.push(`- **${f.name}**: ${f.purpose}${f.rejectionReason ? ` Reason: ${f.rejectionReason}` : ""}`);
    }
    lines.push("");
  }

  if (graph) {
    const nodes = graph.nodes.filter((n) => n.kind !== "test");
    const shown = new Set(nodes.map((n) => n.id));
    lines.push("## How the functions connect", "", "```mermaid", "flowchart LR");
    for (const n of nodes) lines.push(`  ${mermaidId(n.id)}["${mermaidText(n.name)}${n.status === "unchanged" ? "" : ` (${n.status})`}"]`);
    const drawn = graph.edges.filter((e) => shown.has(e.from) && shown.has(e.to));
    for (const e of drawn) lines.push(`  ${mermaidId(e.from)} ${e.kind === "call" ? "-->" : "-.->"} ${mermaidId(e.to)}`);
    // Same arrow colors as the panel's graph.
    drawn.forEach((e, i) => lines.push(`  linkStyle ${i} stroke:${EDGE_COLORS[e.kind]},stroke-width:2px`));
    lines.push(
      "```",
      "",
      "Blue arrows are direct calls, purple dashed arrows are calls through an interface, and orange dashed arrows are route registrations.",
      "",
    );

    lines.push("## Functions", "");
    for (const n of nodes) {
      lines.push(`- **${n.name}** \`${n.path}:${n.startLine}-${n.endLine}\`${n.status === "unchanged" ? "" : ` (${n.status})`}: ${n.purpose ?? "No description."}`);
    }
    lines.push("");
  }

  if (state.applied.length) {
    lines.push("## Files changed", "");
    for (const f of state.applied) lines.push(`- \`${f.path}\` (${f.baseHash ? "updated" : "created"})`);
    lines.push("");
  }

  lines.push("## Checks", "");
  if (state.checks.length === 0) lines.push("No checks have run.");
  for (const c of state.checks) lines.push(`- ${c.label}: ${c.status}${c.exitCode !== undefined ? ` (exit ${c.exitCode})` : ""}, ${c.finishedAt}`);
  lines.push("");
  return lines.join("\n");
}
