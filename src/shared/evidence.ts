// Derives invariant status from explicit check evidence (application-spec.md, section 5).
// A passing check supports only the invariants it is configured for, and only for the source it ran against.

import type { CheckDefinition, CheckResult, FeaturePlan, InvariantStatus } from "./schema";

export function deriveInvariantStatus(
  invariantId: string,
  checks: CheckDefinition[],
  evidence: CheckResult[],
  currentFingerprint: string,
): { status: InvariantStatus; evidenceIds: string[] } {
  const relevant = checks.filter((c) => c.invariantIds.includes(invariantId));
  const latest = relevant
    .map((c) => evidence.filter((e) => e.checkId === c.id).at(-1))
    .filter((e): e is CheckResult => e !== undefined);
  const evidenceIds = latest.map((e) => e.id);

  if (latest.length === 0) return { status: "unverified", evidenceIds };
  const current = latest.filter((e) => e.sourceFingerprint === currentFingerprint);
  if (current.some((e) => e.status === "failed")) return { status: "failed", evidenceIds };
  if (current.length < latest.length) return { status: "stale", evidenceIds };
  // An infrastructure problem (timeout, error, cancel) shows nothing about the claim either way.
  if (current.length === relevant.length && current.every((e) => e.status === "passed")) return { status: "supported", evidenceIds };
  return { status: "unverified", evidenceIds };
}

export function withDerivedInvariants(
  plan: FeaturePlan,
  checks: CheckDefinition[],
  evidence: CheckResult[],
  currentFingerprint: string,
): FeaturePlan {
  return {
    ...plan,
    concepts: plan.concepts.map((concept) => ({
      ...concept,
      invariants: concept.invariants.map((inv) => ({ ...inv, ...deriveInvariantStatus(inv.id, checks, evidence, currentFingerprint) })),
    })),
  };
}
