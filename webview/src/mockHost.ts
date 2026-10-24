// Browser-only stand-in for the extension host, so the UI can be built without launching VS Code.
// Walks the caching fixture through the whole step loop with simulated delays.
// Add ?fail=1 to the preview URL to make the first check run fail.

import planFixture from "../../demo/fixtures/caching-plan.json";
import proposalFixtures from "../../demo/fixtures/caching-proposals.json";
import { PROTOCOL_VERSION, type HostMessage } from "../../src/shared/messages";
import { FeaturePlan, StepProposal, emptyState, readySteps, type ApplicationState } from "../../src/shared/schema";

const DELAY_MS = 600;

export function createMockHost(deliver: (message: HostMessage) => void) {
  let state: ApplicationState = emptyState("preview-session", "preview-workspace");
  let failNextCheck = new URLSearchParams(window.location.search).has("fail");
  let counter = 0;

  const snapshot = () => deliver({ protocolVersion: PROTOCOL_VERSION, type: "stateSnapshot", payload: state });
  const set = (patch: Partial<ApplicationState>) => {
    state = { ...state, ...patch, stateRevision: state.stateRevision + 1 };
    snapshot();
  };
  const activity = (message: string) =>
    deliver({
      protocolVersion: PROTOCOL_VERSION,
      type: "activity",
      payload: { operationId: state.operationId ?? "op-preview", kind: "status", message, at: new Date().toISOString() },
    });
  const later = (fn: () => void) => setTimeout(fn, DELAY_MS);
  const op = () => `op-preview-${(counter += 1)}`;

  const propose = (stepId: string) => {
    set({ phase: "proposing", currentStepId: stepId, proposal: null, operationId: op(), error: null });
    activity(`Proposing "${state.plan?.steps.find((s) => s.id === stepId)?.title}"`);
    later(() => {
      const fixture = (proposalFixtures as Record<string, unknown>)[stepId];
      set({ phase: "previewReady", proposal: StepProposal.parse(fixture), operationId: null });
    });
  };

  const advance = () => {
    const plan = state.plan!;
    const applied = new Set(state.history.map((h) => h.stepId));
    const next = readySteps(plan, applied)[0];
    if (next) return propose(next.id);
    set({ phase: "complete", currentStepId: null });
  };

  const runChecks = (stepId: string) => {
    set({ phase: "checking", operationId: state.operationId ?? op() });
    activity("Running Demo tests");
    later(() => {
      const failed = failNextCheck;
      failNextCheck = false;
      const now = new Date().toISOString();
      const result = {
        id: `r-${(counter += 1)}`,
        checkId: "demo-tests",
        stepId,
        startedAt: now,
        finishedAt: now,
        exitCode: failed ? 1 : 0,
        output: failed ? "FAIL test/cache.test.ts > expires entries\nAssertionError: expected 1 to be 2" : "Test Files  2 passed (2)\n     Tests  6 passed (6)",
        status: failed ? ("failed" as const) : ("passed" as const),
        sourceFingerprint: "gen-preview",
      };
      const evidence = [...state.evidence, result];
      const plan = withStatus(state.plan!, failed ? "failed" : "supported");
      if (failed) {
        set({
          evidence,
          plan,
          phase: "needsAttention",
          operationId: null,
          error: {
            stage: "checks",
            message: "demo-tests: failed",
            nextAction: "The applied code was kept. Rerun the checks, revise the approach, or continue with failed checks.",
          },
        });
        return;
      }
      set({ evidence, plan, phase: "stepReady", operationId: null, error: null });
      advance();
    });
  };

  return (raw: unknown) => {
    const message = raw as { type: string; requestId: string; payload: Record<string, unknown> };
    const done = () => deliver({ protocolVersion: PROTOCOL_VERSION, type: "requestComplete", requestId: message.requestId, payload: {} });
    const fail = (text: string) =>
      deliver({ protocolVersion: PROTOCOL_VERSION, type: "requestError", requestId: message.requestId, payload: { message: text } });

    switch (message.type) {
      case "ready":
        snapshot();
        return;
      case "startFeature":
        set({ ...emptyState(state.sessionId, state.workspaceId), stateRevision: state.stateRevision, phase: "inspecting", operationId: op() });
        activity("Reading the weather endpoint");
        later(() => {
          set({ phase: "planReady", operationId: null, plan: FeaturePlan.parse({ ...planFixture, intent: String(message.payload.intent) }) });
          done();
        });
        return;
      case "startStep":
      case "regenerateProposal":
        propose(String(message.payload.stepId));
        return done();
      case "applyAndContinue": {
        const proposal = state.proposal!;
        set({ phase: "applying", operationId: op() });
        activity("Applying and saving files");
        later(() => {
          const record = {
            stepId: proposal.stepId,
            proposalId: proposal.id,
            appliedAt: new Date().toISOString(),
            files: proposal.files.map((f) => ({ path: f.path, baseHash: f.kind === "update" ? f.baseHash : null, appliedHash: "sha256:preview" })),
          };
          set({ history: [...state.history, record], proposal: null, plan: withRefs(state.plan!, proposal) });
          runChecks(proposal.stepId);
        });
        return done();
      }
      case "rerunChecks":
        runChecks(state.history.at(-1)!.stepId);
        return done();
      case "continueAfterFailure":
        set({ phase: "stepReady", error: null });
        advance();
        return done();
      case "askQuestion": {
        const id = `q-${state.questions.length + 1}`;
        const question = String(message.payload.question);
        set({ questions: [...state.questions, { id, question, stepId: state.currentStepId ?? undefined, askedAt: new Date().toISOString() }] });
        later(() =>
          set({
            questions: state.questions.map((q) =>
              q.id === id ? { ...q, answer: "A short TTL keeps answers fresh without an eviction policy. (Preview: canned answer.)" } : q,
            ),
          }),
        );
        return done();
      }
      case "reviseApproach":
        set({ phase: "revising", operationId: op(), proposal: null });
        later(() =>
          set({
            phase: "planReady",
            operationId: null,
            currentStepId: null,
            plan: { ...state.plan!, revision: state.plan!.revision + 1, assumptions: [...state.plan!.assumptions, `Revision requested: ${message.payload.instruction}`] },
          }),
        );
        return done();
      case "cancel":
        set({ operationId: null, phase: state.plan ? "planReady" : "idle" });
        return done();
      case "resetSession":
        state = { ...emptyState(state.sessionId, state.workspaceId), stateRevision: state.stateRevision + 1 };
        snapshot();
        return done();
      case "selectConcept":
        return;
      default:
        fail(`Preview host: "${message.type}" opens an editor, so it only works in VS Code.`);
    }
  };
}

/** After an apply the host resolves real references; mimic that for the step's concepts. */
function withRefs(plan: FeaturePlan, proposal: StepProposal): FeaturePlan {
  const step = plan.steps.find((s) => s.id === proposal.stepId)!;
  return {
    ...plan,
    concepts: plan.concepts.map((c) => {
      if (!step.conceptIds.includes(c.id)) return c;
      const path = c.intendedPaths.find((p) => proposal.files.some((f) => f.path === p)) ?? proposal.files[0]!.path;
      return { ...c, sourceRefs: [...c.sourceRefs, { path, startLine: 1, endLine: 20, contentHash: "sha256:preview", status: "resolved" as const }] };
    }),
  };
}

function withStatus(plan: FeaturePlan, status: "supported" | "failed"): FeaturePlan {
  return {
    ...plan,
    concepts: plan.concepts.map((c) => ({
      ...c,
      invariants: c.invariants.map((inv) => (c.sourceRefs.length ? { ...inv, status } : inv)),
    })),
  };
}
