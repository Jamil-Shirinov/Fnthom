# Application implementation specification

## 1. Purpose and status

Implement a desktop VS Code extension in which the developer plans a feature with the agent one function at a time, then sees the implemented code as a graph of how the project's functions connect. Each proposed function or module is explained before any code exists, and the developer accepts or rejects it. A rejection makes the agent rework the rest of the plan. Once every function is accepted, the extension writes all the code at once, runs the configured checks, and builds a function graph from the actual source. Clicking a node shows a pop-up with its purpose and opens its code in an editor tab with the lines highlighted.

This contract replaces the earlier "architecture map plus one applied step at a time" design after the user's direction on Oct 24 (see [the decision record](../decisions.md)). Requirements below are design defaults for the MVP, not claims that the Droid integration has been validated. The current implementation uses a deterministic fake agent.

The [product concept](../product.md) explains the rationale. This specification governs application behavior where it is more specific than other documents.

## 2. Scope

### Required

- One local workspace folder and one active feature session.
- TypeScript extension host, React webview, React Flow graph, and an agent adapter (Factory Droid as the target; a fake adapter until then).
- Planning one function at a time with Accept and Reject, and a reworked plan after each rejection.
- A follow-up question option on the current proposal; answers explain the proposal without changing the plan.
- Source references on proposals, with quoted lines checked against the planning context and clickable navigation.
- Implementation of all accepted functions in one validated, version-checked write.
- A function graph built from source, with new and changed functions marked, a pop-up per node, and navigation that highlights the node's code.
- Configured checks after implementation, diffs of what changed, and Markdown export.
- An installable VSIX.

### Deferred

- Editor fork, hosted backend, accounts managed by this application, collaboration, vector search, and multiple model providers.
- Session persistence across window reloads (state is in memory for the MVP).
- Editing a proposal in place instead of rejecting it.
- Graphs for languages other than TypeScript and JavaScript.
- Remote/browser workspaces, multiple workspace roots in one session, binary edits, file deletion/rename, and editing files outside the selected root.

## 3. User experience

Commands use the `fnthom` prefix:

| Command | Behavior |
| --- | --- |
| `fnthom.open` | Open or reveal the panel |
| `fnthom.setApiKey` | Collect the Factory key through a masked input and store it in secret storage |
| `fnthom.export` | Export the plan and graph as Markdown through a save dialog |
| `fnthom.resetSession` | Confirm discarding session metadata; never reset source files |

If no folder is open, show an actionable empty state. If several roots are open, require selection of one root. Require a trusted workspace before the agent reads the repository, before writing code, and before running checks.

### Primary flow

1. Enter a feature request and choose **Plan it**. The agent reads bounded repository context.
2. The agent proposes one function or module: name, kind, file, whether it is new or changes existing code, signature, purpose, how it works, what it calls and what calls it. It may attach source references with exact excerpts and a rationale. The extension checks each excerpt against the source context; the UI labels references as context, not proof, and lets the developer open the cited lines.
3. **Accept** records the decision and asks for the next proposal.
4. **Reject** takes an optional reason. The agent proposes a replacement and reworks the upcoming functions around the rejection, and says what it changed. The rejected design stays visible in the history.
   The developer may instead choose **Ask a question** on the current proposal. The agent answers using the proposal and repository context; the answer is shown with the proposal, and the plan remains unchanged.
5. When the agent reports the plan complete, the extension implements every accepted function, applies the files, saves them, and runs the configured checks.
6. The panel switches to the function graph. New and changed functions are marked. Clicking a node shows a pop-up (purpose, file and lines, calls and callers, where the purpose came from) and opens the code in an editor tab with those lines highlighted.
7. The side panel lists changed files with before/after diffs, check results with rerun, the decisions, and export.

**Show the current function graph** builds the graph without a feature. Failed checks never hide the graph; they stay visible with their output.

### Layout

- **Header:** feature request, phase, live agent activity, cancel, reset, and errors with **Try again**.
- **Planning view:** progress, decided functions (accepted or rejected with reason), the current proposal card, and upcoming functions.
- **Graph view:** React Flow graph laid out top to bottom (callers above callees), a colored stripe per file, a border for new and changed functions, and dashed edges for calls through an interface.
- **Result panel:** summary, checks, changed files with diffs, legend, a test-file toggle, export, and rebuild.

Use text as well as color for every state, keep controls keyboard accessible, and follow the active VS Code theme.

## 4. Module boundaries

