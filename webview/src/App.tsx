import { useEffect, useMemo, useState } from "react";
import type { ActivityEvent } from "../../src/shared/messages";
import type { ApplicationState, Phase } from "../../src/shared/schema";
import { ArchitectureGraph } from "./components/ArchitectureGraph";
import { StepPanel } from "./components/StepPanel";
import type { Bridge, UiActionInput } from "./vscode";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready",
  inspecting: "Reading the repository",
  planReady: "Plan ready",
  proposing: "Proposing a step",
  previewReady: "Review the proposed step",
  applying: "Applying",
  checking: "Running checks",
  stepReady: "Step applied",
  needsAttention: "Needs attention",
  revising: "Revising the plan",
  complete: "Feature complete",
};

const DEFAULT_INTENT = "Add caching so repeated weather requests do not hit the upstream forecast provider";

export function App({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<ApplicationState | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState(DEFAULT_INTENT);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = bridge.subscribe((message) => {
      switch (message.type) {
        case "stateSnapshot":
          setState(message.payload);
          if (message.payload.phase === "inspecting") setError(null);
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

  const appliedStepIds = useMemo(() => new Set(state?.history.map((h) => h.stepId) ?? []), [state]);
  const selectedConcept = state?.plan?.concepts.find((c) => c.id === selectedConceptId) ?? null;

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
  const send = (action: UiActionInput) => {
    setError(null);
    bridge.send(action);
  };
  const guard = { sessionId: state.sessionId, expectedRevision: state.stateRevision };
  const latest = activity.filter((a) => a.operationId === state.operationId).at(-1);

  return (
    <div className="app">
      <header className="header">
        <form
          className="intent"
          onSubmit={(event) => {
            event.preventDefault();
            setSelectedConceptId(null);
            setActivity([]);
            send({ type: "startFeature", payload: { ...guard, intent, useSelection: false } });
          }}
        >
          <label htmlFor="intent">Feature request</label>
          <textarea
            id="intent"
            rows={2}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            disabled={busy || state.history.length > 0}
          />
          <div className="intent__actions">
            {state.history.length === 0 && (
              <button type="submit" className="primary" disabled={busy || !intent.trim()}>
                {state.plan ? "Plan again" : "Show the plan"}
              </button>
            )}
            {busy && (
              <button type="button" onClick={() => send({ type: "cancel", payload: { sessionId: state.sessionId } })}>
                Cancel
              </button>
            )}
            {state.plan && !busy && (
              <button type="button" onClick={() => send({ type: "resetSession", payload: { sessionId: state.sessionId } })}>
                Reset session
              </button>
            )}
          </div>
        </form>
        <div className="status" role="status" aria-live="polite">
          <strong>{PHASE_LABEL[state.phase]}</strong>
          {busy && latest && <span className="status__activity"> {"·"} {latest.message}</span>}
          {bridge.isPreview && <span className="status__preview">Browser preview with fixture data</span>}
        </div>
        {(error || (state.error && state.phase !== "needsAttention")) && (
          <div className="error" role="alert">
            {error ?? state.error?.message}
            {state.error?.nextAction && <span> {state.error.nextAction}</span>}
          </div>
        )}
      </header>

      {state.plan ? (
        <main className="workspace">
          <ArchitectureGraph
            plan={state.plan}
            appliedStepIds={appliedStepIds}
            currentStepId={state.currentStepId}
            selectedConceptId={selectedConceptId}
            onSelect={(id) => {
              setSelectedConceptId(id);
              bridge.send({ type: "selectConcept", payload: { conceptId: id } });
            }}
          />
          <StepPanel
            state={state}
            plan={state.plan}
            selectedConcept={selectedConcept}
            send={send}
            onBack={() => setSelectedConceptId(null)}
          />
        </main>
      ) : (
        <div className="empty">
          {busy ? (
            <p>Building the map before any code is written{"…"}</p>
          ) : (
            <p>Describe a feature. You will see its architecture map before any code changes.</p>
          )}
        </div>
      )}
    </div>
  );
}
