# Working stack

The initial advice proposed a direct Claude SDK integration. The later discussion recommended Factory Droid SDK as the agent engine instead. Do not add both paths to the MVP by default.

| Layer | Working choice | Rationale |
| --- | --- | --- |
| Editor integration | VS Code extension, TypeScript | Native files, navigation, diffs, decorations, and edits |
| Interface | React + Vite in a webview | Custom graph and explanation UI |
| Architecture graph | React Flow | Interactive nodes, edges, selection, and states |
| Coding engine | Factory Droid SDK, Node entry point | Repository tools, sessions, model interaction, and events |
| Product orchestration | Small TypeScript state machine | Explicit conceptual-step boundaries |
| Schema validation | Zod | Validate agent outputs and UI messages |
| Persistence | Local JSON and Markdown | Session state plus exportable architecture reference |
| Verification | Target repository tests and type checks | Evidence for the generated behavior |
| Distribution | `@vscode/vsce` | Installable VSIX for teammates and judges |

Factory's documentation currently specifies Zod 3 for its structured-output helpers or SDK MCP tools. Verify compatibility before choosing a version. Build-tool Node requirements can be stricter than Droid SDK's documented Node 18 minimum; choose a runtime supported by the complete toolchain and the target VS Code extension host.

## Boundaries

- Run the SDK in the extension host, not in the webview.
- Keep API credentials in VS Code secret storage; pass them to the SDK without exposing them to UI messages, logs, or repository files.
- Prefer a local desktop extension for the MVP. Browser-hosted VS Code cannot directly use the Node subprocess architecture; remote workspace behavior requires separate validation.
- Use the native editor for reviewing code. Use the webview for the map and learning experience.

## Deferred infrastructure

The MVP does not need a separate backend, database service, vector database, authentication service, or general-purpose agent framework. Start with selected files, project configuration, file discovery, relevant imports, and targeted reads. Expand context as needed.

Multi-provider support, sophisticated repository indexing, collaboration, and hosted execution should wait until the core workflow works.
