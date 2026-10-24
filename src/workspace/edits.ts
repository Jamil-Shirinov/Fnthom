// Pure proposal validation (application-spec.md, section 9). The host's own snapshots are
// authoritative; hashes the model supplies are only compared against them.

import type { FeaturePlan, FileSnapshot, StepProposal } from "../shared/schema";

export const MAX_PROPOSAL_BYTES = 2 * 1024 * 1024;

const TEXT_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html|yml|yaml|txt)$/i;
const BLOCKED = /(^|\/)(\.git|node_modules|dist|\.env[^/]*)(\/|$)/;

export type ProposalIssue = { path?: string; kind: "invalid" | "stale"; message: string };

export function proposalPaths(proposal: StepProposal): string[] {
  return proposal.files.map((f) => f.path);
}

/** Checks a proposal against the plan and the current snapshots. Stale issues mean "regenerate", not "broken". */
export function validateProposal(
  proposal: StepProposal,
  plan: FeaturePlan,
  stepId: string,
  snapshots: FileSnapshot[],
): ProposalIssue[] {
  const issues: ProposalIssue[] = [];
  if (proposal.stepId !== stepId) issues.push({ kind: "invalid", message: `Proposal is for step "${proposal.stepId}", not "${stepId}".` });
  if (proposal.planRevision !== plan.revision) {
    issues.push({ kind: "stale", message: `Proposal targets plan revision ${proposal.planRevision}; the plan is at ${plan.revision}.` });
  }

  let bytes = 0;
  for (const file of proposal.files) {
    bytes += file.newContent.length;
    if (!TEXT_EXTENSIONS.test(file.path)) issues.push({ path: file.path, kind: "invalid", message: `Unsupported file type: ${file.path}` });
    if (BLOCKED.test(file.path)) issues.push({ path: file.path, kind: "invalid", message: `Refusing to write to ${file.path}` });

    const snapshot = snapshots.find((s) => s.path === file.path);
    if (!snapshot) {
      issues.push({ path: file.path, kind: "stale", message: `No baseline was captured for ${file.path}.` });
      continue;
    }
    if (file.kind === "create" && snapshot.exists) {
      issues.push({ path: file.path, kind: "stale", message: `${file.path} already exists, so it cannot be created.` });
    }
    if (file.kind === "update") {
      if (!snapshot.exists) issues.push({ path: file.path, kind: "stale", message: `${file.path} no longer exists.` });
      else if (snapshot.contentHash !== file.baseHash) {
        issues.push({ path: file.path, kind: "stale", message: `${file.path} changed since the proposal was made.` });
      } else if (snapshot.content === file.newContent) {
        issues.push({ path: file.path, kind: "invalid", message: `The proposal does not change ${file.path}.` });
      }
    }
  }
  if (bytes > MAX_PROPOSAL_BYTES) issues.push({ kind: "invalid", message: "Proposal is larger than the 2 MiB limit." });
  return issues;
}

/** Paths whose content the step is expected to touch: the step's concepts' intended paths. */
export function stepContextPaths(plan: FeaturePlan, stepId: string): string[] {
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) return [];
  const paths = new Set<string>();
  for (const conceptId of step.conceptIds) {
    for (const path of plan.concepts.find((c) => c.id === conceptId)?.intendedPaths ?? []) paths.add(path);
  }
  return [...paths];
}
