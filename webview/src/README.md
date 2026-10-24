# React webview

Put the React entry point, application shell, styles, UI state, and typed messaging bridge here. Expected starting files are `main.tsx`, `App.tsx`, and `vscode.ts`.

Use [components/](components/README.md) for the graph and step interface. Import shared contracts from `../../src/shared/` through a build alias once configured.

Render host-owned session state. Send actions to the extension host; do not call Droid, access workspace files, or receive API keys directly. Use VS Code theme tokens and make planned, applied, and checked states visually distinct.

UI build assets should go to `webview/dist/`. Build configuration belongs at `webview/vite.config.ts` or in the root tooling setup once implemented.
