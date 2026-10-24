// Authoritative session state machine (application-spec.md, section 6).
// Step 1 implements inspecting -> planReady, cancellation and reset. Later steps add
// proposing, applying, checking, questions and revisions on the same guards.

import type { ActivityEvent } from "../shared/messages";
import { emptyState, type ApplicationState, type Phase } from "../shared/schema";
import { AgentCancelledError, type AgentAdapter } from "./adapter";

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

const STABLE_PHASES: ReadonlySet<Phase> = new Set(["idle", "planReady", "stepReady", "needsAttention", "complete"]);

export class SessionController {
  private state: ApplicationState;
  private abort: AbortController | null = null;
  private operationCounter = 0;

  constructor(
    private readonly agent: AgentAdapter,
    private readonly events: ControllerEvents,
    init: { sessionId: string; workspaceId: string },
  ) {
    this.state = emptyState(init.sessionId, init.workspaceId);
  }

  getState(): ApplicationState {
    return this.state;
  }

  /** Rejects actions made against another session or an older state revision. */
  assertGuard(guard: { sessionId: string; expectedRevision?: number }) {
    if (guard.sessionId !== this.state.sessionId) throw new GuardError("This action belongs to a different session.");
    if (guard.expectedRevision !== undefined && guard.expectedRevision !== this.state.stateRevision) {
      throw new GuardError("The session changed since this action was made. Review the latest state and try again.");
    }
  }

  async startFeature(intent: string, guard: { sessionId: string; expectedRevision: number }): Promise<void> {
    this.assertGuard(guard);
    if (this.state.phase !== "idle" && this.state.phase !== "planReady") {
      throw new GuardError(`Cannot start a feature while the session is ${this.state.phase}.`);
    }

    const previous = this.state;
    const operationId = this.nextOperationId();
    this.abort = new AbortController();
    this.update({ phase: "inspecting", operationId, error: null, plan: null, currentStepId: null, proposal: null });

    try {
      const plan = await this.agent.inspectAndPlan(
        // Context collection (src/workspace/context.ts) lands in step 2.
        { intent, context: [] },
        {
          operationId,
          signal: this.abort.signal,
          onActivity: (event) => {
            if (this.state.operationId === operationId) {
              this.events.onActivity({ ...event, operationId, at: new Date().toISOString() });
            }
          },
        },
      );
      if (this.state.operationId !== operationId) return; // superseded or cancelled
      this.update({ phase: "planReady", plan, operationId: null });
    } catch (err) {
      if (this.state.operationId !== operationId) return;
      const cancelled = err instanceof AgentCancelledError;
      this.update({
        phase: STABLE_PHASES.has(previous.phase) ? previous.phase : "idle",
        plan: previous.plan,
        operationId: null,
        error: cancelled
          ? null
          : {
              stage: "invalid-output",
              message: err instanceof Error ? err.message : String(err),
              nextAction: "Try again, or narrow the request.",
            },
      });
    } finally {
      this.abort = null;
    }
  }

  cancel(guard: { sessionId: string }) {
    this.assertGuard(guard);
    if (!this.state.operationId) return;
    this.abort?.abort();
    this.agent.cancel();
  }

  /** Discards session metadata only; source files are never touched. */
  reset() {
    this.abort?.abort();
    this.agent.cancel();
    const fresh = emptyState(this.state.sessionId, this.state.workspaceId);
    this.state = { ...fresh, stateRevision: this.state.stateRevision + 1 };
    this.events.onState(this.state);
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
