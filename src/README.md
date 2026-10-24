# Extension host

TypeScript code that runs inside VS Code. `extension.ts` handles activation, commands and file watching; `panel.ts` creates the webview, routes its messages, and opens and highlights a graph node's code.

- [agent/](agent/README.md): the agent interface, the scripted fake agent, and the session controller.
- [workspace/](workspace/README.md): source discovery, edit validation and application, the function graph, diffs, and checks.
- [shared/](shared/README.md): portable schemas and message contracts used by both host and UI.

The host owns authoritative application state, credentials, file access, and applying changes. The React interface receives serializable state and sends validated actions.
