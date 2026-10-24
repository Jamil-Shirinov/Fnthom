// Authoritative session state machine (application-spec.md, section 6).
//
// idle -> inspecting -> planReady -> proposing -> previewReady -> applying -> checking
//   -> stepReady / needsAttention / complete
//
// One agent turn or mutation runs at a time. Every action carries the state revision the UI saw,
// and results from superseded or cancelled operations are dropped.

import { withDerivedInvariants } from "../shared/evidence";
import type { ActivityEvent } from "../shared/messages";
import {
  StepProposal,
  emptyState,
  readySteps,
  type ApplicationState,
  type CheckResult,
  type FeaturePlan,
  type FileSnapshot,
  type Phase,
  type RecoverableError,
  type SourceRef,
} from "../shared/schema";
import { contentHash } from "../workspace/hash";
import { proposalPaths, stepContextPaths, validateProposal } from "../workspace/edits";
import type { WorkspacePort } from "../workspace/port";
import { AgentCancelledError, type AgentAdapter, type AgentCallOptions } from "./adapter";

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

const STABLE_PHASES: ReadonlySet<Phase> = new Set(["idle", "planReady", "stepReady", "needsAttention", "complete"]);
const BUSY_PHASES: ReadonlySet<Phase> = new Set(["inspecting", "proposing", "applying", "checking", "revising"]);

export class SessionController {
  private state: ApplicationState;
  private abort: AbortController | null = null;
  private operationCounter = 0;
  private resultCounter = 0;
  /** Bumped on every source change; check evidence is only current for the generation it ran against. */
  private sourceGeneration = 0;
  /** Exact baselines the current proposal was made against, for previews and the apply-time comparison. */
  private baselines = new Map<string, FileSnapshot>();
  private applyingPaths = new Set<string>();
  /** Last content hash the session saw per path, so its own writes are not mistaken for outside edits. */
  private knownHashes = new Map<string, string>();

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

  /** Baseline content shown on the left of a proposal's diff. Undefined when the path is not in the proposal. */
  baselineFor(proposalId: string, path: string): FileSnapshot | undefined {
    if (this.state.proposal?.id !== proposalId) return undefined;
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
    if (this.state.phase !== "idle" && this.state.phase !== "planReady") {
      throw new GuardError(`Cannot start a feature while the session is ${this.state.phase}.`);
    }
    const previous = this.state;
    await this.runAgentOperation(
      { phase: "inspecting", plan: null, currentStepId: null, proposal: null, history: [], evidence: [], questions: [] },
      (options) => this.agent.inspectAndPlan({ intent, context: [] }, options),
      (plan) => ({ phase: "planReady", plan: this.derive(plan) }),
      () => ({ phase: STABLE_PHASES.has(previous.phase) ? previous.phase : "idle", plan: previous.plan }),
      "Try again, or narrow the request.",
    );
    const plan = this.state.plan;
    if (plan) {
      const paths = new Set(plan.concepts.flatMap((c) => [...c.intendedPaths, ...c.sourceRefs.map((r) => r.path)]));
      this.remember(await this.workspace.snapshot([...paths]));
    }
  }

  async reviseApproach(instruction: string, guard: Guard): Promise<void> {
    this.assertGuard(guard);
    const plan = this.requirePlan();
    this.requireStable("revise the approach", ["previewReady"]);
    const previous = this.state;
    this.baselines.clear();
    await this.runAgentOperation(
      { phase: "revising", proposal: null },
      (options) =>
        this.agent.revisePlan({ plan, instruction, appliedStepIds: this.state.history.map((h) => h.stepId) }, options),
      (revised) => ({ phase: "planReady", plan: this.derive(this.keepAppliedHistory(plan, revised)), currentStepId: null }),
      () => ({ phase: previous.phase === "previewReady" ? "planReady" : previous.phase, currentStepId: null }),
      "Try again with a different instruction.",
    );
  }

