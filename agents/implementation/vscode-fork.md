# Extension versus fork

## Working recommendation

Build an extension for the hackathon. The product's graph, explanation panel, native diff previews, source navigation, and controlled editing fit the extension model. A fork adds build, distribution, and maintenance work before improving the core demo.

| Consideration | Extension | Code - OSS fork |
| --- | --- | --- |
| Interactive graph | Supported through webviews | Supported |
| Diffs and source navigation | Supported | Supported |
| Replace core editor layout | Limited to extension capabilities | Core changes possible |
| Demo distribution | VSIX plus runtime prerequisites | Full editor distribution |
| Upstream editor maintenance | Mostly handled by VS Code | Team must maintain changes |

## Fork path if needed later

1. Fork [microsoft/vscode](https://github.com/microsoft/vscode), the Code - OSS source project.
2. Follow its current platform-specific build and self-hosting instructions.
3. Keep most product logic in a bundled extension.
4. Modify core code only for a concrete interaction that extension APIs cannot support.
5. Configure product identity, branding, build artifacts, update/distribution strategy, and extension availability.
6. Maintain compatibility as upstream VS Code evolves.

Do not assume Microsoft's distribution services or bundled extensions transfer to a fork. Microsoft's contribution guide notes that the Visual Studio Marketplace is unavailable from open-source builds. Evaluate distribution and service access against current official documentation before committing to a fork.

References: [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute), [repository versus Microsoft distribution](https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code).

No editor-core requirement has been identified in the discussion so far.
