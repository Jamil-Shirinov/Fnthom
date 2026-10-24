# Focused verification

Keep cross-module behavior and extension integration tests here. Start with proposal-only generation, stale-source rejection, exactly-once application, and conceptual-step transitions. Add tests as the corresponding implementation lands.

UI-specific tests can live beside their components when useful. Tests for the demo application's feature belong with that app under `demo/app/` once selected.

The packaged extension also needs a manual walkthrough covering source navigation, cancellation, revised approaches, failed checks, and Droid startup. Choose a test runner with the implementation tooling; this scaffold does not select one.
