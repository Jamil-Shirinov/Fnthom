// Application-owned agent interface (application-spec.md, section 8).
// SDK-specific types stay behind this boundary; callers receive validated domain objects.

import type { ActivityEvent } from "../shared/messages";
import type { FeaturePlan, FileSnapshot, StepProposal } from "../shared/schema";

export type AgentCallOptions = {
  operationId: string;
  signal: AbortSignal;
  onActivity: (event: Omit<ActivityEvent, "operationId" | "at">) => void;
};

export interface AgentAdapter {
  /** Read-only: inspect context and return a validated plan. Must not modify the workspace. */
  inspectAndPlan(request: { intent: string; context: FileSnapshot[] }, options: AgentCallOptions): Promise<FeaturePlan>;
  /** Read-only: propose the current step's full-content file changes against the given snapshots. */
  proposeStep(
    request: { plan: FeaturePlan; stepId: string; context: FileSnapshot[] },
    options: AgentCallOptions,
  ): Promise<StepProposal>;
  /** Read-only: answer a question about the plan or the current step. */
  answerQuestion(
    request: { plan: FeaturePlan; stepId: string | null; question: string },
    options: AgentCallOptions,
  ): Promise<string>;
  /** Read-only: replan the remaining steps; applied steps are passed so their history stays frozen. */
  revisePlan(
    request: { plan: FeaturePlan; instruction: string; appliedStepIds: string[] },
    options: AgentCallOptions,
  ): Promise<FeaturePlan>;
  cancel(): void;
  dispose(): void;
}

export class AgentCancelledError extends Error {
  constructor() {
    super("Agent operation was cancelled");
    this.name = "AgentCancelledError";
  }
}
