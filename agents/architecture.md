# Architecture and state

```text
React webview: request, planning cards (Accept / Reject), function graph, pop-ups
                         ↕ typed messages
VS Code extension host: authoritative session state
  Context collection → plan one function → user decision ─┐
          ↑                                                │ reject: rework the rest of the plan
          └────────────────────────────────────────────────┘
  (plan complete) → generate code → validate → apply → checks → function graph from source
                         ↕
                 Agent adapter (Factory Droid target; fake agent today)
```

## Ownership

The extension owns the planning loop, user decisions, file application, the function graph, source navigation, and check results. The agent supplies proposals, reworked plans, generated code, and descriptions of existing functions.

The developer's checkpoints are the function proposals. Each one is explained before code exists, and nothing is written until every function is accepted. Code generation is then one run over the accepted plan, validated and applied by the extension. The agent never writes to the workspace itself; remove mutation and command execution from its tools through actual tool controls, not only prompts. See [Droid integration](integrations/factory-droid.md).

## Workflow state

```text
idle → planning → reviewing ──accept──→ planning → … → implementing → checking → done
                     └──reject──→ reworking → reviewing
```

Errors and cancellation go to `needsAttention` with a retry. One agent turn runs at a time; decisions carry the state revision the UI saw, so a stale or repeated click cannot decide twice. The full contract is in the [application specification](implementation/application-spec.md).

## Safe and accurate edit handling

- Generate code against snapshots that include unsaved editor buffers, and validate the result against fresh snapshots right before writing.
- Stop if a target has unsaved changes or changed while code was generated; never overwrite newer source silently.
- Apply everything through one VS Code workspace edit and save only touched files.
- Report per-file outcomes; never re-apply automatically after a partial write.

## Source grounding

The graph is built from the actual saved source with the TypeScript compiler API, not from the plan. Calls are resolved through imports and aliases; calls through an interface link to every function that returns that interface and are drawn dashed, because any of them may run. New and changed functions are found by comparing declaration hashes with the graph built just before implementation. Saving a file rebuilds the graph so links keep pointing at the right lines.

Purposes shown in pop-ups say where they came from: the accepted plan, the code's own doc comment, or an agent description. A passing check supports the behavior it exercises; it is shown next to the graph, not as proof of every edge.

Proposal evidence references point to source excerpts supplied in the planning context. The extension compares each quoted excerpt with those snapshots, and the UI can open the cited lines. A match establishes only that the text was present in the cited context; it does not prove the agent's rationale or the proposed change.
