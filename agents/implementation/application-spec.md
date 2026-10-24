# Application implementation specification

## 1. Purpose and status

Implement a desktop VS Code extension that turns a feature request into an inspectable architecture map, then generates and applies one conceptual code change at a time. The developer should understand each component's role and be able to navigate from the map to actual source.

This is the proposed MVP implementation contract, written before application code exists. Requirements below make concrete choices where earlier documents left implementation details open. They are design defaults, not claims that Droid integration has already been validated. Changes should be recorded in [the decision record](../decisions.md).

The [product concept](../product.md) explains the rationale. This specification governs the initial application behavior where it is more specific than earlier illustrative designs.

## 2. Scope

### Required

- One local workspace folder and one active feature session.
- TypeScript extension host, React webview, React Flow graph, Factory Droid adapter.
- Repository inspection, structured planning, and one-step proposal generation.
- Native diff preview, version-checked application, and source navigation.
- Questions about the current step and revision of the remaining approach.
- Explicit verification evidence and local session persistence.
- Markdown export and an installable VSIX.

### Deferred

- Editor fork, hosted backend, accounts managed by this application, collaboration, vector search, and multiple model providers.
- Autonomous Flow mode, quizzes, automatic dependency installation, arbitrary terminal execution by the model, and background multi-agent work.
- Remote/browser workspaces, multiple workspace roots in one session, binary edits, file deletion/rename, and editing files outside the selected root.

The MVP may span multiple existing text files and create text files. It must not enforce a fixed changed-line limit; conceptual coherence takes precedence.

## 3. User experience

Register commands under a single product category. Proposed command IDs use the `humanCenteredAgent` prefix:

| Command | Behavior |
| --- | --- |
| `humanCenteredAgent.open` | Open or reveal the panel; restore local state if available |
| `humanCenteredAgent.setApiKey` | Collect the Factory key through a masked input and store it in secret storage |
| `humanCenteredAgent.export` | Export the current feature reference through a save dialog |
| `humanCenteredAgent.resetSession` | Confirm discarding session metadata; never reset source files |

If no folder is open, show an actionable empty state. If several roots are open, require selection of one root for the session. Require a trusted workspace before model-driven repository operations or check execution.

### Layout

- **Header:** feature intent, connection/session status, progress, cancel, and export.
- **Graph:** components and labeled data-flow edges; selection independent of the active generation step.
- **Step panel:** purpose, inputs, outputs, assumptions, invariants, changed files, source links, and check results.
- **Conversation area:** focused questions and approach revisions.
- **Native editor:** actual source and before/after previews, opened beside the panel.

The graph must distinguish planned, active, applied, and stale implementation. Verification is a separate badge; a passing check must not recolor every claim as proven. Use text/icons as well as color. Controls must be keyboard accessible and reflect the active VS Code theme.

### Primary flow

1. Enter a feature request, optionally using currently selected files as context seeds.
2. Show repository inspection activity and then a structured plan with a suggested step order.
3. Developer chooses **Start first step**; generate only that step.
4. Show the explanation and changed-file list. **Preview diff** opens a native diff for each selected file.
5. **Apply & Continue** applies the reviewed proposal, saves affected documents, runs configured checks, and prepares the next step if checks pass or no checks are configured.
6. On check failure, keep the applied code and pause for repair, revision, or **Continue with failed checks**. The latter must retain visible failed evidence.
7. After the last step, show completion, unresolved claims, and export.

**Ask about this** cannot mutate code or advance the step. **Modify approach** invalidates any unapplied proposal and replans remaining work. **Collapse explanation** only changes presentation; it does not apply or authorize edits. There is no automatic Flow mode in the MVP.

## 4. Module boundaries

| Location | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation, commands, service construction, disposal |
| `src/panel.ts` | Webview lifecycle, local assets, validated message routing |
| `src/agent/session.ts` | Droid adapter, credentials, capability discovery, stream/cancellation lifecycle |
| `src/agent/planner.ts` | Context-to-plan requests and plan validation |
| `src/agent/stepGenerator.ts` | Current-step proposals and focused explanations |
| `src/agent/controller.ts` | Authoritative state machine, operation queue, revisions, recovery |
| `src/workspace/context.ts` | Bounded context selection and document snapshots |
| `src/workspace/edits.ts` | Proposal validation, stale checks, application, reconciliation |
| `src/workspace/preview.ts` | Read-only virtual before/after documents and native diffs |
| `src/workspace/sourceLinks.ts` | Navigation, decorations, anchor resolution/invalidation |
| `src/workspace/checks.ts` | Configured check execution, cancellation, evidence |
| `src/workspace/storage.ts` | Versioned local state, recovery journal, Markdown export |
| `src/shared/schema.ts` | Domain schemas and inferred TypeScript types |
| `src/shared/messages.ts` | Versioned UI/host protocol |
| `webview/src/vscode.ts` | Typed message bridge; no credentials or filesystem access |
| `webview/src/App.tsx` | Application shell and host-state rendering |
| `webview/src/components/` | Graph, step panel, questions, and status components |