| Location | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation, commands, service construction, file watching, disposal |
| `src/panel.ts` | Webview lifecycle, local assets, validated message routing, node navigation and highlight, diffs |
| `src/agent/adapter.ts` | Application-owned agent interface |
| `src/agent/fakeAdapter.ts`, `fakeScenario.ts` | Deterministic agent and the scripted caching scenario with two designs per function |
| `src/agent/controller.ts` | Authoritative state machine, operations, revisions, recovery |
| `src/workspace/port.ts` | What the controller needs from the editor and file system |
| `src/workspace/vscodeWorkspace.ts` | The VS Code implementation of the port |
| `src/workspace/edits.ts` | Validation of generated file changes against snapshots |
| `src/workspace/codeGraph.ts` | Function graph from source with the TypeScript compiler API |
| `src/workspace/preview.ts` | Read-only before/after documents for diffs |
| `src/workspace/checks.ts` | Configured check execution, cancellation, bounded output |
| `src/shared/schema.ts`, `messages.ts`, `exportMarkdown.ts` | Portable domain schemas, protocol, and export |
| `webview/src/` | Bridge, application shell, planning view, graph, result panel |

Shared modules must stay portable: no imports from VS Code, Droid, Node, or React runtimes.

## 5. Domain contracts

Define runtime schemas first and infer TypeScript types from them. Validate everything that crosses a process or comes from the agent. Paths are normalized workspace-relative paths; serialized lines are one-based and inclusive and convert to zero-based positions only at the VS Code boundary.

### Planning

- `FunctionProposal`: `id`, `name`, `kind` (`function | module | route | test`), `path`, `change` (`new | change`), `signature`, `purpose`, `details`, up to five optional source `evidence` references, `calls`, `calledBy`, and optional `replacesId` when it reworks a rejected proposal.
- `EvidenceReference`: workspace-relative path, one-based inclusive line range, exact quoted text, and rationale. The extension sets `verified` only when the path is in the planning context and the quote matches those lines; otherwise it sets an explanatory `verificationNote`. A matched quote verifies only that the excerpt exists in the context, not the agent's interpretation or proposal.
- `PlannedFunction`: a proposal plus `status` (`proposed | accepted | rejected`) and optional `rejectionReason`.
- `FeaturePlan`: `intent`, `summary`, every proposal in order (rejected ones included), `upcoming` (name and summary per expected function), and `reworkNote` after the latest rejection.
- `PlanningTurn` (agent output): `summary`, `next` (a proposal, or `null` when planning is complete), `upcoming`, optional `reworkNote`.

At most one function is `proposed` at a time. Proposal ids must be unique within a plan.

### Implementation

```ts
type FileChange =
  | { kind: "update"; path: string; baseHash: string; newContent: string }
  | { kind: "create"; path: string; newContent: string };
```

Use full replacement contents, not patch syntax, with exactly one entry per path. The host validates hashes against its own snapshots; agent-provided hashes are never authoritative. Reject absolute paths, traversal, blocked locations (`.git`, `node_modules`, `dist`, `.env*`), unsupported file types, no-op updates, and payloads over 2 MiB.

`AppliedFile` records `path`, `baseHash` (null for created files) and `appliedHash`.

### Graph

- `GraphNode`: `id` (`path#name`), `name`, `kind` (`function | method | route | module | test`), `path`, `startLine`, `endLine`, `exported`, `bodyHash`, optional `purpose` and `purposeSource` (`plan | comment | agent`), and `status` (`new | changed | unchanged`).
- `GraphEdge`: `from`, `to`, `kind`: `call` (direct), `dispatch` (a call through an interface or object type that a function returns, so any implementer may run), or `registers` (a function setting up a route).

Nodes: top-level function declarations and `const` arrow or function expressions, class methods, Express-style `app.METHOD("/path", handler)` registrations, and a module node for files whose top-level code calls project functions. Test files are graphed as one node each and hidden by default.

Purposes, in order of preference: the accepted plan entry with the same name and file, the doc comment directly above the declaration, then an agent description. A node with none says so.

Status compares each node's `bodyHash` with the graph built just before implementation.

### Checks and state

`CheckDefinition` has `id`, `label`, executable, argument array, workspace-relative working directory, and timeout. It comes from settings, never from model text. `CheckResult` records timestamps, exit code, bounded output with color codes stripped, and status `passed | failed | cancelled | timed-out | error`.

`ApplicationState` has schema version, session id, state revision, workspace identity, phase, plan, applied files, check results, graph, operation id, and a recoverable error. Credentials and SDK objects never enter it.

## 6. State machine and concurrency

```text
idle → planning → reviewing ──accept──→ planning → … → (plan complete)
                     │                                       ↓
                     └──reject──→ reworking → reviewing   implementing → checking → done
```

- Planning, reworking and implementing failures, including cancellation, enter `needsAttention` with **Try again**, which repeats the failed step from the last decision.
- Unsaved target files and code that changed while it was being generated enter `needsAttention`; nothing is written, and **Try again** regenerates.
- A partial write enters `needsAttention` with the real per-file outcomes and no automatic retry.
- Failed checks do not block: the session reaches `done` with the failures shown and a rerun.
- Building the graph without a feature keeps the current phase.

One agent turn or mutation runs at a time. Every session-changing action carries the state revision the UI saw; the host rejects stale or duplicate decisions. Late results from superseded or cancelled operations are dropped. Cancellation is ignored while files are being written so the outcome can be reported.

