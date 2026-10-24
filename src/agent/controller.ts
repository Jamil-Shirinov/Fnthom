// Authoritative session state machine (application-spec.md, section 6).
//
// idle -> planning -> reviewing --accept--> planning -> ... (agent says the plan is complete)
//                     reviewing --reject--> reworking -> reviewing
//      -> implementing -> checking -> done
// Failures go to needsAttention with a retry. One agent turn or mutation runs at a time, every action carries
// the state revision the UI saw, and results from superseded or cancelled operations are dropped.

import type { ActivityEvent } from "../shared/messages";
import {
  FileChangeSet,
  PlanningTurn,
  emptyState,
  type ApplicationState,
  type CheckResult,
  type CodeGraph,
  type FeaturePlan,
  type FileSnapshot,
  type Phase,
  type RecoverableError,
} from "../shared/schema";
import { annotateGraph, buildCodeGraph } from "../workspace/codeGraph";
import { validateChanges } from "../workspace/edits";
import { MAX_SOURCE_BYTES, type WorkspacePort } from "../workspace/port";
import { AgentCancelledError, type AgentAdapter, type AgentCallOptions, type Decision } from "./adapter";

export type ControllerEvents = {
  onState: (state: ApplicationState) => void;
  onActivity: (event: ActivityEvent) => void;
};

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

type Guard = { sessionId: string; expectedRevision: number };
type Graph = Omit<CodeGraph, "builtAt">;

const BUSY_PHASES: ReadonlySet<Phase> = new Set(["planning", "reworking", "implementing", "checking"]);
/** How much source the agent is shown while planning and implementing. */
const MAX_CONTEXT_BYTES = 512 * 1024;
const MAX_DESCRIBED_NODES = 60;

export class SessionController {
  private state: ApplicationState;
  private abort: AbortController | null = null;
  private operationCounter = 0;
  private resultCounter = 0;
  private intent = "";
  private lastDecision: Decision | null = null;
  /** What "Try again" does in needsAttention. */
  private retryAction: (() => Promise<void>) | null = null;
  /** File contents just before implementation, for "view changes" diffs. */
  private baselines = new Map<string, FileSnapshot>();
  /** The graph just before implementation, so the result can mark new and changed functions. */
  private baselineGraph: Graph | null = null;
  /** Agent descriptions of functions, kept so graph rebuilds after edits do not ask again. */
  private descriptions: Record<string, string> = {};
  private writing = false;

  constructor(
    private readonly agent: AgentAdapter,
    private readonly workspace: WorkspacePort,
    private readonly events: ControllerEvents,
    init: { sessionId: string; workspaceId: string },
  ) {
    this.state = emptyState(init.sessionId, init.workspaceId);
  }

  getState(): ApplicationState {
    return this.state;
  }

  /** Content of a file before this session implemented the feature; exists: false for files it created. */
  baselineFor(path: string): FileSnapshot | undefined {
    return this.baselines.get(path);
  }

  /** Rejects actions made against another session or an older state revision. */
  assertGuard(guard: { sessionId: string; expectedRevision?: number }) {
    if (guard.sessionId !== this.state.sessionId) throw new GuardError("This action belongs to a different session.");
    if (guard.expectedRevision !== undefined && guard.expectedRevision !== this.state.stateRevision) {
      throw new GuardError("The session changed since this action was made. Review the latest state and try again.");
    }
  }

  // ---------------------------------------------------------------- planning

  async startFeature(intent: string, guard: Guard): Promise<void> {
    this.assertGuard(guard);
    this.requireIdle("start a feature");
    this.intent = intent;
    this.lastDecision = null;
    this.baselines.clear();
    this.baselineGraph = null;
    this.update({ plan: null, applied: [], checks: [], graph: null });
    await this.planTurn("planning");
  }

  async acceptFunction(functionId: string, guard: Guard): Promise<void> {
    this.decide(functionId, guard, { functionId, decision: "accepted" });
    await this.planTurn("planning");
  }

  async rejectFunction(functionId: string, reason: string | undefined, guard: Guard): Promise<void> {
    this.decide(functionId, guard, { functionId, decision: "rejected", ...(reason ? { reason } : {}) });
    await this.planTurn("reworking");
  }

