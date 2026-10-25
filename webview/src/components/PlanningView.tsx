import { useEffect, useState } from "react";
import type { ApplicationState, FeaturePlan, GraphNode, PlannedFunction } from "../../../src/shared/schema";
import { currentProposal } from "../../../src/shared/schema";
import { findNode } from "../../../src/workspace/plannedGraph";
import { tokenize } from "../highlight";
import type { UiActionInput } from "../vscode";

type Send = (action: UiActionInput) => void;

const KIND_LABEL: Record<PlannedFunction["kind"], string> = { function: "function", module: "module", route: "route", test: "tests" };

const BUSY_TEXT: Partial<Record<ApplicationState["phase"], string>> = {
  planning: "Planning the next function…",
  reworking: "Reworking the plan around your rejection",
  implementing: "Everything is planned. Writing the code…",
  checking: "Code written. Running the checks…",
};

export function PlanningView(props: {
  state: ApplicationState;
  plan: FeaturePlan | null;
  activity: string | null;
  send: Send;
  onShowInGraph: (nodeId: string) => void;
}) {
  const { state, plan, activity, send, onShowInGraph } = props;
  const [flashed, setFlashed] = useState<string | null>(null);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const showUpcoming = (name: string) => {
    setUpcomingOpen(true);
    setFlashed(name);
    // Wait for the list to render if it was collapsed.
    requestAnimationFrame(() => document.getElementById(upcomingId(name))?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  useEffect(() => {
    if (!flashed) return;
    const timer = setTimeout(() => setFlashed(null), 1600);
    return () => clearTimeout(timer);
  }, [flashed]);
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
        state.phase === "reviewing" && (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            plan={plan!}
            state={state}
            nodes={state.graph?.nodes ?? []}
            guard={guard}
            send={send}
            onShowInGraph={onShowInGraph}
            onShowUpcoming={showUpcoming}
          />
        )
      )}

      {plan && plan.upcoming.length > 0 && (
        <div className="upcoming">
          <h3 className="upcoming__head">
            Coming up
            <button
              type="button"
              className={`upcoming__toggle${upcomingOpen ? " upcoming__toggle--open" : ""}`}
              aria-expanded={upcomingOpen}
              aria-controls="upcoming-list"
              aria-label={upcomingOpen ? "Hide the functions coming up" : "Show the functions coming up"}
              onClick={() => setUpcomingOpen((open) => !open)}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </h3>
          <ol id="upcoming-list" start={acceptedCount + 2} hidden={!upcomingOpen}>
            {plan.upcoming.map((u) => (
              <li key={u.name} id={upcomingId(u.name)} className={flashed === u.name ? "flash" : undefined}>
                <code>{u.name}</code> <span className="hint">{u.summary}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ProposalCard(props: {
  proposal: PlannedFunction;
  plan: FeaturePlan;
  state: ApplicationState;
  nodes: GraphNode[];
  guard: { sessionId: string; expectedRevision: number };
  send: Send;
  onShowInGraph: (nodeId: string) => void;
  onShowUpcoming: (name: string) => void;
}) {
  const { proposal, plan, state, nodes, guard, send, onShowInGraph, onShowUpcoming } = props;
  const related = (name: string) => {
    const node = findNode(nodes, name, `${proposal.path}#${proposal.name}`)?.node;
    const upcoming = !node && plan.upcoming.some((u) => u.name === name);
    if (node && !(node.planned && node.status === "new")) {
      return (
        <button key={name} type="button" className="code-link" title={`Open ${node.path}:${node.startLine}`} onClick={() => send({ type: "openNode", payload: { nodeId: node.id } })}>
          {name}
        </button>
      );
    }
    if (node) {
      return (
        <button key={name} type="button" className="code-link" title="Accepted, not written yet. Show it in the graph." onClick={() => onShowInGraph(node.id)}>
          {name}
        </button>
      );
    }
    if (upcoming) {
      return (
        <button key={name} type="button" className="code-link" title="Not proposed yet. Show it in Coming up." onClick={() => onShowUpcoming(name)}>
          {name}
        </button>
      );
    }
    return <code key={name}>{name}</code>;
  };
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const followUps = state.followUps.filter((exchange) => exchange.proposalId === proposal.id);
  const questionPending = state.pendingQuestionId === proposal.id;
  const busy = state.operationId !== null;
  const replaced = proposal.replacesId ? plan.functions.find((f) => f.id === proposal.replacesId) : undefined;
  useEffect(() => setRejecting(false), [proposal.id]);
  useEffect(() => setQuestion(""), [followUps.length]);

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
      <pre className={`signature signature--${proposal.change}`}>
        <CodeLine code={proposal.signature} />
      </pre>

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
                {proposal.calledBy.map(related)}
              </dd>
            </>
          )}
          {proposal.calls.length > 0 && (
            <>
              <dt>Calls</dt>
              <dd>
                {proposal.calls.map(related)}
              </dd>
            </>
          )}
        </dl>
      )}

      {followUps.length > 0 && (
        <div className="follow-ups" aria-label="Follow-up answers">
          {followUps.map((exchange, index) => (
            <article className="follow-up" key={`${exchange.proposalId}-${index}`}>
              <p className="follow-up__question"><strong>You asked</strong>{exchange.question}</p>
              <p className="follow-up__answer"><strong>Agent</strong>{exchange.answer}</p>
            </article>
          ))}
        </div>
      )}

      {asking && !rejecting && (
        <form
          className="follow-up__form"
          onSubmit={(e) => {
            e.preventDefault();
            send({ type: "askQuestion", payload: { ...guard, proposalId: proposal.id, question } });
          }}
        >
          <textarea
            id={`question-${proposal.id}`}
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={2000}
            autoFocus
            placeholder="What happens if the cache entry expires?"
            disabled={busy}
          />
          <div className="actions">
            <button type="submit" className="primary" disabled={busy || !question.trim()}>
              {questionPending ? "Asking…" : "Ask"}
            </button>
            <button type="button" onClick={() => setAsking(false)} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}

      {questionPending && (
        <div className="follow-up__pending" role="status">
          <span className="spinner" aria-hidden="true" />
          The agent is answering your question…
        </div>
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
            <button type="submit" className="danger" disabled={busy}>
              Rework
            </button>
            <button type="button" onClick={() => setRejecting(false)} disabled={busy}>
              Back
            </button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => send({ type: "acceptFunction", payload: { ...guard, functionId: proposal.id } })}>
            ✓ Accept
          </button>
          <button type="button" className="danger" disabled={busy} onClick={() => setRejecting(true)}>
            ✕ Rework…
          </button>
          {!asking && (
            <button type="button" disabled={busy} onClick={() => setAsking(true)}>
              Ask a question…
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function upcomingId(name: string): string {
  return `upcoming-${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** Code colored like the editor; brackets cycle through three colors by nesting depth. */
function CodeLine({ code }: { code: string }) {
  return (
    <>
      {tokenize(code).map((t, i) =>
        t.kind === "space" || t.kind === "punctuation" ? (
          t.text
        ) : (
          <span key={i} className={t.kind === "bracket" ? `tok-bracket${(t.depth ?? 0) % 3}` : `tok-${t.kind}`}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
}
