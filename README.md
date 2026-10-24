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

MVP step 1 is in place: root tooling, shared schemas and plan validation, the host/webview protocol, a fake agent driven by the caching fixture, the panel with the React Flow map, and the demo app. Step proposals, applying edits, checks, persistence and the real Droid adapter come next (see [application-spec.md](agents/implementation/application-spec.md), section 14). Directory README files describe ownership.

## Develop

```bash
npm install
npm run build        # host bundle to dist/, webview to webview/dist/
npm test             # Vitest: schemas, controller, fake agent, protocol
npm run typecheck
npm run dev:webview  # the UI in a browser with fixture data, no VS Code needed
npm run package      # builds, then writes an installable .vsix
```

Press F5 in VS Code to open an Extension Development Host on `demo/app`, then run **Human-Centered Agent: Open Panel** from the Command Palette. The fake agent is on by default (`humanCenteredAgent.useFakeAgent`).

## Start here

- Agents and teammates: read [AGENTS.md](AGENTS.md), then [the documentation index](agents/README.md).
- Build order and demo acceptance: [MVP roadmap](agents/mvp.md).
- Application code contract: [implementation specification](agents/implementation/application-spec.md).
- Architecture and boundaries: [architecture](agents/architecture.md).
- Unresolved choices: [decision record](agents/decisions.md).

Keep generated output, credentials, and runtime session data out of source control. The planned output locations are `dist/` for the extension bundle and `webview/dist/` for UI assets.