  private decide(functionId: string, guard: Guard, decision: Decision) {
    this.assertGuard(guard);
    const plan = this.state.plan;
    const proposal = plan?.functions.find((f) => f.status === "proposed");
    if (this.state.phase !== "reviewing" || !plan || proposal?.id !== functionId) {
      throw new GuardError("That proposal was already decided or replaced.");
    }
    this.lastDecision = decision;
    this.update({
      plan: {
        ...plan,
        functions: plan.functions.map((f) =>
          f.id === functionId
            ? { ...f, status: decision.decision, ...(decision.reason ? { rejectionReason: decision.reason } : {}) }
            : f,
        ),
      },
    });
  }

  private async planTurn(busyPhase: "planning" | "reworking"): Promise<void> {
    const operationId = this.begin({ phase: busyPhase });
    const intent = this.intent;
    try {
      const context = await this.readContext();
      const history = this.state.plan?.functions ?? [];
      const raw = await this.agent.planNext({ intent, context, history, lastDecision: this.lastDecision }, this.callOptions(operationId));
      if (this.superseded(operationId)) return;

      const parsed = PlanningTurn.safeParse(raw);
      if (!parsed.success) throw new Error(`The agent's plan did not have the expected shape: ${issueText(parsed.error.issues)}`);
      const turn = parsed.data;
      if (turn.next && history.some((f) => f.id === turn.next!.id)) throw new Error(`The agent reused the proposal id "${turn.next.id}".`);

      const plan: FeaturePlan = {
        intent,
        summary: turn.summary,
        functions: turn.next ? [...history, { ...turn.next, status: "proposed" }] : history,
        upcoming: turn.next ? turn.upcoming : [],
        reworkNote: turn.reworkNote ?? null,
      };
      if (!turn.next) {
        this.update({ plan });
        if (!plan.functions.some((f) => f.status === "accepted")) {
          return this.attention(operationId, { stage: "planning", message: "The plan ended without any accepted functions.", nextAction: "Start over with a different request." }, null);
        }
        return this.implement(operationId);
      }
      this.update({ plan, phase: "reviewing", operationId: null });
    } catch (err) {
      if (this.superseded(operationId)) return;
      const cancelled = err instanceof AgentCancelledError;
      this.attention(
        operationId,
        {
          stage: cancelled ? "planning" : "invalid-output",
          message: cancelled ? "Planning was cancelled." : errorText(err),
          nextAction: "Try again to continue planning from the last decision, or start over.",
        },
        () => this.planTurn(busyPhase),
      );
    }
  }

  // ---------------------------------------------------------------- implementation

  private async implement(operationId: string): Promise<void> {
    const plan = this.state.plan!;
    this.update({ phase: "implementing", error: null });
    const retry = () => this.implement(this.begin({ phase: "implementing" }));
    try {
      this.emitActivity(operationId, "status", "Reading the current code");
      const context = await this.readContext();
      this.baselineGraph = await this.graphOf();
      const raw = await this.agent.implement({ intent: plan.intent, functions: plan.functions, context }, this.callOptions(operationId));
      if (this.superseded(operationId)) return;

      const parsed = FileChangeSet.safeParse(raw);
      if (!parsed.success) throw new Error(`The generated changes did not have the expected shape: ${issueText(parsed.error.issues)}`);
      const files = parsed.data;
      const paths = files.map((f) => f.path);

      const dirty = await this.workspace.dirtyPaths(paths);
      if (dirty.length) {
        return this.attention(
          operationId,
          { stage: "save", message: `Unsaved changes in ${dirty.join(", ")}.`, nextAction: "Save or revert those files, then try again." },
          retry,
        );
      }
      const current = await this.workspace.snapshot(paths);
      const issues = validateChanges(files, current);
      if (issues.length) {
        const stale = issues.every((i) => i.kind === "stale");
        return this.attention(
          operationId,
          {
            stage: stale ? "stale-source" : "invalid-output",
            message: issues.map((i) => i.message).join(" "),
            nextAction: stale ? "The code changed while it was being generated. Try again to generate against the current code." : "Try again.",
          },
          retry,
        );
      }

      this.baselines = new Map(current.map((s) => [s.path, s]));
      this.emitActivity(operationId, "status", `Writing ${paths.join(", ")}`);
      this.writing = true;
      let outcomes;
      try {
        outcomes = await this.workspace.apply(files);
      } finally {
        this.writing = false;
      }
      const failed = outcomes.filter((o) => !o.applied || !o.saved);
      const written = outcomes.filter((o) => o.applied);
      this.update({
        applied: written.map((o) => {
          const base = this.baselines.get(o.path);
          return { path: o.path, baseHash: base?.exists ? base.contentHash : null, appliedHash: o.appliedHash ?? "" };
        }),
      });
      if (failed.length) {
        // Never re-apply automatically after a partial write; the user decides what to keep.
        return this.attention(
          operationId,
          {
            stage: failed.some((o) => !o.applied) ? "apply" : "save",
            message: `Written: ${written.map((o) => o.path).join(", ") || "nothing"}. Failed: ${failed.map((o) => `${o.path} (${o.error ?? "not saved"})`).join(", ")}.`,
            nextAction: "Inspect those files. Undo the changes in the editor, then start over.",
          },
          null,
        );
      }

      await this.runChecks(operationId);
      if (this.superseded(operationId)) return;
      await this.finishGraph(operationId);
    } catch (err) {
      if (this.superseded(operationId)) return;
      const cancelled = err instanceof AgentCancelledError;
      this.attention(
        operationId,
        {
          stage: cancelled ? "planning" : "invalid-output",
          message: cancelled ? "Implementation was cancelled before any file was written." : errorText(err),
          nextAction: "Try again to generate the code for the accepted plan.",
        },
        retry,
      );
    }
  }

