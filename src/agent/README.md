# Agent engine and step controller

Implement the Factory Droid adapter and conceptual workflow here. Start with `session.ts`, `planner.ts`, and `stepGenerator.ts`; add a controller module when wiring the full loop.

Own session creation/disposal, structured plan and proposal requests, cancellation, and advancing one conceptual step at a time. Return proposals to the workspace layer for preview/application. Do not let proposal generation mutate the target repository.

Keep graph rendering and direct VS Code editor operations outside this folder. See [Droid integration](../../agents/integrations/factory-droid.md) and [architecture](../../agents/architecture.md).
