# Building the VS Code extension

## Scaffold and development

The official generator can create a TypeScript extension:

```bash
npx --package yo --package generator-code yo code
```

Choose **New Extension (TypeScript)**. Open the generated project in VS Code and use **F5** to launch the Extension Development Host. Follow the current [official starter guide](https://code.visualstudio.com/api/get-started/your-first-extension).

Build the webview's React assets with Vite and load the bundled local assets into a webview panel. Use VS Code theme colors, constrained resource access, and an appropriate content security policy. Validate messages crossing the webview boundary. Keep secrets and file operations in the extension host.

## Source layout

The repository now has the following folder scaffold outside the documentation directory. File names below are intended implementation locations; executable code is not yet present:

```text
src/
  extension.ts
  panel.ts
  agent/
    planner.ts
    stepGenerator.ts
    session.ts
  workspace/
    context.ts
    edits.ts
    sourceLinks.ts
  shared/
    schema.ts
webview/
  src/
    App.tsx
    components/
      ArchitectureGraph.tsx
      StepPanel.tsx
demo/
tests/
```

Use one root package initially. Keep shared contracts in `src/shared/` instead of introducing a separate package. See the [root README](../../README.md) and directory README files for ownership. Build output belongs in `dist/` and `webview/dist/`.

## API mapping

| Behavior | VS Code API |
| --- | --- |
| Open custom interface | `window.createWebviewPanel` |
| Discover/read files | `workspace.findFiles`, `workspace.fs` |
| Native proposed-change preview | Virtual documents and `vscode.diff` |
| Apply conceptual edits | `WorkspaceEdit`, `workspace.applyEdit` |
| Navigate from node to source | `window.showTextDocument`, editor `revealRange` |
| Highlight implementation | `TextEditorDecorationType` |
| Store credentials | `ExtensionContext.secrets` |

See the [API reference](https://code.visualstudio.com/api/references/vscode-api) and [webview guide](https://code.visualstudio.com/api/extension-guides/webview).

Use editor document contents when unsaved changes matter. A disk-only read can produce a proposal against stale content.

## Interface

The initial layout can be a webview panel beside a native code editor or diff. Display the feature intent, interactive graph, active step explanation, source links, and continuation controls. A sidebar integration can be evaluated later if useful; a custom core editor layout is not required for the MVP.

Clicking a graph node should reveal real source when implementation exists. Planned nodes should show intended responsibility and files without pretending they already have code.

## Packaging

```bash
npx @vscode/vsce package
```

The resulting `.vsix` can be installed directly by teammates and judges. Verify that webview assets and runtime dependencies are included and that Droid executable discovery and authentication work on the target machine. Marketplace publication is optional and requires a separate release decision.

Reference: [Publishing and packaging extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
