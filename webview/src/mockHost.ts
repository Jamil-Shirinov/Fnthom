// Browser-only stand-in for the extension host, so the UI can be built without launching VS Code.
// Shows a mid-session state (one step applied, one active, one stale reference) to exercise every visual state.

import planFixture from "../../demo/fixtures/caching-plan.json";
import { PROTOCOL_VERSION, type HostMessage } from "../../src/shared/messages";
import { FeaturePlan, emptyState, type ApplicationState } from "../../src/shared/schema";

export function createMockHost(deliver: (message: HostMessage) => void) {
  let state: ApplicationState = emptyState("preview-session", "preview-workspace");

  const snapshot = () => deliver({ protocolVersion: PROTOCOL_VERSION, type: "stateSnapshot", payload: state });
  const set = (patch: Partial<ApplicationState>) => {
    state = { ...state, ...patch, stateRevision: state.stateRevision + 1 };
    snapshot();
  };

  return (raw: unknown) => {
    const message = raw as { type: string; requestId: string; payload: Record<string, unknown> };
    const done = () => deliver({ protocolVersion: PROTOCOL_VERSION, type: "requestComplete", requestId: message.requestId, payload: {} });

    switch (message.type) {
      case "ready":
        snapshot();
        return;
      case "startFeature": {
        set({ phase: "inspecting", operationId: "op-preview", plan: null });
        deliver({
          protocolVersion: PROTOCOL_VERSION,
          type: "activity",
          payload: { operationId: "op-preview", kind: "status", message: "Reading the weather endpoint", at: new Date().toISOString() },
        });
        setTimeout(() => {
          set({ phase: "planReady", operationId: null, ...midSessionPreview(String(message.payload.intent)) });
          done();
        }, 700);
        return;
      }
      case "resetSession":
        state = { ...emptyState(state.sessionId, state.workspaceId), stateRevision: state.stateRevision + 1 };
        snapshot();
        done();
        return;
      case "selectConcept":
        return;
      default:
        deliver({
          protocolVersion: PROTOCOL_VERSION,
          type: "requestError",
          requestId: message.requestId,
          payload: { message: `Preview host: "${message.type}" is handled by the real extension.` },
        });
    }
  };
}

function midSessionPreview(intent: string): Pick<ApplicationState, "plan" | "history" | "currentStepId"> {
  const plan = FeaturePlan.parse({ ...planFixture, intent });
  const upstream = plan.concepts.find((c) => c.id === "c-upstream");
  if (upstream?.sourceRefs[0]) upstream.sourceRefs[0].status = "stale";
  // After a step is applied the host resolves real references; mimic that for the applied concepts.
  const cacheRef = (symbol: string, startLine: number, endLine: number) =>
    ({ path: "src/cache.ts", symbol, startLine, endLine, contentHash: "sha256:preview", status: "resolved" }) as const;
  const lookup = plan.concepts.find((c) => c.id === "c-cache-lookup");
  if (lookup) {
    lookup.sourceRefs.push(cacheRef("createTtlCache", 8, 29), cacheRef("cacheKey", 32, 34));
    if (lookup.invariants[0]) lookup.invariants[0].status = "supported";
  }
  plan.concepts.find((c) => c.id === "c-cache-write")?.sourceRefs.push(cacheRef("createTtlCache", 8, 29));
  return {
    plan,
    currentStepId: "s-use-cache",
    history: [
      {
        stepId: "s-cache-module",
        proposalId: "p-cache-module",
        appliedAt: new Date().toISOString(),
        files: [{ path: "src/cache.ts", baseHash: null, appliedHash: "sha256:preview" }],
      },
    ],
  };
}
