// Domain contracts shared by the extension host and the webview (application-spec.md, section 5).
// Portable on purpose: no imports from vscode, Node, Droid, or React.
//
// Conventions:
// - IDs are opaque strings.
// - Paths are normalized workspace-relative paths with forward slashes.
// - Serialized source lines are one-based and inclusive. Convert to zero-based
//   editor positions only at the VS Code boundary.

import { z } from "zod";

export const SCHEMA_VERSION = 1;

const id = z.string().min(1);

export const WorkspacePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !/^[a-zA-Z]:/.test(p), "must be workspace-relative")
  .refine((p) => !p.includes("\\"), "must use forward slashes")
  .refine((p) => !p.split("/").some((segment) => segment === ".." || segment === "."), "must not contain . or .. segments");
export type WorkspacePath = z.infer<typeof WorkspacePath>;

export const SourceRefStatus = z.enum(["resolved", "stale", "missing"]);
export type SourceRefStatus = z.infer<typeof SourceRefStatus>;

export const SourceRef = z
  .object({
    path: WorkspacePath,
    symbol: z.string().min(1).optional(),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    contentHash: z.string().min(1),
    status: SourceRefStatus,
  })
  .refine((ref) => ref.endLine >= ref.startLine, "endLine must be >= startLine");
export type SourceRef = z.infer<typeof SourceRef>;

export const InvariantStatus = z.enum(["unverified", "supported", "failed", "stale"]);
export type InvariantStatus = z.infer<typeof InvariantStatus>;

export const Invariant = z.object({
  id,
  claim: z.string().min(1),
  sourceRefs: z.array(SourceRef),
  evidenceIds: z.array(id),
  // Derived from evidence by the host; never taken from model output as-is.
  status: InvariantStatus,
});
export type Invariant = z.infer<typeof Invariant>;

export const Concept = z.object({
  id,
  title: z.string().min(1),
  purpose: z.string().min(1),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  // Planned paths are intentions, not source references.
  intendedPaths: z.array(WorkspacePath),
  sourceRefs: z.array(SourceRef),
  invariants: z.array(Invariant),
});
export type Concept = z.infer<typeof Concept>;

export const DataFlowEdge = z.object({
  id,
  fromConceptId: id,
  toConceptId: id,
  label: z.string(),
});
export type DataFlowEdge = z.infer<typeof DataFlowEdge>;

export const ImplementationStep = z.object({
  id,
  title: z.string().min(1),
  conceptIds: z.array(id).min(1),
  dependsOnStepIds: z.array(id),
  expectedBehavior: z.string().min(1),
});
export type ImplementationStep = z.infer<typeof ImplementationStep>;

export const FeaturePlan = z.object({
  id,
  revision: z.number().int().min(1),
  intent: z.string().min(1),
  summary: z.string().min(1),
  concepts: z.array(Concept),
  edges: z.array(DataFlowEdge),
  steps: z.array(ImplementationStep),
  assumptions: z.array(z.string()),
});
export type FeaturePlan = z.infer<typeof FeaturePlan>;

export const FileSnapshot = z.object({
  path: WorkspacePath,
  exists: z.boolean(),
  content: z.string(),
  contentHash: z.string().min(1),
  documentVersion: z.number().int().optional(),
});
export type FileSnapshot = z.infer<typeof FileSnapshot>;

export const ProposedFile = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("update"), path: WorkspacePath, baseHash: z.string().min(1), newContent: z.string() }),
  z.object({ kind: z.literal("create"), path: WorkspacePath, newContent: z.string() }),
]);
export type ProposedFile = z.infer<typeof ProposedFile>;

export const StepProposal = z
  .object({
    id,
    planRevision: z.number().int().min(1),
    stepId: id,
    explanation: z.object({
      purpose: z.string().min(1),
      inputs: z.array(z.string()),
      outputs: z.array(z.string()),
      assumptions: z.array(z.string()),
    }),
    files: z.array(ProposedFile).min(1),
    invariantIds: z.array(id),
    suggestedCheckIds: z.array(id),
  })
  .refine((p) => new Set(p.files.map((f) => f.path)).size === p.files.length, "exactly one entry per path");
