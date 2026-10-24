// Domain contracts shared by the extension host and the webview (application-spec.md, section 5).
// Portable on purpose: no imports from vscode, Node, Droid, or React.
//
// Conventions:
// - IDs are opaque strings.
// - Paths are normalized workspace-relative paths with forward slashes.
// - Serialized source lines are one-based and inclusive. Convert to zero-based
//   editor positions only at the VS Code boundary.

import { z } from "zod";

export const SCHEMA_VERSION = 2;

const id = z.string().min(1);

export const WorkspacePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !/^[a-zA-Z]:/.test(p), "must be workspace-relative")
  .refine((p) => !p.includes("\\"), "must use forward slashes")
  .refine((p) => !p.split("/").some((segment) => segment === ".." || segment === "."), "must not contain . or .. segments");
export type WorkspacePath = z.infer<typeof WorkspacePath>;

// ---------------------------------------------------------------- planning

export const FunctionKind = z.enum(["function", "module", "route", "test"]);
export type FunctionKind = z.infer<typeof FunctionKind>;

/** One function or module the agent proposes, before any code is written. */
export const FunctionProposal = z.object({
  id,
  name: z.string().min(1),
  kind: FunctionKind,
  path: WorkspacePath,
  /** "new" adds the function; "change" modifies an existing one with the same name in the same file. */
  change: z.enum(["new", "change"]),
  signature: z.string().min(1),
  purpose: z.string().min(1),
  /** How it works, in a few short points: decisions, edge cases, assumptions. */
  details: z.array(z.string()),
  /** Names of the functions it will call, existing or planned. */
  calls: z.array(z.string()),
  /** Names of the functions that will call it. */
  calledBy: z.array(z.string()),
  /** The rejected proposal this one replaces, when it is a rework. */
  replacesId: id.optional(),
});
export type FunctionProposal = z.infer<typeof FunctionProposal>;

export const PlannedFunction = FunctionProposal.extend({
  status: z.enum(["proposed", "accepted", "rejected"]),
  rejectionReason: z.string().optional(),
});
export type PlannedFunction = z.infer<typeof PlannedFunction>;

/** A function the agent expects to propose later. Reworked whenever the user rejects a proposal. */
export const UpcomingFunction = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
});
export type UpcomingFunction = z.infer<typeof UpcomingFunction>;

export const FeaturePlan = z.object({
  intent: z.string().min(1),
  summary: z.string().min(1),
  /** Every proposal in the order it was made, including rejected ones, so the history stays visible. */
  functions: z.array(PlannedFunction),
  upcoming: z.array(UpcomingFunction),
  /** What the agent changed in the remaining plan after the latest rejection. */
  reworkNote: z.string().nullable(),
});
export type FeaturePlan = z.infer<typeof FeaturePlan>;

/** What the agent returns for each planning turn. `next: null` means planning is complete. */
export const PlanningTurn = z.object({
  summary: z.string().min(1),
  next: FunctionProposal.nullable(),
  upcoming: z.array(UpcomingFunction),
  reworkNote: z.string().optional(),
});
export type PlanningTurn = z.infer<typeof PlanningTurn>;

// ---------------------------------------------------------------- implementation

export const FileSnapshot = z.object({
  path: WorkspacePath,
  exists: z.boolean(),
  content: z.string(),
  contentHash: z.string().min(1),
  documentVersion: z.number().int().optional(),
});
export type FileSnapshot = z.infer<typeof FileSnapshot>;

/** Full-content file changes. Updates name the content hash they were written against. */
export const FileChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("update"), path: WorkspacePath, baseHash: z.string().min(1), newContent: z.string() }),
  z.object({ kind: z.literal("create"), path: WorkspacePath, newContent: z.string() }),
]);
export type FileChange = z.infer<typeof FileChange>;

export const FileChangeSet = z
  .array(FileChange)
  .min(1)
  .refine((files) => new Set(files.map((f) => f.path)).size === files.length, "exactly one entry per path");