  async askQuestion(question: string, guard: Guard): Promise<void> {
    this.assertGuard(guard);
    const plan = this.requirePlan();
    if (this.state.operationId) throw new GuardError("Wait for the current operation to finish before asking.");
    const id = `q-${this.state.questions.length + 1}`;
    const stepId = this.state.currentStepId ?? undefined;
    this.update({ questions: [...this.state.questions, { id, stepId, question, askedAt: new Date().toISOString() }] });

    // Questions are read-only: the phase stays where it was.
    await this.runAgentOperation(
      {},
      (options) => this.agent.answerQuestion({ plan, stepId: stepId ?? null, question }, options),
      (answer) => ({ questions: this.state.questions.map((q) => (q.id === id ? { ...q, answer } : q)) }),
      () => ({ questions: this.state.questions.filter((q) => q.id !== id) }),
      "Ask again.",
    );
  }

  // ---------------------------------------------------------------- proposals

  async startStep(stepId: string, guard: Guard): Promise<void> {
    this.assertGuard(guard);
    this.requireStable("start a step");
    await this.propose(stepId);
  }

  async regenerateProposal(stepId: string, guard: Guard): Promise<void> {
    this.assertGuard(guard);
    this.requireStable("regenerate the proposal", ["previewReady"]);
    await this.propose(stepId);
  }

  private async propose(stepId: string): Promise<void> {
    const plan = this.requirePlan();
    const applied = new Set(this.state.history.map((h) => h.stepId));
    if (!readySteps(plan, applied).some((s) => s.id === stepId)) {
      throw new GuardError("That step is already applied or waits on earlier steps.");
    }
    const previousPhase = this.state.phase === "previewReady" ? "planReady" : this.state.phase;
    this.baselines.clear();

    await this.runAgentOperation(
      { phase: "proposing", currentStepId: stepId, proposal: null },
      async (options) => {
        const context = await this.workspace.snapshot(stepContextPaths(plan, stepId));
        let proposal = StepProposal.parse(await this.agent.proposeStep({ plan, stepId, context }, options));

        // A proposal may touch a file nobody read yet: capture its baseline and regenerate once against it.
        const unread = proposalPaths(proposal).filter((p) => !context.some((s) => s.path === p));
        if (unread.length) {
          context.push(...(await this.workspace.snapshot(unread)));
          proposal = StepProposal.parse(await this.agent.proposeStep({ plan, stepId, context }, options));
        }

        this.remember(context);
        const problems = validateProposal(proposal, plan, stepId, context);
        if (problems.length) throw new Error(problems.map((p) => p.message).join(" "));
        for (const snapshot of context) this.baselines.set(snapshot.path, snapshot);
        return proposal;
      },
      (proposal) => ({ phase: "previewReady", proposal }),
      () => ({ phase: previousPhase, currentStepId: null }),
      "Regenerate the proposal, or revise the approach.",
    );
  }

  // ---------------------------------------------------------------- applying and checking

