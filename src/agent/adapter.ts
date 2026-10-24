// Application-owned agent interface (application-spec.md, section 8).
// SDK-specific types stay behind this boundary; callers receive validated domain objects.

import type { ActivityEvent } from "../shared/messages";
import type { FileChange, FileSnapshot, PlannedFunction, PlanningTurn } from "../shared/schema";

export type AgentCallOptions = {
  operationId: string;
  signal: AbortSignal;
  onActivity: (event: Omit<ActivityEvent, "operationId" | "at">) => void;
};

export type Decision = { functionId: string; decision: "accepted" | "rejected"; reason?: string };

export interface AgentAdapter {
  /**
   * Read-only: propose the next function, or `next: null` when the plan is complete. `history` holds every
   * earlier proposal with its decision. After a rejection the agent must rework the upcoming functions
   * around it and say what changed in `reworkNote`.
   */
  planNext(
    request: { intent: string; context: FileSnapshot[]; history: PlannedFunction[]; lastDecision: Decision | null },
    options: AgentCallOptions,
  ): Promise<PlanningTurn>;
  /**
   * Read-only: write the code for every accepted function as full-content changes against the given snapshots.
   * `functions` is the whole planning history; rejected entries say which designs to avoid.
   */
  implement(
    request: { intent: string; functions: PlannedFunction[]; context: FileSnapshot[] },
    options: AgentCallOptions,
  ): Promise<FileChange[]>;
  /** Read-only: one-sentence purposes for graph nodes that have neither a plan entry nor a doc comment. */
  describe(
    request: { nodes: { id: string; name: string; path: string; code: string }[] },
    options: AgentCallOptions,
  ): Promise<Record<string, string>>;
  cancel(): void;
  dispose(): void;
}

export class AgentCancelledError extends Error {
  constructor() {
    super("Agent operation was cancelled");
    this.name = "AgentCancelledError";
  }
}
