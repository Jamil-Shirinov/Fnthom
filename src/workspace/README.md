# Repository and editor integration

- `port.ts`: what the controller needs from the editor and file system, so the controller can be tested without VS Code.
- `vscodeWorkspace.ts`: the VS Code implementation: source discovery, snapshots that prefer unsaved buffers, one `WorkspaceEdit` per implementation, saves of touched files only.
- `edits.ts`: validation of generated file changes against fresh snapshots.
- `codeGraph.ts`: the function graph from source with the TypeScript compiler API.
- `preview.ts`: read-only before/after documents for diffs.
- `checks.ts`: configured check processes with timeouts, cancellation and bounded output.

Keep agent prompts in `src/agent/` and portable schemas in `src/shared/`.