These are implementation destinations, not a requirement to create empty modules upfront. Use one root package. Shared modules must remain portable and must not import the VS Code, Droid, Node filesystem, or React runtimes.

## 5. Domain contracts

Define runtime schemas first and infer TypeScript types from them. All persisted or cross-process values must be validated. IDs are opaque strings; paths are normalized workspace-relative paths. Serialized source lines are one-based and inclusive; convert to zero-based editor positions only at the VS Code boundary.

### Plan

`FeaturePlan` contains `id`, `revision`, `intent`, `summary`, `concepts`, `edges`, `steps`, and `assumptions`.

- `Concept`: stable `id`, `title`, `purpose`, `inputs`, `outputs`, `intendedPaths`, `sourceRefs`, and `invariants`.
- `DataFlowEdge`: `id`, `fromConceptId`, `toConceptId`, and `label`. Data flow may contain cycles.
- `ImplementationStep`: `id`, `title`, `conceptIds`, `dependsOnStepIds`, and `expectedBehavior`.
- `Invariant`: `id`, `claim`, `sourceRefs`, `evidenceIds`, and derived status `unverified | supported | failed | stale`.

Reject duplicate IDs, unknown references, cyclic step dependencies, and an empty implementation plan. Step dependencies form a DAG; data-flow edges do not determine implementation ordering. Preserve IDs for unchanged concepts across revisions. Freeze already-applied step history; mark replaced future steps superseded rather than rewriting history.

### Source snapshots and references

`FileSnapshot` contains `path`, `exists`, `content`, `contentHash`, and optional in-memory `documentVersion`. Hash the exact string presented to the model, including line endings. Prefer open editor document contents to disk contents.

`SourceRef` contains `path`, optional `symbol`, `startLine`, `endLine`, `contentHash`, and resolution status `resolved | stale | missing`. Only resolved references can navigate directly. Planned paths are not source references.

### Proposal

```ts
type ProposedFile =
  | { kind: "update"; path: string; baseHash: string; newContent: string }
  | { kind: "create"; path: string; newContent: string };

type StepProposal = {
  id: string;
  planRevision: number;
  stepId: string;
  explanation: {
    purpose: string;
    inputs: string[];
    outputs: string[];
    assumptions: string[];
  };
  files: ProposedFile[];
  invariantIds: string[];
  suggestedCheckIds: string[];
};
```

For the small MVP fixture, use full replacement contents rather than model-authored patch syntax. Compute the displayed diff in the extension. A proposal must contain actual changes, exactly one entry per path, and only the current step's work. Before applying a proposal touching a previously unread file, capture its baseline and regenerate against that baseline. The host must validate hashes against its snapshots; model-provided hashes are not authoritative.

Reject absolute paths, traversal, paths resolving outside the root through symlinks, unsupported file types, and oversized payloads. Preserve exact proposed content; do not silently reformat it after review.

### Evidence and state

`CheckDefinition` contains `id`, `label`, executable, argument array, workspace-relative working directory, timeout, and explicitly associated invariant IDs. It is configured by the developer or fixture, never executed directly from model text.

`CheckResult` contains `id`, `checkId`, `stepId`, timestamps, exit code if available, bounded output, status `passed | failed | cancelled | timed-out | error`, and the source fingerprint at execution time.

`ApplicationState` contains schema version, session ID, state revision, workspace identity, plan, current step, proposal, application history, evidence, questions/answers, operation ID, phase, and any recoverable error. Keep credentials and raw SDK objects out of this structure.

Invariant status is derived from explicit source/evidence associations: current passing evidence may support a claim, a relevant failing assertion marks it failed, and source changes invalidate prior support. An infrastructure error does not by itself demonstrate a false invariant. Claims with no relevant evidence remain unverified. For the MVP, conservatively invalidate check evidence on any workspace source change; exclude extension-owned storage and generated build output from change tracking.

## 6. State machine and concurrency

Main phases:

```text
idle → inspecting → planReady → proposing → previewReady
                                             ↓
                                          applying
                                             ↓
                                          checking
                                             ↓
                              stepReady / needsAttention / complete
```

