# Hackathon MVP and demo

## Scope

Build one complete experience around a moderately complex feature in a small repository. The recommended demo is caching in an API: it provides a clear data-flow diagram and an understandable invariant about response schema consistency.

The original concept also used JWT authentication in a FastAPI application:

```text
Request → Authentication layer → Token validation → User lookup → Endpoint
```

Either can work, but choose one fixture and language/framework before implementation. The fixture is not yet selected.

## Priority order

1. Interactive architecture map.
2. Generation in conceptual steps.
3. Clickable source links from graph nodes.
4. Concise explanations for each step.
5. Persistent final architecture reference.
6. Optional prediction questions.
7. Optional Understand and Flow modes.

## Build sequence

1. **UI shell:** render a mocked graph and active-step panel in an extension webview.
2. **Source navigation:** clicking an implemented node opens and highlights its code.
3. **Droid feasibility:** obtain a structured plan and one proposal without repository mutation.
4. **One real patch:** preview and apply it through VS Code, with stale-source protection.
5. **Complete loop:** inspect, plan, propose, explain, apply, check, and continue across a feature.
6. **Grounding:** refresh source references and distinguish planned, applied, and checked work.
7. **Export and demo:** generate the final reference and package a working VSIX.

The Droid feasibility experiment can happen early alongside UI prototyping; it should precede committing to the full integration architecture.

## Demo story

1. Request caching for an endpoint.
2. Show the request-flow graph before edits.
3. Highlight the cache-lookup node as its implementation is proposed.
4. Inspect its small, coherent diff and explanation.
5. Ask a question or modify the approach.
6. Apply and continue through the remaining concepts.
7. Click nodes to navigate to the actual implementation.
8. Show relevant verification of response schema consistency and cache behavior.
9. Export the architecture reference.

The desired outcome is that the developer can explain the resulting architecture without reading an undifferentiated large diff. A user walkthrough is better evidence of comprehension than simply counting generated lines.

## Meaningful validation

- Plan and proposal output conform to the application schema.
- Proposal generation leaves the demo repository unchanged.
- Applying a proposal updates exactly the intended source.
- Manual or unsaved changes cause stale proposals to be reconciled or regenerated.
- Graph source links remain correct after edits.
- Failed checks remain visible and do not imply verified invariants.
- Questions, cancellation, and revised approaches do not accidentally advance or duplicate steps.
- Packaged UI assets, SDK startup, credentials, and executable discovery work on the demo machine.

Prefer focused tests for the edit controller and state transitions, plus a complete manual demo walkthrough. Do not spend the hackathon building broad infrastructure before the core loop works.
