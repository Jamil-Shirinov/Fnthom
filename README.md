# Human-centered coding agent

A CalHacks project that helps developers understand AI-generated code through an interactive architecture map and conceptual implementation steps.

Working stack: VS Code extension, TypeScript, React, React Flow, and Factory Droid SDK.

## Project structure

```text
.
├── AGENTS.md              # Entry point for coding agents
├── agents/                # Product and technical context; Markdown only
├── src/                   # VS Code extension host
│   ├── agent/             # Droid integration and conceptual-step controller
│   ├── workspace/         # Context, diffs, edits, navigation, and checks
│   └── shared/            # Host/webview message contracts and domain schemas
├── webview/
│   └── src/               # React UI and VS Code messaging bridge
│       └── components/    # Architecture graph and step explanation interface
├── demo/                  # Small target app and demo walkthrough
└── tests/                 # Focused integration and behavior tests
```

This is a folder scaffold; application code and build configuration have not been added yet. Directory README files describe ownership and where to begin. Use one root package for the extension and UI initially; separate source folders do not require a monorepo.

## Start here

- Agents and teammates: read [AGENTS.md](AGENTS.md), then [the documentation index](agents/README.md).
- Build order and demo acceptance: [MVP roadmap](agents/mvp.md).
- Application code contract: [implementation specification](agents/implementation/application-spec.md).
- Architecture and boundaries: [architecture](agents/architecture.md).
- Unresolved choices: [decision record](agents/decisions.md).

Keep generated output, credentials, and runtime session data out of source control. The planned output locations are `dist/` for the extension bundle and `webview/dist/` for UI assets.