  private async runChecks(operationId: string): Promise<void> {
    const checks = this.workspace.checkDefinitions();
    if (checks.length === 0) return;
    this.update({ phase: "checking" });
    const signal = this.abort?.signal ?? new AbortController().signal;
    const results: CheckResult[] = [];
    for (const check of checks) {
      if (this.superseded(operationId)) return;
      this.emitActivity(operationId, "status", `Running ${check.label}`);
      const startedAt = new Date().toISOString();
      const run = await this.workspace.runCheck(check, signal);
      this.resultCounter += 1;
      results.push({
        id: `r-${this.resultCounter}`,
        checkId: check.id,
        label: check.label,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: run.exitCode,
        output: run.output,
        status: run.status,
      });
      if (run.status === "cancelled") break;
    }
    if (!this.superseded(operationId)) this.update({ checks: results });
  }

  async rerunChecks(guard: Guard): Promise<void> {
    this.assertGuard(guard);
    this.requireIdle("rerun checks");
    const phase = this.state.phase;
    const operationId = this.begin({});
    await this.runChecks(operationId);
    if (!this.superseded(operationId)) this.update({ phase, operationId: null });
  }

  // ---------------------------------------------------------------- graph

  /** Builds the function graph for the current code without starting a feature. */
  async showGraph(guard: Guard): Promise<void> {
    this.assertGuard(guard);
    this.requireIdle("build the graph");
    const phase = this.state.phase;
    const operationId = this.begin({});
    try {
      this.emitActivity(operationId, "status", "Reading the code and tracing calls");
      await this.finishGraph(operationId, phase === "done" ? "done" : phase === "needsAttention" ? "idle" : phase);
    } catch (err) {
      if (!this.superseded(operationId)) {
        this.attention(operationId, { stage: "graph", message: errorText(err), nextAction: "Try again." }, () => this.showGraph(this.guard()));
      }
    }
  }

  /** Rebuilds the graph quietly after the user edits code, so links keep pointing at the right lines. */
  async noteSourceChanged(): Promise<void> {
    if (!this.state.graph || this.state.operationId || this.writing) return;
    const graph = annotateGraph(await this.graphOf(), {
      baseline: this.baselineGraph,
      planned: this.state.plan?.functions,
      descriptions: this.descriptions,
    });
    if (!this.state.operationId) this.update({ graph: { ...graph, builtAt: new Date().toISOString() } });
  }