  async applyAndContinue(proposalId: string, guard: Guard): Promise<void> {
    this.assertGuard(guard);
    const plan = this.requirePlan();
    const proposal = this.state.proposal;
    if (this.state.phase !== "previewReady" || !proposal || proposal.id !== proposalId) {
      throw new GuardError("This proposal was already applied or replaced.");
    }

    const paths = proposalPaths(proposal);
    const operationId = this.nextOperationId();
    this.update({ phase: "applying", operationId, error: null });

    const dirty = await this.workspace.dirtyPaths(paths);
    if (dirty.length) {
      return this.attention(
        { stage: "save", message: `Unsaved changes in ${dirty.join(", ")}.`, nextAction: "Save or revert those files, then regenerate the proposal." },
        { proposal: null },
      );
    }

    const current = await this.workspace.snapshot(paths);
    this.remember(current);
    const stale = validateProposal(proposal, plan, proposal.stepId, current).filter((p) => p.kind === "stale");
    if (stale.length) {
      return this.attention(
        { stage: "stale-source", message: stale.map((p) => p.message).join(" "), nextAction: "Regenerate the proposal against the current code." },
        { proposal: null },
      );
    }

    this.applyingPaths = new Set(paths);
    let outcomes;
    try {
      outcomes = await this.workspace.apply(proposal);
    } finally {
      this.applyingPaths.clear();
    }
    this.sourceGeneration += 1;

    for (const o of outcomes) if (o.appliedHash) this.knownHashes.set(o.path, o.appliedHash);

    const failed = outcomes.filter((o) => !o.applied || !o.saved);
    const appliedFiles = outcomes.filter((o) => o.applied);
    if (failed.length) {
      return this.attention(
        {
          stage: failed.some((o) => !o.applied) ? "apply" : "save",
          message: `Changed: ${appliedFiles.map((o) => o.path).join(", ") || "nothing"}. Failed: ${failed.map((o) => `${o.path} (${o.error ?? "not saved"})`).join(", ")}.`,
          nextAction: "Inspect those files, then regenerate the proposal. Nothing will be re-applied automatically.",
        },
        { proposal: null },
      );
    }

    const record = {
      stepId: proposal.stepId,
      proposalId: proposal.id,
      appliedAt: new Date().toISOString(),
      files: outcomes.map((o) => {
        const base = this.baselines.get(o.path);
        return { path: o.path, baseHash: base?.exists ? base.contentHash : null, appliedHash: o.appliedHash ?? "" };
      }),
    };
    this.baselines.clear();
    const refreshed = await this.refreshReferences(plan, proposal.stepId, paths);
    this.update({ history: [...this.state.history, record], proposal: null, plan: refreshed });

    await this.runChecks(operationId, proposal.stepId, proposal.suggestedCheckIds);
  }

  async rerunChecks(guard: Guard): Promise<void> {
    this.assertGuard(guard);
    this.requireStable("rerun checks");
    const stepId = this.state.history.at(-1)?.stepId;
    if (!stepId) throw new GuardError("No step has been applied yet.");
    const operationId = this.nextOperationId();
    this.update({ operationId, error: null });
    await this.runChecks(operationId, stepId, []);
  }

  async continueAfterFailure(guard: Guard): Promise<void> {
    this.assertGuard(guard);
    if (this.state.phase !== "needsAttention" || this.state.error?.stage !== "checks") {
      throw new GuardError("There is no failed check to continue past.");
    }
    // Failed evidence stays recorded and visible; continuing does not clear it.
    this.update({ error: null, phase: "stepReady" });
    await this.advance();
  }

  private async runChecks(operationId: string, stepId: string, suggested: string[]) {
    const all = this.workspace.checkDefinitions();
    const chosen = suggested.length ? all.filter((c) => suggested.includes(c.id)) : all;
    const checks = chosen.length ? chosen : all;
    if (checks.length === 0) {
      // Nothing configured: progress, but never claim verification.
      this.update({ phase: "stepReady", operationId: null });
      return this.advance();
    }

    this.update({ phase: "checking" });
    this.abort = new AbortController();
    const fingerprint = this.fingerprint();
    const results: CheckResult[] = [];
    try {
      for (const check of checks) {
        if (this.state.operationId !== operationId) return;
        this.emitActivity(operationId, "status", `Running ${check.label}`);
        const startedAt = new Date().toISOString();
        const run = await this.workspace.runCheck(check, this.abort.signal);
        this.resultCounter += 1;
        results.push({
          id: `r-${this.resultCounter}`,
          checkId: check.id,
          stepId,
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode: run.exitCode,
          output: run.output,
          status: run.status,
          sourceFingerprint: fingerprint,
        });
        if (run.status === "cancelled") break;
      }
    } finally {
      this.abort = null;
    }
    if (this.state.operationId !== operationId) return;

    const evidence = [...this.state.evidence, ...results];
    const plan = this.state.plan ? withDerivedInvariants(this.state.plan, all, evidence, this.fingerprint()) : null;
    const bad = results.filter((r) => r.status !== "passed");
    if (bad.length) {
      this.update({
        evidence,
        plan,
        phase: "needsAttention",
        operationId: null,
        error: {
          stage: "checks",
          message: bad.map((r) => `${r.checkId}: ${r.status}`).join(", "),
          nextAction: "The applied code was kept. Rerun the checks, revise the approach, or continue with failed checks.",
        },
      });
      return;
    }
    this.update({ evidence, plan, phase: "stepReady", operationId: null });
    await this.advance();
  }

