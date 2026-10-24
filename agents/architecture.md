# Architecture and state

```text
React webview: prompt, graph, explanation, step controls
                         ↕ typed messages
VS Code extension host: authoritative session state
  Context collection → Planner → Current-step proposal
                                      ↓
                            Validate edits and claims
                                      ↓
                             Native diff preview
                                      ↓
                         Apply → Check → Refresh graph
                         ↕
                 Factory Droid SDK → Coding model and tools
```

## Ownership

The extension owns conceptual-step boundaries, user actions, file application, source navigation, graph state, and evidence presentation. Droid supplies agent context, model interaction, repository tools, and streamed activity.

Do not start one unrestricted "implement everything" run and try to reconstruct conceptual checkpoints afterward. Tool events describe operations; they do not automatically identify meaningful learning units.

For the initial design, ask Droid for proposals and let the extension apply them. Remove mutation and command-execution capabilities from proposal generation through actual tool controls, rather than relying only on prompt instructions. See [Droid integration](integrations/factory-droid.md).

## Workflow state

Suggested lifecycle:

```text
idle → inspecting → plan-ready → proposing → preview-ready
                                             ↓
                          revising ← user choice → applying
                                                      ↓
                                                   checking
                                                      ↓
                                        next-step-ready / complete
```

Account for errors, cancellation, stale source, and failed checks. A session supports a single active turn; serialize requests and prevent double application.

Each step should include a concept ID, explanation, dependencies, proposed edits, expected behavior, source references, assumptions, and relevant checks. Only generate the current step; revise future steps when the developer changes the approach.

## Proposed concept schema

This is illustrative design, not an implemented API:

```ts
type ConceptNode = {
  id: string;
  title: string;
  dependsOn: string[];
  status: "planned" | "current" | "applied" | "checked";
  explanation: string;
  sourceRefs: {
    path: string;
    symbol?: string;
    startLine: number;
    endLine: number;
  }[];
  invariants: {
    claim: string;
    evidence: string[];
    status: "unverified" | "supported" | "failed";
  }[];
};
```

Use stable IDs independent of graph position or title. Define line-number conventions at the serialization boundary. VS Code positions are zero-based; user-facing source links commonly use one-based lines.

## Safe and accurate edit handling

- Associate proposals with exact source versions or content hashes.
- Before applying, verify the underlying documents still match those versions, including unsaved editor changes.
- If the source changed, regenerate or reconcile the proposal; do not overwrite it silently.
- Apply a coherent set of edits through VS Code's edit API.
- Report failures and partial outcomes accurately; do not advance graph state on an unsuccessful apply.
- Make intermediate steps coherent. If a dependency leaves a temporary incomplete state, explain it and avoid claiming checks passed.

## Source grounding and evidence

Resolve references against the actual post-apply source. Refresh them after subsequent edits. Prefer symbols plus ranges over treating generated line numbers as permanent identifiers. Manual changes should invalidate stale references or evidence rather than preserving a false appearance of correctness.

A passing test supports the specific behavior it exercises. It does not prove every invariant or diagram edge. "Applied" and "checked" are different states; record which checks ran, what they covered, and whether they passed.

Persist graph and session metadata locally. Export a concise Markdown explanation of the completed feature, including important assumptions and unresolved claims. Runtime data belongs outside `agents/`.