export const AppliedFile = z.object({ path: WorkspacePath, baseHash: z.string().nullable(), appliedHash: z.string() });
export type AppliedFile = z.infer<typeof AppliedFile>;

export const CheckDefinition = z.object({
  id,
  label: z.string().min(1),
  executable: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().default("."),
  timeoutMs: z.number().int().positive().default(60_000),
});
export type CheckDefinition = z.infer<typeof CheckDefinition>;

export const CheckStatus = z.enum(["passed", "failed", "cancelled", "timed-out", "error"]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const CheckResult = z.object({
  id,
  checkId: id,
  label: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  exitCode: z.number().int().optional(),
  output: z.string(),
  status: CheckStatus,
});
export type CheckResult = z.infer<typeof CheckResult>;

// ---------------------------------------------------------------- code graph

export const GraphNodeKind = z.enum(["function", "method", "route", "module", "test"]);
export type GraphNodeKind = z.infer<typeof GraphNodeKind>;

export const GraphNode = z.object({
  /** `path#name`, stable across rebuilds while the function keeps its name and file. */
  id,
  name: z.string().min(1),
  kind: GraphNodeKind,
  path: WorkspacePath,
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  exported: z.boolean(),
  /** Hash of the declaration's text, used to tell changed functions from unchanged ones. */
  bodyHash: z.string(),
  purpose: z.string().optional(),
  purposeSource: z.enum(["plan", "comment", "agent"]).optional(),
  status: z.enum(["new", "changed", "unchanged"]),
});
export type GraphNode = z.infer<typeof GraphNode>;

export const GraphEdge = z.object({
  id,
  from: id,
  to: id,
  /** "call": a direct call. "dispatch": a call through an interface or object type the target returns. "registers": a route set up by a function. */
  kind: z.enum(["call", "dispatch", "registers"]),
});
export type GraphEdge = z.infer<typeof GraphEdge>;

/** Arrow color per connection kind, shared by the panel's graph and the Markdown export. */
export const EDGE_COLORS: Record<GraphEdge["kind"], string> = { call: "#3b8eea", dispatch: "#b267e6", registers: "#e8743b" };

export const CodeGraph = z.object({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  builtAt: z.string(),
  /** Files that could not be read or parsed, or were left out because of size limits. */
  skipped: z.array(z.string()),
});
export type CodeGraph = z.infer<typeof CodeGraph>;

// ---------------------------------------------------------------- session

export const Phase = z.enum([
  "idle",
  "planning", // the agent is proposing the next function
  "reviewing", // a proposal waits for Accept or Reject
  "reworking", // the agent is reworking the plan after a rejection
  "implementing",
  "checking",
  "done",
  "needsAttention",
]);
export type Phase = z.infer<typeof Phase>;

export const RecoverableError = z.object({
  stage: z.enum(["planning", "invalid-output", "stale-source", "save", "apply", "graph", "export", "internal"]),
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
  applied: z.array(AppliedFile),
  checks: z.array(CheckResult),
  graph: CodeGraph.nullable(),
  operationId: id.nullable(),
  error: RecoverableError.nullable(),
});
export type ApplicationState = z.infer<typeof ApplicationState>;

export function emptyState(sessionId: string, workspaceId: string): ApplicationState {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    stateRevision: 0,
    workspaceId,
    phase: "idle",
    plan: null,
    applied: [],
    checks: [],
    graph: null,
    operationId: null,
    error: null,
  };
}

/** The proposal waiting for a decision, if any. */
export function currentProposal(plan: FeaturePlan | null): PlannedFunction | null {
  return plan?.functions.find((f) => f.status === "proposed") ?? null;
}

export function acceptedFunctions(plan: FeaturePlan | null): PlannedFunction[] {
  return plan?.functions.filter((f) => f.status === "accepted") ?? [];
}
