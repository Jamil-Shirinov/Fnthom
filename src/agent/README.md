# Agent adapter and session controller

- `adapter.ts`: the application-owned agent interface (`planNext`, `implement`, `describe`). The Factory Droid adapter will implement it.
- `fakeAdapter.ts` and `fakeScenario.ts`: the deterministic agent for the demo and tests. Each of the five caching functions has two designs; rejecting one switches to the other and rewrites the remaining plan.
- `controller.ts`: the authoritative state machine. It runs the planning loop, records decisions, implements the accepted plan, runs checks, and builds the graph.

Agent calls never mutate the repository; the controller validates generated changes and applies them through the workspace port. Keep editor operations and rendering out of this folder. See [Droid integration](../../agents/integrations/factory-droid.md) and [the specification](../../agents/implementation/application-spec.md).
