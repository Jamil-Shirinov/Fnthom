// Deterministic stand-in for Factory Droid, driven by the caching fixture in demo/fixtures/.
// Used for UI work and tests until the real adapter passes the proposal-only gate.

import planFixture from "../../demo/fixtures/caching-plan.json";
import proposalFixtures from "../../demo/fixtures/caching-proposals.json";
import { FeaturePlan, StepProposal, parsePlan, type FileSnapshot } from "../shared/schema";
import { AgentCancelledError, type AgentAdapter, type AgentCallOptions } from "./adapter";

export type FakeAdapterOptions = {
  /** Simulated latency per activity event, in ms. Tests use 0. */
  delayMs?: number;
};

export class FakeAgentAdapter implements AgentAdapter {
  private readonly delayMs: number;
  private readonly controllers = new Set<AbortController>();

  constructor(options: FakeAdapterOptions = {}) {
    this.delayMs = options.delayMs ?? 400;
  }

  async inspectAndPlan(request: { intent: string; context: FileSnapshot[] }, options: AgentCallOptions): Promise<FeaturePlan> {
    await this.activity(options, "status", "Reading project metadata and the weather endpoint");
    await this.activity(options, "tool", "Read src/app.ts, src/upstream.ts, src/schema.ts");
    await this.activity(options, "status", "Drafting the implementation map");

    const parsed = parsePlan({ ...planFixture, intent: request.intent });
    if (!parsed.ok) throw new Error(`Fixture plan is invalid: ${parsed.issues.map((i) => i.message).join("; ")}`);
    return parsed.plan;
  }

  async proposeStep(
    request: { plan: FeaturePlan; stepId: string; context: FileSnapshot[] },
    options: AgentCallOptions,
  ): Promise<StepProposal> {
    const fixture = (proposalFixtures as Record<string, unknown>)[request.stepId];
    if (!fixture) throw new Error(`No fixture proposal for step "${request.stepId}"`);
    await this.activity(options, "status", `Proposing "${request.plan.steps.find((s) => s.id === request.stepId)?.title}"`);

    const proposal = StepProposal.parse(fixture);
    // A real agent proposes against the snapshots it was given; mirror that for update baselines.
    const files = proposal.files.map((file) => {
      if (file.kind !== "update") return file;
      const snapshot = request.context.find((s) => s.path === file.path);
      return snapshot ? { ...file, baseHash: snapshot.contentHash } : file;
    });
    return { ...proposal, planRevision: request.plan.revision, files };
  }

  async answerQuestion(
    request: { plan: FeaturePlan; stepId: string | null; question: string },
    options: AgentCallOptions,
  ): Promise<string> {
    await this.activity(options, "status", "Thinking about your question");
    const step = request.plan.steps.find((s) => s.id === request.stepId);
    return step
      ? `This step ("${step.title}") is expected to: ${step.expectedBehavior} (Fake agent: canned answer.)`
      : `The plan: ${request.plan.summary} (Fake agent: canned answer.)`;
  }

  async revisePlan(
    request: { plan: FeaturePlan; instruction: string; appliedStepIds: string[] },
    options: AgentCallOptions,
  ): Promise<FeaturePlan> {
    await this.activity(options, "status", "Revising the remaining steps");
    return FeaturePlan.parse({
      ...request.plan,
      revision: request.plan.revision + 1,
      assumptions: [...request.plan.assumptions, `Revision requested: ${request.instruction}`],
    });
  }

  cancel(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  dispose(): void {
    this.cancel();
  }

  private async activity(options: AgentCallOptions, kind: "status" | "tool" | "text", message: string) {
    if (options.signal.aborted) throw new AgentCancelledError();
    options.onActivity({ kind, message });
    if (this.delayMs > 0) await this.sleep(this.delayMs, options.signal);
  }

  private sleep(ms: number, signal: AbortSignal) {
    const controller = new AbortController();
    this.controllers.add(controller);
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        this.controllers.delete(controller);
        signal.removeEventListener("abort", abort);
        controller.signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        done();
        reject(new AgentCancelledError());
      };
      const timer = setTimeout(() => {
        done();
        resolve();
      }, ms);
      signal.addEventListener("abort", abort);
      controller.signal.addEventListener("abort", abort);
    });
  }
}