- `stepReady` enters `proposing` for the next dependency-ready step.
- Questions run as read-only operations and return to the prior stable phase.
- Revision enters `revising`, invalidates the pending proposal, and returns to `planReady` with applied history preserved.
- Generation failure/cancellation returns to the prior stable phase with a visible error/status.
- Stale source invalidates the proposal and requires regeneration; it never advances the step.
- Apply failure enters `needsAttention` with actual file outcomes.
- Failed/cancelled/errored checks enter `needsAttention`; skipped checks are labeled as not run.
- Completion means all intended steps were applied, not that every invariant was verified.

The controller serializes mutating operations and permits one active Droid turn. Assign operation IDs and ignore late events from superseded/cancelled operations. Reject duplicate apply requests for a consumed proposal. Disable incompatible UI controls while busy; enforce the same guards in the host.

Cancellation must interrupt model work/check processes and preserve applied code. Once file application begins, finish reconciliation before accepting another action. Do not pretend cancellation undoes applied edits.

## 7. Host/webview protocol

Use discriminated message schemas with `protocolVersion`, `requestId`, `type`, and typed payload. Session-changing actions additionally include `sessionId`, expected state revision, and proposal/step IDs where applicable.

UI actions: `ready`, `startFeature`, `startStep`, `selectConcept`, `openSource`, `previewFile`, `applyAndContinue`, `askQuestion`, `reviseApproach`, `regenerateProposal`, `rerunChecks`, `continueAfterFailure`, `cancel`, `export`, and `resetSession`.

Host messages: `stateSnapshot`, `activity`, `answer`, `requestError`, and `requestComplete`. A state snapshot is authoritative. UI-local graph positions, selection, and collapsed panels must not overwrite domain state.

On `ready`, send the current full state. Use a monotonically increasing state revision to reject stale actions and recover from webview reloads. Validate every incoming path/ID against host state rather than trusting the UI's payload. Render model text as text or sanitized Markdown; do not execute model-supplied HTML.

## 8. Droid adapter

Expose an application-owned interface for `inspectAndPlan`, `proposeStep`, `answerQuestion`, `revisePlan`, `cancel`, and `dispose`. SDK-specific message types stay inside the adapter. Return validated domain objects and normalized activity events to the controller.

Before implementation, verify the installed SDK/CLI capabilities against [the integration guide](../integrations/factory-droid.md). Pin compatible versions and test executable discovery, credentials, structured output, tool discovery, cancellation, and session disposal from the extension host.

Proposal-only operation is an integration gate: discover tools, disable all mutation/execution/delegation paths, and verify the repository is unchanged after plan/proposal/question turns. Prompt instructions alone do not satisfy this gate. Unsupported or unknown capabilities should fail the gate with a useful diagnostic. If the boundary cannot be enforced, keep the real-workspace integration disabled and revise the design before proceeding.

Do not assume SDK stream events are conceptual steps. Require explicit structured results for plans/proposals. Missing or invalid structured output must not produce edits; permit one bounded repair request, then surface a recoverable error. User-triggered retry is available after errors. Do not retry application automatically.

Pass accepted code, relevant check outcomes, and current source snapshots back to the session before generating subsequent work. If SDK context is lost, create a new session from persisted application state and current source rather than pretending the prior context exists.

## 9. Context, previews, and applying code

Use bounded context: project metadata, a filtered tree, selected files, and relevant imports. Exclude dependencies, build output, binary files, credential files, and extension session storage by default. Start with a 100 KiB per-file limit and 1 MiB total context limit; expose omissions and request narrower scope rather than truncating source silently. Use a 2 MiB total proposal limit. These are tunable MVP defaults, not model context-window claims.

Virtual previews must be immutable for a particular proposal ID. Show the exact baseline and proposed contents, including a clearly labeled empty baseline for new files.

Apply procedure:

1. Validate proposal identity, plan revision, step readiness, paths, and schemas.
2. Re-read all touched files, including in-memory content. Require matching update baselines and continued nonexistence for creates.
3. If a touched document already has unsaved changes, pause application and offer to save it or regenerate later; never save unrelated user changes implicitly.
4. Persist an application journal with baseline/proposed hashes and pending status.
5. Submit the coherent edit through the VS Code workspace edit API; inspect the result and actual document contents.
6. Save only affected documents. Record applied/saved outcomes independently; a save failure retains visible recovery state and blocks checks/continuation.
7. Refresh source anchors, record the applied proposal ID, and run checks once source is saved.

Do not assume file creation mixed with text edits has transactional rollback. If the result is partial, show which files changed and offer reconciliation/regeneration. Never blindly reapply a proposal or automatically restore baselines over newer user changes. Native Undo remains available, but subsequent document changes must invalidate the session's source/evidence state.

