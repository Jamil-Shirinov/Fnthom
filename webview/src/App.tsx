import { useCallback, useEffect, useState } from "react";
import type { ActivityEvent } from "../../src/shared/messages";
import type { ApplicationState, Phase } from "../../src/shared/schema";
import { FunctionGraph } from "./components/FunctionGraph";
import { PlanningView } from "./components/PlanningView";
import { ResultPanel } from "./components/ResultPanel";
import type { Bridge, UiActionInput } from "./vscode";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready",
  planning: "Planning",
  reviewing: "Reviewing",
  reworking: "Reworking the plan",
  implementing: "Writing the code",
  checking: "Running checks",
  done: "Done",
  needsAttention: "Needs attention",
};

const PLANNING_PHASES: ReadonlySet<Phase> = new Set(["planning", "reviewing", "reworking", "implementing", "checking"]);

const DEFAULT_INTENT = "Add caching so repeated weather requests do not hit the upstream forecast provider";

export function App({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<ApplicationState | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState(DEFAULT_INTENT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTests, setShowTests] = useState(false);
  const [showPlan, setShowPlan] = useState(false);

  useEffect(() => {
    const unsubscribe = bridge.subscribe((message) => {
      switch (message.type) {
        case "stateSnapshot":
          setState(message.payload);
          break;
        case "activity":
          setActivity((events) => [...events.slice(-49), message.payload]);
          break;
        case "requestError":
          setError(message.payload.message);
          break;
      }
    });
    bridge.send({ type: "ready", payload: {} });
    return unsubscribe;
  }, [bridge]);

  const send = useCallback(
    (action: UiActionInput) => {
      setError(null);
      bridge.send(action);
    },
    [bridge],
  );
  const openNode = useCallback((nodeId: string) => send({ type: "openNode", payload: { nodeId } }), [send]);

  if (!state) return <div className="empty">Connecting to the extension{"…"}</div>;
  if (!state.workspaceId) {
    return (
      <div className="empty">
        <h2>Open a folder to begin</h2>
        <p>The agent works inside one workspace folder. Use File {"›"} Open Folder, then reopen this panel.</p>
      </div>
    );
  }

  const busy = state.operationId !== null;
  const guard = { sessionId: state.sessionId, expectedRevision: state.stateRevision };
  const latest = activity.filter((a) => a.operationId === state.operationId).at(-1)?.message ?? null;
  const planning = PLANNING_PHASES.has(state.phase) || (state.phase === "needsAttention" && !!state.plan && !state.graph);
  const graphView = !!state.graph && !planning && !showPlan;

  return (
    <div className="app">
      <header className="header">
        <form
          className="intent"
          onSubmit={(event) => {
            event.preventDefault();
            setSelectedId(null);
            setShowPlan(false);
            setActivity([]);
            send({ type: "startFeature", payload: { ...guard, intent } });
          }}
        >
          <label htmlFor="intent">What should the agent build?</label>
          <textarea id="intent" rows={2} value={intent} onChange={(e) => setIntent(e.target.value)} disabled={busy} />
          <div className="intent__actions">
            <button type="submit" className="primary" disabled={busy || !intent.trim()}>
              {state.plan ? "Start over" : "Plan it"}
            </button>
            {!state.graph && !state.plan && (
              <button type="button" disabled={busy} onClick={() => send({ type: "showGraph", payload: guard })}>
                Show the current function graph
              </button>
            )}
            {busy && (
              <button type="button" onClick={() => send({ type: "cancel", payload: { sessionId: state.sessionId } })}>
                Cancel
              </button>
            )}
            {(state.plan || state.graph) && !busy && (
              <button type="button" onClick={() => send({ type: "resetSession", payload: { sessionId: state.sessionId } })}>
                Cancel
              </button>
            )}
          </div>
        </form>
        <div className="status" role="status" aria-live="polite">
          <strong>{PHASE_LABEL[state.phase]}</strong>
          {busy && latest && <span className="status__activity"> {"·"} {latest}</span>}
          {bridge.isPreview && <span className="status__preview">Browser preview with the scripted demo agent</span>}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {state.phase === "needsAttention" && state.error && (
          <div className="attention" role="alert">
            <div>
              <strong>{state.error.message}</strong> <span>{state.error.nextAction}</span>
            </div>
            {state.error.stage !== "apply" && (
              <button type="button" className="primary" onClick={() => send({ type: "retry", payload: guard })}>
                Try again
              </button>
            )}
          </div>
        )}
      </header>

      {graphView ? (
        <main className="workspace">
          <FunctionGraph graph={state.graph!} showTests={showTests} selectedId={selectedId} onSelect={setSelectedId} onOpen={openNode} />
          <ResultPanel
            state={state}
            graph={state.graph!}
            showTests={showTests}
            onShowTests={setShowTests}
            onShowPlan={() => setShowPlan(true)}
            send={send}
          />
        </main>
      ) : state.plan || planning ? (
        <main className="scroll">
          {showPlan && state.graph && (
            <button type="button" className="link back" onClick={() => setShowPlan(false)}>
              ← Back to the graph
            </button>
          )}
          <PlanningView state={state} plan={state.plan} activity={latest} send={send} />
        </main>
      ) : (
        <div className="empty">
          {busy ? (
            <p>Reading the code{"…"}</p>
          ) : (
            <>
              <p>Describe a feature. The agent proposes it one function at a time; you accept or reject each one before any code is written.</p>
              <p>When every function is planned, it writes the code and shows how your functions connect.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
