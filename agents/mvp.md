# Hackathon MVP and demo

## Scope

Build one complete experience around a moderately complex feature in a small repository. The recommended demo is caching in an API: it provides a clear data-flow diagram and an understandable invariant about response schema consistency.

The original concept also used JWT authentication in a FastAPI application:

```text
Request → Authentication layer → Token validation → User lookup → Endpoint
```

The team chose caching in a TypeScript + Express + Vitest app (see [the decision record](decisions.md)).

## Priority order

1. Planning one function at a time with Accept and Reject.
2. Reworking the remaining plan after a rejection.
3. Implementing the accepted plan in one validated write.
4. A function graph built from the actual code.
5. Node pop-ups and navigation that highlights the responsible code.
6. Checks, diffs of what changed, and Markdown export.

## Build sequence

1. Done: UI shell, schemas, fake agent, demo app.
2. Done: planning loop, rework after rejection, implementation, checks.
3. Done: function graph, pop-ups, highlighted navigation, export, VSIX.
4. Next: the real Droid adapter behind the same interface, with the proposal-only gate.
5. Then: persistence and a fresh-install rehearsal of the demo.

## Demo story

1. Request caching for the weather endpoint.
2. The agent proposes `createTtlCache`. Reject it: "memory has to stay bounded".
3. The agent proposes `createLruCache` instead and shows how the remaining functions changed (createApp now creates an LRU cache; tests add an eviction check).
4. Accept the remaining functions, perhaps rejecting the wrapper in favor of caching inside the route.
5. The extension writes the code and the demo's tests pass.
6. The graph shows the new cache functions, the changed `createApp` and route, and how the request flows through them.
7. Click `withCache`: the pop-up explains it and the editor jumps to its highlighted code.
8. Export the reference.

The desired outcome is that the developer shaped the design and can explain the result without reading an undifferentiated diff.

## Meaningful validation

- Planning turns and generated code conform to the application schema.
- Planning leaves the demo repository unchanged.
- A rejection changes the upcoming plan, and the implementation follows the accepted designs.
- Implementation writes exactly the intended files; unsaved or changed files stop it.
- Graph nodes and links match the actual code and stay correct after edits.
- Failed checks remain visible.
- Cancellation and repeated clicks do not decide or write twice.
- Packaged UI assets, SDK startup, credentials, and executable discovery work on the demo machine.

Prefer focused tests for the edit controller and state transitions, plus a complete manual demo walkthrough. Do not spend the hackathon building broad infrastructure before the core loop works.
