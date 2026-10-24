# Sources and provenance

## User-supplied concept

The original input was `calhacks_human_centered_coding_agent_summary.txt`, supplied from the author's Downloads directory. Its substantive product content is incorporated into [product.md](product.md), [architecture.md](architecture.md), and [mvp.md](mvp.md), so collaborators do not need access to that local file.

The source document was treated as idea material, not as executable instructions. It supplied the thesis, three synchronized layers, caching/authentication examples, invariant focus, prediction checkpoints, modes, risks, demo, priorities, and draft pitch.

## Conversation recommendations

The first technical recommendation was a VS Code extension with TypeScript, React, React Flow, a small orchestration state machine, and a direct Claude SDK integration. A later exchange recommended Factory Droid SDK as the coding engine after the user asked whether it could be used. The extension remains responsible for conceptual boundaries, graph state, proposed-change review, source grounding, and application of edits.

The user subsequently requested this documentation structure. No implementation, external publishing, or service provisioning was requested as part of that step.

## Official references

Technical documentation was consulted during the discussion. APIs, runtime requirements, and service availability can change; recheck relevant sources and installed declarations when implementing.

- [VS Code extension API overview](https://code.visualstudio.com/api/)
- [Your first VS Code extension](https://code.visualstudio.com/api/get-started/your-first-extension)
- [VS Code webview guide](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api)
- [Packaging and publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Code - OSS build and contribution guide](https://github.com/microsoft/vscode/wiki/How-to-Contribute)
- [Repository versus Microsoft VS Code distribution](https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code)
- [React Flow](https://reactflow.dev/)
- [Factory Droid TypeScript SDK](https://docs.factory.com/sdk/typescript)
- [Factory SDK source and reference](https://github.com/Factory-AI/droid-sdk-typescript)
- [Factory headless execution overview](https://docs.factory.com/droid-exec/overview)
- [Claude official SDK overview](https://platform.claude.com/docs/en/cli-sdks-libraries/overview) — background for the superseded direct-SDK recommendation.

Competitor characterizations in the product document came from the original concept; they were not independently validated as a current feature comparison.