## 7. Host/webview protocol

Messages are discriminated unions with `protocolVersion`, `requestId`, `type` and a typed payload.

UI actions: `ready`, `startFeature`, `acceptFunction`, `rejectFunction` (optional reason), `askQuestion` (current proposal id and question), `openEvidence` (workspace-relative path and line range), `retry`, `showGraph`, `openNode`, `previewChange`, `rerunChecks`, `cancel`, `export`, `resetSession`.

Host messages: `stateSnapshot` (authoritative), `activity`, `requestError`, `requestComplete`. Node selection, the test-file toggle and graph positions are UI-local. Render model text as text.

## 8. Agent adapter

The application-owned interface has `planNext`, `answerQuestion`, `implement`, `describe`, `cancel` and `dispose`:

- `planNext({ intent, context, history, lastDecision })` returns a `PlanningTurn`. After a rejection it must rework the upcoming functions and explain the change.
- `answerQuestion({ intent, proposal, history, question, context })` answers a follow-up about the active proposal. It is read-only and must not alter the proposal or plan.
- `implement({ intent, functions, context })` returns full-content file changes for the accepted functions; rejected entries say which designs to avoid.
- `describe({ nodes })` returns one-sentence purposes for graph nodes without a plan entry or doc comment.

All three are read-only. Proposal-only operation remains the integration gate for Factory Droid: discover tools, disable mutation, execution and delegation, and verify the repository is unchanged after every turn. Require structured output; invalid output never produces edits.

The fake adapter serves a scripted caching scenario for `demo/app`: five functions with two designs each. Rejecting a function switches to its other design and rewrites the remaining plan to match; all 32 combinations typecheck and pass their tests.

## 9. Context and applying code

Context is the workspace's source files (TypeScript and JavaScript, excluding dependencies, build output, VCS data and editor settings), smallest first up to 512 KiB, with open editor buffers preferred over disk.

Apply procedure:

1. Validate the change set's shape.
2. Stop if any target file has unsaved changes.
3. Re-read every target and validate: update baselines must match, created files must still not exist.
4. Keep the baselines in memory for diffs, then submit one `WorkspaceEdit`.
5. Inspect each document's actual content, save only touched documents, and record per-file outcomes.
6. Run checks, then build the graph from the saved source.

After implementation, saving a source file rebuilds the graph so node links keep pointing at the right lines. Native undo remains available.

## 10. Checks and failure recovery

Checks run sequentially through the host with argument arrays, a shell only on Windows, a 60-second default timeout, and output capped at 64 KiB. Cancellation stops the process group. With no configured checks, the graph is shown without verification results.

Errors identify the stage (`planning`, `invalid-output`, `stale-source`, `save`, `apply`, `graph`, `export`) and the next action.

## 11. Export

Export Markdown through a save dialog: intent, summary, accepted functions with details, rejected designs with reasons, a Mermaid diagram of the graph, each function's location and purpose, changed files, and check results. No model call is needed.

## 12. Build and configuration

One root `package.json` and lockfile. esbuild bundles the host (minified, including the TypeScript compiler for the graph) to `dist/`; Vite bundles the webview to `webview/dist/` with fixed asset names. The webview CSP allows only bundled scripts with a nonce. Settings cover the optional Droid executable path, optional model id, the fake-agent switch, and checks. Credentials use secret storage.

## 13. Acceptance criteria

| Scenario | Required result |
| --- | --- |
| Request the demo feature | First function proposal appears with explanation and upcoming functions; repository unchanged |
| Accept | Next proposal appears; the accepted function moves to the history |
| Reject with a reason | A replacement appears with a rework note; upcoming functions change to match; the rejected design stays visible |
| Ask a follow-up about the current proposal | An answer appears without changing the proposal or the rest of the plan |
| Proposal includes source references | Exact excerpts are checked against planning context; matched references navigate to the cited lines and are explicitly not presented as proof |
| Decide twice or on a stale revision | Rejected without changing state |
| Last acceptance | All accepted functions are written at once and checks run |
| Target file unsaved or changed meanwhile | Nothing is written; the user can try again |
| Partial write | Real outcomes shown; no automatic replay |
| Check fails | Code is kept; the graph still appears with the failure and a rerun |
| Graph after implementation | New and changed functions marked; calls, interface calls and routes connected |
| Click a node | Pop-up with purpose; its code opens in an editor tab with its lines highlighted |
| Edit and save code afterwards | Graph rebuilds with current line numbers |
| Install VSIX on the demo machine | Full walkthrough works |

## 14. Implementation sequence

1. Done: tooling, schemas, protocol, fake agent, planning loop, implementation, checks, graph, panel, export, packaging.
2. Next: the real Factory Droid adapter behind the same interface, and its proposal-only gate.
3. Then: session persistence and recovery, and graph support beyond TypeScript and JavaScript if the demo needs it.