export type StepProposal = z.infer<typeof StepProposal>;

export const CheckDefinition = z.object({
  id,
  label: z.string().min(1),
  executable: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().default("."),
  timeoutMs: z.number().int().positive().default(60_000),
  invariantIds: z.array(id).default([]),
});
export type CheckDefinition = z.infer<typeof CheckDefinition>;

export const CheckStatus = z.enum(["passed", "failed", "cancelled", "timed-out", "error"]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const CheckResult = z.object({
  id,
  checkId: id,
  stepId: id,
  startedAt: z.string(),
  finishedAt: z.string(),
  exitCode: z.number().int().optional(),
  output: z.string(),
  status: CheckStatus,
  sourceFingerprint: z.string(),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const Phase = z.enum([
  "idle",
  "inspecting",
  "planReady",
  "proposing",
  "previewReady",
  "applying",
  "checking",
  "stepReady",
  "needsAttention",
  "revising",
  "complete",
]);
export type Phase = z.infer<typeof Phase>;

export const AppliedStep = z.object({
  stepId: id,
  proposalId: id,
  appliedAt: z.string(),
  files: z.array(z.object({ path: WorkspacePath, baseHash: z.string().nullable(), appliedHash: z.string() })),
});
export type AppliedStep = z.infer<typeof AppliedStep>;

export const QuestionAnswer = z.object({
  id,
  stepId: id.optional(),
  question: z.string().min(1),
  answer: z.string().optional(),
  askedAt: z.string(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

export const RecoverableError = z.object({
  stage: z.enum([
    "authentication",
    "executable",
    "invalid-output",
    "stale-source",
    "apply",
    "save",
    "checks",
    "persistence",
    "export",
    "internal",
  ]),
  message: z.string(),
  nextAction: z.string(),
});
export type RecoverableError = z.infer<typeof RecoverableError>;

export const ApplicationState = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  sessionId: id,
  stateRevision: z.number().int().min(0),
  workspaceId: z.string(),
  phase: Phase,
  plan: FeaturePlan.nullable(),
  currentStepId: id.nullable(),
  proposal: StepProposal.nullable(),
  history: z.array(AppliedStep),
  evidence: z.array(CheckResult),
  questions: z.array(QuestionAnswer),
  operationId: id.nullable(),
  error: RecoverableError.nullable(),
});
export type ApplicationState = z.infer<typeof ApplicationState>;

export type PlanIssue = { code: string; message: string };

/**
 * Structural checks a schema cannot express: duplicate IDs, unknown references,
 * cyclic step dependencies, and an empty plan. Data-flow edges may form cycles;
 * step dependencies must form a DAG.
 */
export function validatePlanStructure(plan: FeaturePlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const conceptIds = new Set<string>();
  const invariantIds = new Set<string>();
  const edgeIds = new Set<string>();
  const stepIds = new Set<string>();

  const noteDuplicate = (seen: Set<string>, value: string, kind: string) => {
    if (seen.has(value)) issues.push({ code: "duplicate-id", message: `Duplicate ${kind} id "${value}"` });
    seen.add(value);
  };

  for (const concept of plan.concepts) {
    noteDuplicate(conceptIds, concept.id, "concept");
    for (const invariant of concept.invariants) noteDuplicate(invariantIds, invariant.id, "invariant");
  }
  for (const edge of plan.edges) {
    noteDuplicate(edgeIds, edge.id, "edge");
    for (const end of [edge.fromConceptId, edge.toConceptId]) {
      if (!conceptIds.has(end)) {
        issues.push({ code: "unknown-reference", message: `Edge "${edge.id}" references unknown concept "${end}"` });
      }
    }
  }
  for (const step of plan.steps) noteDuplicate(stepIds, step.id, "step");
  for (const step of plan.steps) {
    for (const conceptId of step.conceptIds) {
      if (!conceptIds.has(conceptId)) {
        issues.push({ code: "unknown-reference", message: `Step "${step.id}" references unknown concept "${conceptId}"` });
      }
    }
    for (const dep of step.dependsOnStepIds) {
      if (!stepIds.has(dep)) {
        issues.push({ code: "unknown-reference", message: `Step "${step.id}" depends on unknown step "${dep}"` });
      }
    }
  }

  if (plan.steps.length === 0) issues.push({ code: "empty-plan", message: "Plan has no implementation steps" });

  const cycle = findStepCycle(plan.steps);
  if (cycle) issues.push({ code: "cyclic-steps", message: `Step dependencies form a cycle: ${cycle.join(" -> ")}` });

  return issues;
}

function findStepCycle(steps: ImplementationStep[]): string[] | null {
  const deps = new Map(steps.map((s) => [s.id, s.dependsOnStepIds]));
  const state = new Map<string, "visiting" | "done">();
  const trail: string[] = [];

  const visit = (stepId: string): string[] | null => {
    const mark = state.get(stepId);
    if (mark === "done") return null;
    if (mark === "visiting") return [...trail.slice(trail.indexOf(stepId)), stepId];
    state.set(stepId, "visiting");
    trail.push(stepId);
    for (const dep of deps.get(stepId) ?? []) {
      if (!deps.has(dep)) continue;
      const found = visit(dep);
      if (found) return found;
    }
    trail.pop();
    state.set(stepId, "done");
    return null;
  };

  for (const step of steps) {
    const found = visit(step.id);
    if (found) return found;
  }
  return null;
}

/** Parses untrusted input (model output, persisted state) into a plan, or returns every problem found. */
export function parsePlan(input: unknown): { ok: true; plan: FeaturePlan } | { ok: false; issues: PlanIssue[] } {
  const parsed = FeaturePlan.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ code: "schema", message: `${i.path.join(".") || "(root)"}: ${i.message}` })),
    };
  }
  const issues = validatePlanStructure(parsed.data);
  return issues.length ? { ok: false, issues } : { ok: true, plan: parsed.data };
}