  /** After a step: propose the next ready step, or finish. */
  private async advance() {
    const plan = this.requirePlan();
    const applied = new Set(this.state.history.map((h) => h.stepId));
    const next = readySteps(plan, applied)[0];
    if (!next) {
      const allApplied = plan.steps.every((s) => applied.has(s.id));
      this.update({ phase: allApplied ? "complete" : "stepReady", currentStepId: null });
      return;
    }
    await this.propose(next.id);
  }

  // ---------------------------------------------------------------- source changes

  /**
   * Called for every saved, created or deleted workspace file. Our own apply is ignored; anything else
   * invalidates check evidence, marks changed references stale, and retires a proposal made against old content.
   */
  async noteSourceChanged(paths: string[]): Promise<void> {
    const candidates = paths.filter((p) => !this.applyingPaths.has(p));
    if (candidates.length === 0 || !this.state.plan) return;

    // Content, not events, decides: a save that matches what the session wrote is not an outside edit.
    const snapshots = (await this.workspace.snapshot(candidates)).filter((snap) => {
      const hash = snap.exists ? snap.contentHash : "missing";
      const changed = this.knownHashes.get(snap.path) !== hash;
      this.knownHashes.set(snap.path, hash);
      return changed;
    });
    const external = snapshots.map((s) => s.path);
    if (external.length === 0 || !this.state.plan) return;
    this.sourceGeneration += 1;

    const plan: FeaturePlan = {
      ...this.state.plan,
      concepts: this.state.plan.concepts.map((c) => ({
        ...c,
        sourceRefs: c.sourceRefs.map((ref) => {
          const snap = snapshots.find((s) => s.path === ref.path);
          if (!snap) return ref;
          if (!snap.exists) return { ...ref, status: "missing" as const };
          return rangeHash(snap.content, ref) === ref.contentHash ? ref : { ...ref, status: "stale" as const };
        }),
      })),
    };
    const derived = this.derive(plan);

    const proposal = this.state.proposal;
    const touchesProposal = proposal && proposalPaths(proposal).some((p) => external.includes(p));
    if (touchesProposal && this.state.phase === "previewReady") {
      this.baselines.clear();
      this.update({
        plan: derived,
        proposal: null,
        phase: "needsAttention",
        error: {
          stage: "stale-source",
          message: `${external.filter((p) => proposalPaths(proposal).includes(p)).join(", ")} changed after the proposal was made.`,
          nextAction: "Regenerate the proposal against the current code.",
        },
      });
      return;
    }
    this.update({ plan: derived });
  }

  // ---------------------------------------------------------------- lifecycle

  cancel(guard: { sessionId: string }) {
    this.assertGuard(guard);
    if (!this.state.operationId) return;
    if (this.state.phase === "applying") return; // reconciliation must finish first
    this.abort?.abort();
    this.agent.cancel();
  }

