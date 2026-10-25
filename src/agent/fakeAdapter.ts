// Deterministic stand-in for Factory Droid, driven by the scripted caching scenario in fakeScenario.ts.
// Used for the demo and tests until the real adapter passes the proposal-only gate.

import type { FileChange, FileSnapshot, PlannedFunction, PlanningTurn } from "../shared/schema";
import { AgentCancelledError, type AgentAdapter, type AgentCallOptions, type Decision } from "./adapter";
import {
  EXISTING_DESCRIPTIONS,
  REWORK_NOTES,
  STEP_KEYS,
  SUMMARY,
  choicesFrom,
  filesFor,
  proposalFor,
  stepOf,
  upcomingAfter,
  previewFor,
} from "./fakeScenario";

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

  async planNext(
    request: { intent: string; context: FileSnapshot[]; history: PlannedFunction[]; lastDecision: Decision | null },
    options: AgentCallOptions,
  ): Promise<PlanningTurn> {
    if (!request.context.some((s) => s.path === "src/app.ts" && s.exists)) {
      throw new Error("The fake agent only knows the weather demo. Open the demo/app folder, or connect a real agent.");
    }
    if (!request.lastDecision) {
      await this.activity(options, "tool", "Read src/app.ts, src/upstream.ts, src/schema.ts, src/server.ts");
    }
    const rejected = request.lastDecision?.decision === "rejected";
    await this.activity(options, "status", rejected ? "Reworking the remaining plan around your rejection" : "Planning the next function");

    const choices = choicesFrom(request.history);
    const accepted = new Set(request.history.filter((f) => f.status === "accepted").map((f) => stepOf(f.id)));
    const index = STEP_KEYS.findIndex((step) => !accepted.has(step));
    if (index === -1) return { summary: SUMMARY, next: null, upcoming: [] };

    const step = STEP_KEYS[index]!;
    const attempts = request.history.filter((f) => stepOf(f.id) === step).length;
    let reworkNote: string | undefined;
    if (rejected && request.lastDecision) {
      const rejectedStep = stepOf(request.lastDecision.functionId);
      if (rejectedStep) {
        reworkNote = REWORK_NOTES[rejectedStep][choices[rejectedStep] === 1 ? 0 : 1];
        if (attempts >= 2) reworkNote += " (The demo agent has two designs per function, so you are seeing the first one again.)";
        if (request.lastDecision.reason) reworkNote += ` You said: "${request.lastDecision.reason}".`;
      }
    }
    const proposal = proposalFor(step, choices);
    return {
      summary: SUMMARY,
      next: {
        id: `fn-${step}-${attempts + 1}`,
        ...proposal,
        preview: previewFor(step, choices, request.context),
        ...(rejected && request.lastDecision ? { replacesId: request.lastDecision.functionId } : {}),
      },
      upcoming: upcomingAfter(index, choices),
      ...(reworkNote ? { reworkNote } : {}),
    };
  }

  async implement(
    request: { intent: string; functions: PlannedFunction[]; context: FileSnapshot[] },
    options: AgentCallOptions,
  ): Promise<FileChange[]> {
    const accepted = request.functions.filter((f) => f.status === "accepted").length;
    await this.activity(options, "status", `Writing code for ${accepted} accepted functions`);
    return filesFor(choicesFrom(request.functions), request.context);
  }

  async describe(
    request: { nodes: { id: string; name: string; path: string; code: string }[] },
    options: AgentCallOptions,
  ): Promise<Record<string, string>> {
    await this.activity(options, "status", "Describing existing functions");
    return Object.fromEntries(request.nodes.flatMap((n) => (EXISTING_DESCRIPTIONS[n.id] ? [[n.id, EXISTING_DESCRIPTIONS[n.id]!]] : [])));
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
