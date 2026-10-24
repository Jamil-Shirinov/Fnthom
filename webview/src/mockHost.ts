// Browser-only stand-in for the extension host, so the UI can be built without launching VS Code.
// Planning runs the real scripted demo agent; implementation is simulated and ends on a pre-built graph
// of the default designs (webview/src/fixtures/caching-graphs.json, from `npm run preview:fixture`).
// Add ?fail=1 to the preview URL to make the check fail.

import type { Decision } from "../../src/agent/adapter";
import { FakeAgentAdapter } from "../../src/agent/fakeAdapter";
import { PROTOCOL_VERSION, type HostMessage } from "../../src/shared/messages";
import { CodeGraph, emptyState, type AppliedFile, type ApplicationState, type FileSnapshot } from "../../src/shared/schema";
import graphs from "./fixtures/caching-graphs.json";

const DELAY_MS = 500;
const CONTEXT: FileSnapshot[] = [{ path: "src/app.ts", exists: true, content: "", contentHash: "sha256:preview" }];

export function createMockHost(deliver: (message: HostMessage) => void) {
  const agent = new FakeAgentAdapter({ delayMs: DELAY_MS });
  const fail = new URLSearchParams(window.location.search).has("fail");
  let state: ApplicationState = emptyState("preview-session", "preview-workspace");
  let counter = 0;
  let intent = "";

  const snapshot = () => deliver({ protocolVersion: PROTOCOL_VERSION, type: "stateSnapshot", payload: state });
  const set = (patch: Partial<ApplicationState>) => {
    state = { ...state, ...patch, stateRevision: state.stateRevision + 1 };
    snapshot();
  };
  const begin = (patch: Partial<ApplicationState>) => {
    const operationId = `op-${(counter += 1)}`;
    set({ ...patch, operationId, error: null });
    return operationId;
  };
  const options = (operationId: string) => ({
    operationId,
    signal: new AbortController().signal,
    onActivity: (e: { kind: "status" | "tool" | "text"; message: string }) =>
      deliver({ protocolVersion: PROTOCOL_VERSION, type: "activity", payload: { operationId, ...e, at: new Date().toISOString() } }),
  });
  const wait = () => new Promise((resolve) => setTimeout(resolve, DELAY_MS * 2));

  const plan = async (phase: "planning" | "reworking", lastDecision: Decision | null) => {
    const operationId = begin({ phase });
    const history = state.plan?.functions ?? [];
    const turn = await agent.planNext({ intent, context: CONTEXT, history, lastDecision }, options(operationId));
    const functions = turn.next ? [...history, { ...turn.next, status: "proposed" as const }] : history;
    set({ plan: { intent, summary: turn.summary, functions, upcoming: turn.upcoming, reworkNote: turn.reworkNote ?? null } });
    if (turn.next) return set({ phase: "reviewing", operationId: null });

    set({ phase: "implementing" });
    options(operationId).onActivity({ kind: "status", message: "Writing src/cache.ts, src/cachedUpstream.ts, src/app.ts, test/cache.test.ts" });
    await wait();
    set({ phase: "checking", applied: graphs.applied as AppliedFile[] });
    options(operationId).onActivity({ kind: "status", message: "Running Weather API tests" });
    await wait();
    const now = new Date().toISOString();
    set({
      phase: "done",
      operationId: null,
      graph: CodeGraph.parse(graphs.after),
      checks: [
        {
          id: "r-1",
          checkId: "demo-tests",
          label: "Weather API tests",
          startedAt: now,
          finishedAt: now,
          exitCode: fail ? 1 : 0,
          status: fail ? "failed" : "passed",
          output: fail
            ? "FAIL test/cache.test.ts > weather caching > forgets entries after the TTL\nAssertionError: expected 1 to be undefined"
            : " ✓ test/weather.test.ts (3 tests)\n ✓ test/cache.test.ts (4 tests)\n Test Files  2 passed (2)\n      Tests  7 passed (7)",
        },
      ],
    });
  };

  const decide = (functionId: string, decision: Decision) => {
    const p = state.plan!;
    set({
      plan: {
        ...p,
        functions: p.functions.map((f) =>
          f.id === functionId ? { ...f, status: decision.decision, ...(decision.reason ? { rejectionReason: decision.reason } : {}) } : f,
        ),
      },
    });
  };

  return (raw: unknown) => {
    const message = raw as { type: string; requestId: string; payload: Record<string, unknown> };
    const done = () => deliver({ protocolVersion: PROTOCOL_VERSION, type: "requestComplete", requestId: message.requestId, payload: {} });
    const p = message.payload;

    switch (message.type) {
      case "ready":
        return snapshot();
      case "startFeature":
        intent = String(p.intent);
        set({ ...emptyState(state.sessionId, state.workspaceId), stateRevision: state.stateRevision });
        void plan("planning", null).then(done);
        return;
      case "acceptFunction": {
        const decision: Decision = { functionId: String(p.functionId), decision: "accepted" };
        decide(decision.functionId, decision);
        void plan("planning", decision).then(done);
        return;
      }
      case "rejectFunction": {
        const decision: Decision = { functionId: String(p.functionId), decision: "rejected", ...(p.reason ? { reason: String(p.reason) } : {}) };
        decide(decision.functionId, decision);
        void plan("reworking", decision).then(done);
        return;
      }
      case "showGraph":
        set({ graph: CodeGraph.parse(state.applied.length ? graphs.after : graphs.before) });
        return done();
      case "rerunChecks":
        return done();
      case "resetSession":
        state = { ...emptyState(state.sessionId, state.workspaceId), stateRevision: state.stateRevision + 1 };
        snapshot();
        return done();
      case "openNode":
        // The pop-up still shows; only the editor tab needs VS Code.
        return done();
      case "previewChange":
      case "export":
        deliver({
          protocolVersion: PROTOCOL_VERSION,
          type: "requestError",
          requestId: message.requestId,
          payload: { message: `Preview: "${message.type}" opens an editor tab, so it only works inside VS Code.` },
        });
        return;
      default:
        return done();
    }
  };
}
