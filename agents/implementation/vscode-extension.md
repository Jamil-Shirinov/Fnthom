# Building the VS Code extension

## Scaffold and development

The official generator can create a TypeScript extension:

```bash
npx --package yo --package generator-code yo code
```

Choose **New Extension (TypeScript)**. Open the generated project in VS Code and use **F5** to launch the Extension Development Host. Follow the current [official starter guide](https://code.visualstudio.com/api/get-started/your-first-extension).

Build the webview's React assets with Vite and load the bundled local assets into a webview panel. Use VS Code theme colors, constrained resource access, and an appropriate content security policy. Validate messages crossing the webview boundary. Keep secrets and file operations in the extension host.

## Source layout

```text
src/
  extension.ts            activation, commands, file watching
  panel.ts                webview, message routing, node navigation and highlight, diffs
  agent/                  adapter interface, fake agent and scenario, controller
  workspace/              port, VS Code implementation, edit validation, graph, previews, checks
  shared/                 schemas, protocol, Markdown export
webview/src/
  App.tsx, vscode.ts, mockHost.ts
  components/             PlanningView, FunctionGraph, ResultPanel
demo/app/                 weather API the demo extends
tests/                    controller, graph, fake agent, protocol
```

Use one root package. Keep shared contracts in `src/shared/`. Build output belongs in `dist/` and `webview/dist/`.

## API mapping

| Behavior | VS Code API |
| --- | --- |
| Open custom interface | `window.createWebviewPanel` |
| Discover/read files | `workspace.findFiles`, `workspace.fs` |
| Before/after diff of what changed | Virtual documents and `vscode.diff` |
| Apply generated code | `WorkspaceEdit`, `workspace.applyEdit` |
| Navigate from node to source | `window.showTextDocument` in a non-preview tab, editor `revealRange` |
| Highlight the node's code | `TextEditorDecorationType` with whole-line theme colors |
| Store credentials | `ExtensionContext.secrets` |

See the [API reference](https://code.visualstudio.com/api/references/vscode-api) and [webview guide](https://code.visualstudio.com/api/extension-guides/webview).

Use editor document contents when unsaved changes matter. A disk-only read can produce a proposal against stale content.

## Interface

A webview panel opens beside the editor. During planning it shows the current proposal with Accept and Reject; afterwards it shows the function graph and a side panel. Clicking a node shows a pop-up in the graph and opens the function in its own editor tab with its lines highlighted. A sidebar integration can be evaluated later.

## Packaging

```bash
npx @vscode/vsce package
```

The resulting `.vsix` can be installed directly by teammates and judges. Verify that webview assets and runtime dependencies are included and that Droid executable discovery and authentication work on the target machine. Marketplace publication is optional and requires a separate release decision.

Reference: [Publishing and packaging extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
