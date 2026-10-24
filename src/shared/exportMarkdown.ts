// Builds the feature reference from session state alone, with no model call (application-spec.md, section 11).

import { conceptImplementationState, type ApplicationState } from "./schema";

const mermaidId = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_");
const mermaidText = (text: string) => text.replace(/"/g, "'").replace(/[\[\]{}|<>]/g, " ");

export function buildFeatureReference(state: ApplicationState): string {
  const plan = state.plan;
  if (!plan) return "# Feature reference\n\nNo plan has been created in this session.\n";

  const applied = new Set(state.history.map((h) => h.stepId));
  const lines: string[] = [];
  lines.push(`# ${plan.intent}`, "", plan.summary, "");

  lines.push("## Data flow", "", "```mermaid", "flowchart LR");
  for (const c of plan.concepts) lines.push(`  ${mermaidId(c.id)}["${mermaidText(c.title)}"]`);
  for (const e of plan.edges) {
    const label = e.label ? `|"${mermaidText(e.label)}"|` : "";
    lines.push(`  ${mermaidId(e.fromConceptId)} -->${label} ${mermaidId(e.toConceptId)}`);
  }
  lines.push("```", "");

  lines.push("## Components", "");
  for (const c of plan.concepts) {
    const state_ = conceptImplementationState(c, plan, applied, null);
    lines.push(`### ${c.title} (${state_})`, "", c.purpose, "");
    lines.push(`- Inputs: ${c.inputs.join(", ") || "none"}`, `- Outputs: ${c.outputs.join(", ") || "none"}`);
    if (c.sourceRefs.length === 0) lines.push(`- Source: not implemented (intended: ${c.intendedPaths.join(", ") || "none"})`);
    for (const ref of c.sourceRefs) {
      const where = `\`${ref.path}:${ref.startLine}-${ref.endLine}\`${ref.symbol ? ` (${ref.symbol})` : ""}`;
      lines.push(`- Source: ${where}${ref.status === "resolved" ? "" : `, **${ref.status}**: the code changed after it was linked`}`);
    }
    for (const inv of c.invariants) lines.push(`- Claim (${inv.status}): ${inv.claim}`);
    lines.push("");
  }

  lines.push("## Steps", "");
  plan.steps.forEach((step, i) => {
    const record = state.history.find((h) => h.stepId === step.id);
    const status = record ? `applied ${record.appliedAt}` : "not applied";
    lines.push(`${i + 1}. **${step.title}** (${status}): ${step.expectedBehavior}`);
  });
  lines.push("");

  lines.push("## Checks", "");
  if (state.evidence.length === 0) lines.push("No checks have run.");
  for (const e of state.evidence) lines.push(`- \`${e.checkId}\` after step \`${e.stepId}\`: ${e.status}${e.exitCode !== undefined ? ` (exit ${e.exitCode})` : ""}, ${e.finishedAt}`);
  lines.push("");

  if (plan.assumptions.length) lines.push("## Assumptions", "", ...plan.assumptions.map((a) => `- ${a}`), "");

  const open = plan.concepts.flatMap((c) => c.invariants.filter((i) => i.status !== "supported").map((i) => `- ${i.claim} (${i.status})`));
  lines.push("## Unresolved claims", "", ...(open.length ? open : ["None. Every recorded claim is supported by a passing check on the current source."]), "");
  return lines.join("\n");
}