  /** Discards session metadata only; source files are never touched. */
  reset() {
    this.abort?.abort();
    this.agent.cancel();
    this.baselines.clear();
    const fresh = emptyState(this.state.sessionId, this.state.workspaceId);
    this.state = { ...fresh, stateRevision: this.state.stateRevision + 1 };
    this.events.onState(this.state);
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Runs one read-only agent call: enter `start`, then apply `done(result)` or roll back with `rollback()`.
   * Late results from a superseded or cancelled operation are ignored.
   */
  private async runAgentOperation<T>(
    start: Partial<ApplicationState>,
    call: (options: AgentCallOptions) => Promise<T>,
    done: (result: T) => Partial<ApplicationState>,
    rollback: () => Partial<ApplicationState>,
    nextAction: string,
  ): Promise<void> {
    const operationId = this.nextOperationId();
    this.abort = new AbortController();
    this.update({ ...start, operationId, error: null });
    try {
      const result = await call({
        operationId,
        signal: this.abort.signal,
        onActivity: (event) => this.emitActivity(operationId, event.kind, event.message),
      });
      if (this.state.operationId !== operationId) return;
      this.update({ ...done(result), operationId: null });
    } catch (err) {
      if (this.state.operationId !== operationId) return;
      const cancelled = err instanceof AgentCancelledError;
      this.update({
        ...rollback(),
        operationId: null,
        error: cancelled ? null : { stage: "invalid-output", message: err instanceof Error ? err.message : String(err), nextAction },
      });
    } finally {
      this.abort = null;
    }
  }

  private remember(snapshots: FileSnapshot[]) {
    for (const snap of snapshots) this.knownHashes.set(snap.path, snap.exists ? snap.contentHash : "missing");
  }

  private attention(error: RecoverableError, patch: Partial<ApplicationState> = {}) {
    this.baselines.clear();
    this.update({ ...patch, phase: "needsAttention", operationId: null, error });
  }

  private async refreshReferences(plan: FeaturePlan, stepId: string, changedPaths: string[]): Promise<FeaturePlan> {
    const step = plan.steps.find((s) => s.id === stepId);
    const refsByPath = new Map<string, SourceRef[]>();
    for (const path of changedPaths) refsByPath.set(path, await this.workspace.referencesFor(path));

    return this.derive({
      ...plan,
      concepts: plan.concepts.map((concept) => {
        const inStep = step?.conceptIds.includes(concept.id) ?? false;
        const ownPaths = new Set(concept.intendedPaths);
        // Concepts in this step link to the files it changed that they own; other concepts keep their refs.
        const kept = concept.sourceRefs.filter((r) => !changedPaths.includes(r.path) || !inStep);
        const added = inStep ? changedPaths.filter((p) => ownPaths.has(p)).flatMap((p) => refsByPath.get(p) ?? []) : [];
        // A reference in a changed file outside this step can no longer be trusted.
        const checked = kept.map((r) => (changedPaths.includes(r.path) ? { ...r, status: "stale" as const } : r));
        return { ...concept, sourceRefs: [...checked, ...added] };
      }),
    });
  }

  private derive(plan: FeaturePlan): FeaturePlan {
    return withDerivedInvariants(plan, this.workspace.checkDefinitions(), this.state.evidence, this.fingerprint());
  }

  /** Applied steps stay frozen: a revision may change only steps that have not been applied. */
  private keepAppliedHistory(previous: FeaturePlan, revised: FeaturePlan): FeaturePlan {
    const applied = new Set(this.state.history.map((h) => h.stepId));
    const frozen = previous.steps.filter((s) => applied.has(s.id));
    const future = revised.steps.filter((s) => !applied.has(s.id));
    return { ...revised, steps: [...frozen, ...future] };
  }

  private requirePlan(): FeaturePlan {
    if (!this.state.plan) throw new GuardError("Start a feature first.");
    return this.state.plan;
  }

  private requireStable(action: string, alsoAllowed: Phase[] = []) {
    const phase = this.state.phase;
    if (BUSY_PHASES.has(phase) || this.state.operationId) throw new GuardError(`Cannot ${action} while the session is busy.`);
    if (!STABLE_PHASES.has(phase) && !alsoAllowed.includes(phase)) throw new GuardError(`Cannot ${action} right now (${phase}).`);
  }

  private fingerprint() {
    return `gen-${this.sourceGeneration}`;
  }

  private emitActivity(operationId: string, kind: ActivityEvent["kind"], message: string) {
    if (this.state.operationId === operationId) this.events.onActivity({ operationId, kind, message, at: new Date().toISOString() });
  }

  private nextOperationId() {
    this.operationCounter += 1;
    return `op-${this.operationCounter}`;
  }

  private update(patch: Partial<ApplicationState>) {
    this.state = { ...this.state, ...patch, stateRevision: this.state.stateRevision + 1 };
    this.events.onState(this.state);
  }
}

/** Hash of the referenced line range, matching how references are created. */
export function rangeHash(content: string, ref: Pick<SourceRef, "startLine" | "endLine">): string {
  return contentHash(content.split("\n").slice(ref.startLine - 1, ref.endLine).join("\n"));
}