Resolve symbols against actual editor symbols when available. A reference without a symbol may navigate by range only while its content hash matches. When a symbol cannot be uniquely resolved, mark the reference stale and offer the file without asserting an exact range. Do not keep generated line numbers indefinitely.

## 10. Checks and failure recovery

Checks run through the host using configured executable/argument arrays without model-supplied shell interpolation. Run them sequentially, stream bounded output, and retain pass/fail evidence. Default timeout is 60 seconds per check and retained output is capped at 64 KiB per check with a truncation notice. Cancellation must clean up the child process and its descendants where supported.

The model can suggest known check IDs or describe additional checks; unknown suggestions are displayed, not executed. With no configured checks, mark verification not run and permit progression without claiming success.

If checks fail, offer rerun, revision/repair, and explicit continuation with failed evidence. A repair is another reviewed proposal against current source, not an automatic hidden edit. A check that changes workspace source invalidates that evidence and requires reconciliation; do not treat formatters as read-only verification.

Errors must identify the failed stage and next action: authentication, executable discovery, invalid output, stale source, file application, save, checks, persistence, or export. Keep useful diagnostics while redacting credentials. Preserve the most recent valid state.

## 11. Persistence and export

Store versioned session JSON and application journals in the extension's workspace storage location. Do not write runtime state to `agents/`. Use atomic temporary-file replacement for state files where available. Persist stable transitions and application intent; do not persist every streaming delta.

On restore, validate schema/workspace identity, reconcile pending journals against actual source, and mark interrupted operations. Never replay an apply automatically. Resume at a stable state; require regeneration if source no longer matches. Unsupported schema versions must produce a clear reset/export option rather than a crash.

Export Markdown through a save dialog with intent, component responsibilities, data flow, source references, applied steps, assumptions, check summaries, and unresolved/failed/stale claims. Export paths and lines should refer to actual source; unresolved references must be labeled. Export does not require an additional model call.

## 12. Build and configuration

Use one root `package.json` and lockfile. Bundle the extension for its Node host and the React app for its browser environment separately. Keep output in `dist/` and `webview/dist/`. Restrict webview resources to bundled assets and use a content security policy with nonces for executable scripts.

Provide root scripts for `dev`, `build`, `typecheck`, `test`, and `package`, with documented behavior. Add a VS Code launch configuration for F5 development. `package` must build first and include UI assets and required runtime dependencies in the VSIX. Choose exact tool versions during scaffolding, after checking compatibility.

Settings should cover optional Droid executable path, optional model ID, and configured checks. Credentials use secret storage. Do not expose credentials through webview state or exported documents. Default to the account's available model rather than embedding an unverified model ID.

## 13. Acceptance criteria

| Scenario | Required result |
| --- | --- |
| Open installed extension | Panel loads bundled UI; missing prerequisites have actionable errors |
| Request demo feature | Valid map appears before edits; repository remains unchanged |
| Generate first step | Only one coherent proposal appears with explanation and file previews |
| Ask a question | Answer arrives without source mutation or step advancement |
| Apply twice or replay message | Proposal applied at most once |
| Modify source after proposal | Application blocked; newer source preserved |
| Existing unsaved source | Application pauses before saving user edits |
| Create target appears meanwhile | Proposal rejected as stale |
| Apply/save failure | Real outcomes shown; no false step completion or automatic replay |
| Run relevant checks | Actual outcomes and covered claims displayed |
| Check fails | Applied code remains; continuation requires explicit choice |
| Edit applied source manually | References/evidence become stale or are re-resolved |
| Select implemented graph node | Correct file/range opens or stale/missing state is explained |
| Revise approach | Applied history retained; pending proposal invalidated |
| Cancel/close/reload | Work stops or reconciles; session can recover without duplicated edits |
| Finish feature | Export describes actual code and unresolved claims |
| Install VSIX on demo machine | UI, SDK startup, source navigation, and full walkthrough work |

Implement focused schema/controller/edit tests and extension integration tests where editor behavior matters. Use a fake Droid adapter for deterministic failure/recovery tests, plus a real SDK smoke test for the capability gate. A manual end-to-end demo remains required.

## 14. Suggested implementation sequence

1. Root tooling, shared schemas, fake adapter, panel, and graph with fixtures.
2. Context snapshots, immutable diffs, stale-source checks, and one real VS Code edit.
3. Real Droid adapter and proposal-only capability gate.
4. Controller, questions, revisions, check evidence, and cancellation.
5. Source-anchor invalidation, persistence/recovery, and Markdown export.
6. Repeatable demo fixture, VSIX packaging, and fresh-install walkthrough.

The target demo language/framework, Factory account/model access, and exact dependency versions remain open. They do not block implementing portable schemas, fake-adapter UI, or the edit controller. No application code is included in this specification change.
