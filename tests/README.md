# Focused verification

Vitest runs everything here (`npm test`):

- `controller.test.ts`: the planning loop, rework after rejection, guards, cancellation, implementation on a copy of `demo/app` with its real tests, unsaved and stale files, partial writes, failed checks, and graph rebuilds.
- `codeGraph.test.ts`: graph nodes and edges for the demo and for imports, aliases, classes and JSX; new/changed marking and purpose precedence.
- `workspace.test.ts`: validation of generated changes and the check runner.
- `fakeAdapter.test.ts`, `messages.test.ts` and `export.test.ts`: the scripted agent, the protocol, and the Markdown export.

`helpers/nodeWorkspace.ts` implements the workspace port over a plain directory. Editor behavior (tabs, highlights, diffs) still needs the manual walkthrough in `demo/walkthrough.md`.