/** Steps whose dependencies are all applied and which are not applied themselves, in plan order. */
export function readySteps(plan: FeaturePlan, appliedStepIds: ReadonlySet<string>): ImplementationStep[] {
  return plan.steps.filter(
    (step) => !appliedStepIds.has(step.id) && step.dependsOnStepIds.every((dep) => appliedStepIds.has(dep)),
  );
}

export type ConceptImplementationState = "planned" | "active" | "applied" | "stale";

/**
 * How the graph should show a concept. Verification is deliberately not part of this:
 * the UI shows invariant status as a separate badge.
 */
export function conceptImplementationState(
  concept: Concept,
  plan: FeaturePlan,
  appliedStepIds: ReadonlySet<string>,
  currentStepId: string | null,
): ConceptImplementationState {
  if (concept.sourceRefs.some((ref) => ref.status !== "resolved")) return "stale";
  // An applied step stays current while its checks are reviewed; it is no longer active.
  if (currentStepId && !appliedStepIds.has(currentStepId)) {
    const current = plan.steps.find((s) => s.id === currentStepId);
    if (current?.conceptIds.includes(concept.id)) return "active";
  }
  const owningSteps = plan.steps.filter((s) => s.conceptIds.includes(concept.id));
  // Existing code that no step changes is already implemented.
  if (owningSteps.length === 0) return concept.sourceRefs.length > 0 ? "applied" : "planned";
  return owningSteps.every((s) => appliedStepIds.has(s.id)) ? "applied" : "planned";
}

/** Worst-first summary of a concept's invariants, for the verification badge. */
export function verificationSummary(concept: Concept): InvariantStatus | "none" {
  if (concept.invariants.length === 0) return "none";
  const order: InvariantStatus[] = ["failed", "stale", "unverified", "supported"];
  for (const status of order) {
    if (concept.invariants.some((inv) => inv.status === status)) return status;
  }
  return "unverified";
}

export function emptyState(sessionId: string, workspaceId: string): ApplicationState {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    stateRevision: 0,
    workspaceId,
    phase: "idle",
    plan: null,
    currentStepId: null,
    proposal: null,
    history: [],
    evidence: [],
    questions: [],
    operationId: null,
    error: null,
  };
}
