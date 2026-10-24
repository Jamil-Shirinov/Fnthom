import { useState } from "react";
import type { ApplicationState, CheckResult, Concept, FeaturePlan, StepProposal } from "../../../src/shared/schema";
import { readySteps } from "../../../src/shared/schema";
import type { UiActionInput } from "../vscode";
import { VERIFICATION_LABEL } from "./ConceptNode";

type Send = (action: UiActionInput) => void;
type Guard = { sessionId: string; expectedRevision: number };

const BUSY_LABEL: Partial<Record<ApplicationState["phase"], string>> = {
  proposing: "Writing the proposal for this step…",
  applying: "Applying the files and saving them…",
  checking: "Running the configured checks…",
  revising: "Revising the remaining steps…",
};

export function StepPanel(props: {
  state: ApplicationState;
  plan: FeaturePlan;
  selectedConcept: Concept | null;
  send: Send;
  onBack: () => void;
}) {
  const { state, plan, selectedConcept, send, onBack } = props;
  if (selectedConcept) {
    return (
      <ConceptDetails
        concept={selectedConcept}
        onOpenSource={(conceptId, refIndex) => send({ type: "openSource", payload: { conceptId, refIndex } })}
        onBack={onBack}
      />
    );
  }

  const guard: Guard = { sessionId: state.sessionId, expectedRevision: state.stateRevision };
  const busy = state.operationId !== null;
  const applied = new Set(state.history.map((h) => h.stepId));
  const ready = readySteps(plan, applied);
  const nextStep = ready[0];
  const currentStep = plan.steps.find((s) => s.id === state.currentStepId) ?? null;

  return (
    <section className="panel" aria-label="Plan">
      {state.phase === "needsAttention" && state.error && (
        <Attention state={state} guard={guard} send={send} stepId={state.currentStepId ?? nextStep?.id ?? null} />
      )}

      {state.phase === "previewReady" && state.proposal ? (
        <ProposalView proposal={state.proposal} plan={plan} guard={guard} send={send} />
      ) : busy && BUSY_LABEL[state.phase] ? (
        <div className="callout">
          <h2>{currentStep?.title ?? "Working"}</h2>
          <p className="hint">{BUSY_LABEL[state.phase]}</p>
        </div>
      ) : state.phase === "complete" ? (
        <div className="callout callout--ok">
          <h2>Feature complete</h2>
          <p>All {plan.steps.length} steps are applied. Export a Markdown reference with the map, steps, and check results.</p>
          <button type="button" className="primary" onClick={() => send({ type: "export", payload: {} })}>
            Export feature reference
          </button>
        </div>
      ) : (
        state.phase !== "needsAttention" && (
          <div className="callout">
            <h2>Plan</h2>
            <p>{plan.summary}</p>
            {nextStep && (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => send({ type: "startStep", payload: { ...guard, stepId: nextStep.id } })}
              >
                {applied.size === 0 ? "Start first step" : "Start next step"}: {nextStep.title}
              </button>
            )}
          </div>
        )
      )}

      <h3>Steps</h3>
      <ol className="steps">
        {plan.steps.map((step) => {
          const status = applied.has(step.id)
            ? "Applied"
            : step.id === state.currentStepId
              ? "Active"
              : ready.some((s) => s.id === step.id)
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

      <Checks evidence={state.evidence} />
      <Questions state={state} guard={guard} send={send} busy={busy} />
      <Revise guard={guard} send={send} disabled={busy || state.phase === "complete"} />

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
      <p className="hint">Select a component in the map to see its role, claims, and source.</p>
    </section>
  );
}

function ProposalView(props: { proposal: StepProposal; plan: FeaturePlan; guard: Guard; send: Send }) {
  const { proposal, plan, guard, send } = props;
  const step = plan.steps.find((s) => s.id === proposal.stepId);
  const claims = plan.concepts.flatMap((c) => c.invariants).filter((inv) => proposal.invariantIds.includes(inv.id));
  const { explanation } = proposal;

  return (
    <div className="callout callout--active" aria-label="Proposed step">
      <div className="eyebrow">Proposed step</div>
      <h2>{step?.title ?? proposal.stepId}</h2>
      <p>{explanation.purpose}</p>
      <dl className="io">
        <dt>Inputs</dt>
        <dd>{explanation.inputs.join(", ") || "None"}</dd>
        <dt>Outputs</dt>
        <dd>{explanation.outputs.join(", ") || "None"}</dd>
      </dl>
      {explanation.assumptions.length > 0 && (
        <ul className="assumptions">
          {explanation.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      <h3>Files</h3>
      <ul className="files">
        {proposal.files.map((file) => (
          <li key={file.path}>
            <span className={`chip ${file.kind === "create" ? "chip--active" : ""}`}>{file.kind === "create" ? "new" : "changed"}</span>
            <code>{file.path}</code>
            <button
              type="button"
              className="link"
              onClick={() => send({ type: "previewFile", payload: { ...guard, proposalId: proposal.id, path: file.path } })}
            >
              Preview diff
            </button>
          </li>
        ))}
      </ul>

      {claims.length > 0 && (
        <>
          <h3>Claims this step should keep true</h3>
          <ul className="claims">
            {claims.map((inv) => (
              <li key={inv.id}>
                <span className={`badge badge--${inv.status}`}>{VERIFICATION_LABEL[inv.status]}</span> {inv.claim}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="actions">
        <button type="button" className="primary" onClick={() => send({ type: "applyAndContinue", payload: { ...guard, proposalId: proposal.id } })}>
          Apply & Continue
        </button>
        <button type="button" onClick={() => send({ type: "regenerateProposal", payload: { ...guard, stepId: proposal.stepId } })}>
          Regenerate
        </button>
      </div>
      <p className="hint">Nothing is written until you apply. Applying saves these files and runs the checks.</p>
    </div>
  );
}

function Attention(props: { state: ApplicationState; guard: Guard; send: Send; stepId: string | null }) {
  const { state, guard, send, stepId } = props;
  const error = state.error!;
  return (
    <div className="callout callout--bad" role="alert">
      <div className="eyebrow">Needs attention</div>
      <p>{error.message}</p>
      <p className="hint">{error.nextAction}</p>
      <div className="actions">
        {error.stage === "checks" ? (
          <>
            <button type="button" className="primary" onClick={() => send({ type: "rerunChecks", payload: guard })}>
              Rerun checks
            </button>
            <button type="button" onClick={() => send({ type: "continueAfterFailure", payload: guard })}>
              Continue anyway
            </button>
          </>
        ) : (
          stepId && (
            <button type="button" className="primary" onClick={() => send({ type: "regenerateProposal", payload: { ...guard, stepId } })}>
              Regenerate proposal
            </button>
          )
        )}
      </div>
    </div>
  );
}

function Checks({ evidence }: { evidence: CheckResult[] }) {
  if (evidence.length === 0) return null;
  // Newest first, one row per run.
  const runs = [...evidence].reverse().slice(0, 6);
  return (
    <>
      <h3>Checks</h3>
      <ul className="checks">
        {runs.map((r) => (
          <li key={r.id}>
            <details>
              <summary>
                <span className={`badge badge--${r.status === "passed" ? "supported" : "failed"}`}>{r.status}</span> {r.checkId}{" "}
                <span className="hint">after {r.stepId}</span>
              </summary>
              <pre className="output">{r.output.trim() || "(no output)"}</pre>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}

function Questions(props: { state: ApplicationState; guard: Guard; send: Send; busy: boolean }) {
  const { state, guard, send, busy } = props;
  const [question, setQuestion] = useState("");
  return (
    <>
      <h3>Ask about this step</h3>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!question.trim()) return;
          send({ type: "askQuestion", payload: { ...guard, question } });
          setQuestion("");
        }}
      >
        <input
          aria-label="Question"
          placeholder="Why a TTL instead of an LRU?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
      {state.questions.length > 0 && (
        <ul className="qa">
          {[...state.questions].reverse().map((q) => (
            <li key={q.id}>
              <div className="qa__q">{q.question}</div>
              <div className="qa__a">{q.answer ?? "Thinking…"}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Revise(props: { guard: Guard; send: Send; disabled: boolean }) {
  const { guard, send, disabled } = props;
  const [instruction, setInstruction] = useState("");
  return (
    <details className="revise">
      <summary>Revise the approach</summary>
      <p className="hint">Applied steps stay as they are. The remaining steps are planned again.</p>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!instruction.trim()) return;
          send({ type: "reviseApproach", payload: { ...guard, instruction } });
          setInstruction("");
        }}
      >
        <input
          aria-label="Revision"
          placeholder="Keep the cache per process, no Redis"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || !instruction.trim()}>
          Revise
        </button>
      </form>
    </details>
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
            <li key={`${ref.path}:${ref.startLine}:${i}`}>
              {ref.status === "resolved" ? (
                <button type="button" className="link" onClick={() => onOpenSource(concept.id, i)}>
                  {ref.symbol ? `${ref.symbol} · ` : ""}
                  {ref.path}:{ref.startLine}-{ref.endLine}
                </button>
              ) : (
                <span>
                  <button type="button" className="link" onClick={() => onOpenSource(concept.id, i)}>
                    {ref.path}
                  </button>{" "}
                  <span className={`badge badge--stale`}>{"⚠"} {ref.status}: code changed since this was linked</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
