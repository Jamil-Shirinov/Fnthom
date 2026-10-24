import { currentProposal, type ApplicationState, type CodeGraph } from "../../../src/shared/schema";
import type { UiActionInput } from "../vscode";
import { EDGE_STYLE, fileHue } from "./FunctionGraph";

type Send = (action: UiActionInput) => void;

export function ResultPanel(props: {
  state: ApplicationState;
  graph: CodeGraph;
  showTests: boolean;
  onShowTests: (show: boolean) => void;
  onShowDecisions: () => void;
  send: Send;
}) {
  const { state, graph, showTests, onShowTests, onShowDecisions, send } = props;
  const guard = { sessionId: state.sessionId, expectedRevision: state.stateRevision };
  const busy = state.operationId !== null;
  const counts = { new: 0, changed: 0 };
  for (const n of graph.nodes) if (n.status !== "unchanged" && n.kind !== "test") counts[n.status] += 1;
  const planned = graph.nodes.some((n) => n.planned);
  const waiting = state.phase === "reviewing" ? currentProposal(state.plan) : null;
  const files = [...new Set(graph.nodes.map((n) => n.path))].sort();
  const failed = state.checks.filter((c) => c.status !== "passed");

  return (
    <aside className="panel" aria-label="Result">
      {state.plan && state.applied.length > 0 ? (
        <>
          <h2>Feature implemented</h2>
          <p>
            {counts.new} new and {counts.changed} changed {counts.new + counts.changed === 1 ? "function" : "functions"}. Click any box to read
            what it does and jump to its code.
          </p>
          <button type="button" className="link" onClick={onShowDecisions}>
            Review the decisions
          </button>
        </>
      ) : state.plan ? (
        <>
          <h2>Planned so far</h2>
          <p>Dashed boxes and faded arrows are accepted but not written yet. The code is written once every function is planned.</p>
          {waiting && (
            <div className="waiting">
              <code>{waiting.name}</code> is waiting for your decision.{" "}
              <button type="button" className="link" onClick={onShowDecisions}>
                Review it
              </button>
            </div>
          )}
        </>
      ) : null}

      {state.checks.length > 0 && (
        <>
          <h3>Checks</h3>
          <ul className="checks">
            {state.checks.map((r) => (
              <li key={r.id}>
                <details open={r.status !== "passed"}>
                  <summary>
                    <span className={`badge badge--${r.status === "passed" ? "passed" : "failed"}`}>{r.status}</span> {r.label}
                  </summary>
                  <pre className="output">{r.output.trim() || "(no output)"}</pre>
                </details>
              </li>
            ))}
          </ul>
          {failed.length > 0 && <p className="hint">The code was kept. Fix it in the editor, then rerun.</p>}
          <button type="button" disabled={busy} onClick={() => send({ type: "rerunChecks", payload: guard })}>
            Rerun checks
          </button>
        </>
      )}

      {state.applied.length > 0 && (
        <>
          <h3>Files changed</h3>
          <ul className="files">
            {state.applied.map((f) => (
              <li key={f.path}>
                <span className={`chip ${f.baseHash ? "chip--changed" : "chip--new"}`}>{f.baseHash ? "changed" : "new"}</span>
                <code>{f.path}</code>
                <button type="button" className="link" onClick={() => send({ type: "previewChange", payload: { path: f.path } })}>
                  Diff
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Reading the graph</h3>
      <ul className="legend">
        <li>
          <span className="legend__box legend__box--new" /> New in this feature
        </li>
        <li>
          <span className="legend__box legend__box--changed" /> Changed by this feature
        </li>
        {planned && (
          <li>
            <span className="legend__box legend__box--planned" /> Planned, not written yet
          </li>
        )}
      </ul>
      <p className="hint">
        Arrow colors: <span style={{ color: EDGE_STYLE.call.color }}>direct call</span>, <span style={{ color: EDGE_STYLE.dispatch.color }}>call through an interface</span>,{" "}
        <span style={{ color: EDGE_STYLE.registers.color }}>route registration</span>. Open “Arrow colors” on the graph for details.
      </p>
      <ul className="legend">
        {files.map((f) => (
          <li key={f}>
            <span className="legend__file" style={{ background: `hsl(${fileHue(f, files)} 60% 55%)` }} /> <code>{f}</code>
          </li>
        ))}
      </ul>
      <label className="toggle">
        <input type="checkbox" checked={showTests} onChange={(e) => onShowTests(e.target.checked)} /> Show test files
      </label>
      {graph.skipped.length > 0 && <p className="hint">Not graphed: {graph.skipped.join(", ")}</p>}

      <div className="actions">
        <button type="button" onClick={() => send({ type: "export", payload: {} })}>
          Export as Markdown
        </button>
        <button type="button" disabled={busy} onClick={() => send({ type: "showGraph", payload: guard })}>
          Rebuild graph
        </button>
      </div>
    </aside>
  );
}
