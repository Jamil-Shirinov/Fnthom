import type { ApplicationState, Concept, FeaturePlan } from "../../../src/shared/schema";
import { readySteps } from "../../../src/shared/schema";
import { VERIFICATION_LABEL } from "./ConceptNode";

export function StepPanel(props: {
  state: ApplicationState;
  plan: FeaturePlan;
  selectedConcept: Concept | null;
  onOpenSource: (conceptId: string, refIndex: number) => void;
  onBack: () => void;
}) {
  const { state, plan, selectedConcept, onOpenSource, onBack } = props;
  if (selectedConcept) return <ConceptDetails concept={selectedConcept} onOpenSource={onOpenSource} onBack={onBack} />;

  const applied = new Set(state.history.map((h) => h.stepId));
  const ready = new Set(readySteps(plan, applied).map((s) => s.id));

  return (
    <section className="panel" aria-label="Plan">
      <h2>Plan</h2>
      <p>{plan.summary}</p>

      <h3>Steps</h3>
      <ol className="steps">
        {plan.steps.map((step) => {
          const status = applied.has(step.id)
            ? "Applied"
            : step.id === state.currentStepId
              ? "Active"
              : ready.has(step.id)
                ? "Ready"
                : "Waiting on earlier steps";
          return (
            <li key={step.id} className={`step step--${status.split(" ")[0]!.toLowerCase()}`}>
              <div className="step__title">{step.title}</div>
              <div className="step__status">{status}</div>
              <div className="step__expect">{step.expectedBehavior}</div>
            </li>
          );
        })}
      </ol>

      {plan.assumptions.length > 0 && (
        <>
          <h3>Assumptions</h3>
          <ul>
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}

      <button type="button" className="primary" disabled title="Step proposals arrive in MVP step 2">
        Start first step
      </button>
      <p className="hint">Select a component in the map to see its role, claims, and source.</p>
    </section>
  );
}

function ConceptDetails(props: { concept: Concept; onOpenSource: (conceptId: string, refIndex: number) => void; onBack: () => void }) {
  const { concept, onOpenSource, onBack } = props;
  return (
    <section className="panel" aria-label={`Component: ${concept.title}`}>
      <button type="button" className="link" onClick={onBack}>
        ← Plan
      </button>
      <h2>{concept.title}</h2>
      <p>{concept.purpose}</p>

      <dl className="io">
        <dt>Inputs</dt>
        <dd>{concept.inputs.join(", ") || "None"}</dd>
        <dt>Outputs</dt>
        <dd>{concept.outputs.join(", ") || "None"}</dd>
      </dl>

      <h3>Claims</h3>
      {concept.invariants.length === 0 ? (
        <p className="hint">No claims recorded for this component.</p>
      ) : (
        <ul className="claims">
          {concept.invariants.map((inv) => (
            <li key={inv.id}>
              <span className={`badge badge--${inv.status}`}>{VERIFICATION_LABEL[inv.status]}</span> {inv.claim}
            </li>
          ))}
        </ul>
      )}

      <h3>Source</h3>
      {concept.sourceRefs.length === 0 ? (
        <p className="hint">
          Not implemented yet. Intended files: {concept.intendedPaths.map((p) => <code key={p}>{p} </code>)}
        </p>
      ) : (
        <ul className="sources">
          {concept.sourceRefs.map((ref, i) => (
            <li key={`${ref.path}:${ref.startLine}`}>
              {ref.status === "resolved" ? (
                <button type="button" className="link" onClick={() => onOpenSource(concept.id, i)}>
                  {ref.symbol ? `${ref.symbol} · ` : ""}
                  {ref.path}:{ref.startLine}-{ref.endLine}
                </button>
              ) : (
                <span>
                  {ref.path} <span className={`badge badge--stale`}>{"⚠"} {ref.status}: code changed since this was linked</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
