import { useCallback, useEffect, useRef, useState } from "react";
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

/** Phases where switching to the Graph tab rebuilds the graph first, so it reflects the latest code and plan. */
const REFRESH_PHASES: ReadonlySet<Phase> = new Set(["idle", "reviewing", "done"]);

type Tab = "decisions" | "graph";

const DEFAULT_INTENT = "Add caching so repeated weather requests do not hit the upstream forecast provider";

export function App({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<ApplicationState | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState(DEFAULT_INTENT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTests, setShowTests] = useState(false);
  const [tab, setTab] = useState<Tab>("decisions");
  const previousPhase = useRef<Phase | null>(null);

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

  // Show the result once the feature is written; after that the user switches tabs freely.
  const phase = state?.phase ?? null;
  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = phase;
    if (phase === "done" && (previous === "implementing" || previous === "checking")) {
      setSelectedId(null);
      setTab("graph");
    }
  }, [phase]);

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
  const openTab = (next: Tab) => {
    setTab(next);
    if (next === "graph" && !busy && REFRESH_PHASES.has(state.phase)) send({ type: "showGraph", payload: guard });
  };

  return (
    <div className="app">
      <header className="header">
        <form
          className="intent"
          onSubmit={(event) => {
            event.preventDefault();
            setSelectedId(null);
            setTab("decisions");
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

      <nav className="tabs" role="tablist" aria-label="View">
        <button type="button" role="tab" aria-selected={tab === "decisions"} className={tab === "decisions" ? "tab tab--active" : "tab"} onClick={() => openTab("decisions")}>
          Decisions
        </button>
        <button type="button" role="tab" aria-selected={tab === "graph"} className={tab === "graph" ? "tab tab--active" : "tab"} onClick={() => openTab("graph")}>
          Graph
        </button>
      </nav>

      {tab === "graph" ? (
        state.graph ? (
          <main className="workspace" role="tabpanel">
            <FunctionGraph graph={state.graph} showTests={showTests} selectedId={selectedId} onSelect={setSelectedId} onOpen={openNode} />
            <ResultPanel
              state={state}
              graph={state.graph}
              showTests={showTests}
              onShowTests={setShowTests}
              onShowDecisions={() => setTab("decisions")}
              send={send}
            />
          </main>
        ) : (
          <div className="empty" role="tabpanel">
            {busy ? <p>Reading the code and tracing calls{"…"}</p> : <p>The graph appears here once the agent has read the code.</p>}
          </div>
        )
      ) : state.plan || busy ? (
        <main className="scroll" role="tabpanel">
          {state.plan || state.phase === "planning" ? (
            <PlanningView state={state} plan={state.plan} activity={latest} send={send} />
          ) : (
            <div className="empty">
              <p>Reading the code{"…"}</p>
            </div>
          )}
        </main>
      ) : (
        <div className="empty" role="tabpanel">
          <p>Describe a feature. The agent proposes it one function at a time; you accept or reject each one before any code is written.</p>
          <p>Each function you accept appears in the Graph tab right away. When every function is planned, the agent writes the code.</p>
        </div>
      )}
    </div>
  );
}
