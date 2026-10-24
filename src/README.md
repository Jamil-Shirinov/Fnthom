# Extension host

Put TypeScript code that runs inside VS Code here. Future entry points are `extension.ts` for activation/commands and `panel.ts` for webview creation and message routing.

- [agent/](agent/README.md): Droid sessions and conceptual-step orchestration.
- [workspace/](workspace/README.md): repository context, proposed edits, native editor integration, and verification.
- [shared/](shared/README.md): portable schemas and message contracts used by both host and UI.

The host owns authoritative application state, credentials, file access, and applying changes. The React interface receives serializable state and sends validated actions.