  private async finishGraph(operationId: string, finalPhase: Phase = "done"): Promise<void> {
    this.emitActivity(operationId, "status", "Building the function graph");
    const files = await this.sourceSnapshots();
    const raw = buildCodeGraph(files, { includeTests: true });
    const context = { baseline: this.baselineGraph, planned: this.state.plan?.functions, descriptions: this.descriptions };
    let graph = annotateGraph(raw, context);

    const missing = graph.nodes.filter((n) => !n.purpose).slice(0, MAX_DESCRIBED_NODES);
    if (missing.length) {
      try {
        const byPath = new Map(files.map((f) => [f.path, f.content.split("\n")]));
        const nodes = missing.map((n) => ({
          id: n.id,
          name: n.name,
          path: n.path,
          code: (byPath.get(n.path) ?? []).slice(n.startLine - 1, n.endLine).join("\n").slice(0, 4000),
        }));
        const described = await this.agent.describe({ nodes }, this.callOptions(operationId));
        if (this.superseded(operationId)) return;
        for (const [id, text] of Object.entries(described)) if (typeof text === "string" && text.trim()) this.descriptions[id] = text.trim();
        graph = annotateGraph(raw, { ...context, descriptions: this.descriptions });
      } catch (err) {
        if (err instanceof AgentCancelledError) throw err;
        // Descriptions are a nicety; the graph is still accurate without them.
      }
    }
    if (this.superseded(operationId)) return;
    this.update({ graph: { ...graph, builtAt: new Date().toISOString() }, phase: finalPhase, operationId: null });
  }

  private async graphOf(): Promise<Graph> {
    return buildCodeGraph(await this.sourceSnapshots(), { includeTests: true });
  }

  // ---------------------------------------------------------------- lifecycle

  async retry(guard: Guard): Promise<void> {
    this.assertGuard(guard);
    if (this.state.phase !== "needsAttention" || !this.retryAction) throw new GuardError("There is nothing to try again.");
    const action = this.retryAction;
    this.retryAction = null;
    await action();
  }

  cancel(guard: { sessionId: string }) {
    this.assertGuard(guard);
    if (!this.state.operationId || this.writing) return; // a write in progress must finish and be reported
    this.abort?.abort();
    this.agent.cancel();
  }

  /** Discards session metadata only; source files are never touched. */
  reset() {
    this.abort?.abort();
    this.agent.cancel();
    this.baselines.clear();
    this.baselineGraph = null;
    this.retryAction = null;
    this.lastDecision = null;
    const fresh = emptyState(this.state.sessionId, this.state.workspaceId);
    this.state = { ...fresh, stateRevision: this.state.stateRevision + 1 };
    this.events.onState(this.state);
  }

  // ---------------------------------------------------------------- helpers

  private async sourceSnapshots(): Promise<FileSnapshot[]> {
    const paths = await this.workspace.listSourceFiles();
    return (await this.workspace.snapshot(paths)).filter((s) => s.exists && s.content.length <= MAX_SOURCE_BYTES);
  }

  /** Source the agent reads, smallest files first until the budget is spent. */
  private async readContext(): Promise<FileSnapshot[]> {
    const files = await this.sourceSnapshots();
    const picked: FileSnapshot[] = [];
    let bytes = 0;
    for (const file of [...files].sort((a, b) => a.content.length - b.content.length)) {
      if (bytes + file.content.length > MAX_CONTEXT_BYTES) break;
      bytes += file.content.length;
      picked.push(file);
    }
    return picked.sort((a, b) => a.path.localeCompare(b.path));
  }

  private requireIdle(action: string) {
    if (this.state.operationId || BUSY_PHASES.has(this.state.phase)) throw new GuardError(`Cannot ${action} while the agent is working.`);
  }

  private begin(patch: Partial<ApplicationState>): string {
    this.operationCounter += 1;
    const operationId = `op-${this.operationCounter}`;
    this.abort = new AbortController();
    this.retryAction = null;
    this.update({ ...patch, operationId, error: null });
    return operationId;
  }

  private callOptions(operationId: string): AgentCallOptions {
    return {
      operationId,
      signal: this.abort?.signal ?? new AbortController().signal,
      onActivity: (event) => this.emitActivity(operationId, event.kind, event.message),
    };
  }

  private superseded(operationId: string) {
    return this.state.operationId !== operationId;
  }

  private attention(operationId: string, error: RecoverableError, retry: (() => Promise<void>) | null) {
    if (this.superseded(operationId)) return;
    this.retryAction = retry;
    this.update({ phase: "needsAttention", operationId: null, error });
  }

  private guard(): Guard {
    return { sessionId: this.state.sessionId, expectedRevision: this.state.stateRevision };
  }

  private emitActivity(operationId: string, kind: ActivityEvent["kind"], message: string) {
    if (this.state.operationId === operationId) this.events.onActivity({ operationId, kind, message, at: new Date().toISOString() });
  }

  private update(patch: Partial<ApplicationState>) {
    this.state = { ...this.state, ...patch, stateRevision: this.state.stateRevision + 1 };
    this.events.onState(this.state);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function issueText(issues: { path: (string | number)[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
