import { useEffect, useState } from "react";
import type { ApplicationState, FeaturePlan, PlannedFunction } from "../../../src/shared/schema";
import { currentProposal } from "../../../src/shared/schema";
import type { UiActionInput } from "../vscode";

type Send = (action: UiActionInput) => void;

const KIND_LABEL: Record<PlannedFunction["kind"], string> = { function: "function", module: "module", route: "route", test: "tests" };

const BUSY_TEXT: Partial<Record<ApplicationState["phase"], string>> = {
  planning: "Planning the next function…",
  reworking: "Reworking the plan around your rejection",
  implementing: "Everything is planned. Writing the code…",
  checking: "Code written. Running the checks…",
};

export function PlanningView(props: { state: ApplicationState; plan: FeaturePlan | null; activity: string | null; send: Send }) {
  const { state, plan, activity, send } = props;
  const guard = { sessionId: state.sessionId, expectedRevision: state.stateRevision };
  const proposal = currentProposal(plan);
  const decided = plan?.functions.filter((f) => f.status !== "proposed") ?? [];
  const acceptedCount = decided.filter((f) => f.status === "accepted").length;
  const total = acceptedCount + (proposal ? 1 : 0) + (plan?.upcoming.length ?? 0);
  const busyText = BUSY_TEXT[state.phase];

  return (
    <div className="planning">
      {plan && (
        <div className="planning__summary">
          <p>{plan.summary}</p>
          {total > 0 && (
            <div className="progress" aria-label={`${acceptedCount} / ${total}`}>
              <div className="progress__bar" style={{ width: `${(acceptedCount / total) * 100}%` }} />
              <span>{acceptedCount} / {total}</span>
            </div>
          )}
        </div>
      )}

      {decided.length > 0 && (
        <ol className="decided">
          {decided.map((f) => (
            <li key={f.id} className={`decided__item decided__item--${f.status}`}>
              <span className="decided__mark" aria-hidden="true">
                {f.status === "accepted" ? "✓" : "✕"}
              </span>
              <button type="button" className="link decided__name" onClick={() => send({ type: "openNode", payload: { nodeId: f.id } })}>
                {f.name}
              </button>
              <span className="decided__what">
                {f.status === "accepted" ? f.purpose : `Reworked${f.rejectionReason ? `: “${f.rejectionReason}”` : ""}`}
              </span>
            </li>
          ))}
        </ol>
      )}

      {busyText && state.operationId ? (
        <div className="card card--busy" role="status">
          <div className="spinner" aria-hidden="true" />
          <div>
            <strong>{busyText}</strong>
            {activity && <div className="hint">{activity}</div>}
          </div>
        </div>
      ) : (
        proposal &&
        state.phase === "reviewing" && <ProposalCard key={proposal.id} proposal={proposal} plan={plan!} guard={guard} send={send} />
      )}

      {plan && plan.upcoming.length > 0 && (
        <div className="upcoming">
          <h3>Coming up</h3>
          <ol start={acceptedCount + 2}>
            {plan.upcoming.map((u) => (
              <li key={u.name}>
                <code>{u.name}</code> <span className="hint">{u.summary}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ProposalCard(props: { proposal: PlannedFunction; plan: FeaturePlan; guard: { sessionId: string; expectedRevision: number }; send: Send }) {
  const { proposal, plan, guard, send } = props;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const replaced = proposal.replacesId ? plan.functions.find((f) => f.id === proposal.replacesId) : undefined;
  useEffect(() => setRejecting(false), [proposal.id]);

  return (
    <article className="card card--proposal" aria-label={`Proposed ${KIND_LABEL[proposal.kind]} ${proposal.name}`}>
      {replaced && plan.reworkNote && (
        <div className="rework">
          <strong>Reworked after you rejected {replaced.name}.</strong> {plan.reworkNote}
        </div>
      )}
      <div className="card__eyebrow">
        <span className="chip">{KIND_LABEL[proposal.kind]}</span>
        {proposal.change === "change" && <span className="chip chip--changed">changes existing code</span>}
        <code className="card__path">{proposal.path}</code>
      </div>
      <button type="button" className="link card__name" onClick={() => send({ type: "openNode", payload: { nodeId: proposal.id } })}>
        {proposal.name}
      </button>
      <pre className={`signature signature--${proposal.change}`}><SignatureCode signature={proposal.signature} /></pre>

      {proposal.details.length > 0 && (
        <>
          <h3>How it works</h3>
          <ul className="details">
            {proposal.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </>
      )}

      {(proposal.calls.length > 0 || proposal.calledBy.length > 0) && (
        <dl className="relations">
          {proposal.calledBy.length > 0 && (
            <>
              <dt>Called by</dt>
              <dd>
                {proposal.calledBy.map((n) => (
                  <code key={n}>{n}</code>
                ))}
              </dd>
            </>
          )}
          {proposal.calls.length > 0 && (
            <>
              <dt>Calls</dt>
              <dd>
                {proposal.calls.map((n) => (
                  <code key={n}>{n}</code>
                ))}
              </dd>
            </>
          )}
        </dl>
      )}

      {rejecting ? (
        <form
          className="reject"
          onSubmit={(e) => {
            e.preventDefault();
            send({ type: "rejectFunction", payload: { ...guard, functionId: proposal.id, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
          }}
        >
          <label htmlFor="reason">What should change? (optional, it helps the agent rework the plan)</label>
          <textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Memory has to stay bounded" />
          <div className="actions">
            <button type="submit" className="danger">
              Rework
            </button>
            <button type="button" onClick={() => setRejecting(false)}>
              Back
            </button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <button type="button" className="primary" onClick={() => send({ type: "acceptFunction", payload: { ...guard, functionId: proposal.id } })}>
            ✓ Accept
          </button>
          <button type="button" className="danger" onClick={() => setRejecting(true)}>
            ✕ Rework
          </button>
        </div>
      )}
      <p className="hint">Generated code and tests are shown in the editor before you approve this function.</p>
    </article>
  );
}

function SignatureCode({ signature }: { signature: string }) {
  const tokens: string[] = signature.match(/"[^"]*"|'[^']*'|`[^`]*`|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|=>|[{}()[\].,;:?<>:=/]|\s+|./g) ?? [];
  const firstParen = tokens.findIndex((token) => token === "(");
  const closeParen = firstParen < 0 ? -1 : tokens.lastIndexOf(")");
  let parameterDepth = 0;
  let seenReturnType = false;

  return (
    <>
      {tokens.map((token, index) => {
        if (token === "(" && firstParen === index) parameterDepth = 1;
        else if (parameterDepth && token === "(") parameterDepth++;
        else if (parameterDepth && token === ")") parameterDepth--;
        if (token === ":" && closeParen >= 0 && index > closeParen) seenReturnType = true;

        const previous = previousSignificant(tokens, index);
        const next = nextSignificant(tokens, index);
        const isIdentifier = /^[A-Za-z_$][\w$]*$/.test(token);
        let className = "signature__text";

        if (/^["'`]/.test(token)) className = "signature__string";
        else if (["export", "function", "async", "const", "let", "class", "return"].includes(token)) className = "signature__keyword";
        else if (index === firstParen - 1) className = "signature__function";
        else if (isIdentifier && parameterDepth > 0 && (next === ":" || next === "?" || previous === "?")) className = "signature__parameter";
        else if (isIdentifier && (seenReturnType || previous === ":" || previous === "<" || next === ">")) className = "signature__type";

        return <span key={`${index}-${token}`} className={className}>{token}</span>;
      })}
    </>
  );
}

function previousSignificant(tokens: string[], index: number): string | undefined {
  for (let i = index - 1; i >= 0; i -= 1) if (!/^\s+$/.test(tokens[i] ?? "")) return tokens[i];
  return undefined;
}

function nextSignificant(tokens: string[], index: number): string | undefined {
  for (let i = index + 1; i < tokens.length; i += 1) if (!/^\s+$/.test(tokens[i] ?? "")) return tokens[i];
  return undefined;
}
