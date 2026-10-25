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

How it works: describe a feature, and the agent proposes it one function at a time. Inspect source references, accept or rework each function, or ask a follow-up question without changing the plan. The extension checks that quoted references match the planning context, but treats them as context rather than proof. Accepted functions appear in the graph as planned nodes. Once planning is complete, the extension writes the code, runs the project's tests, and shows how functions connect. Click a function to see its purpose and jump to its highlighted code. The scripted fake agent knows the caching demo in `demo/app`; the Factory Droid adapter is available for configured sessions (see [application-spec.md](agents/implementation/application-spec.md)).

## Try it in VS Code

You need VS Code 1.90 or later and Node.js 20 or later.

```bash
npm install && npm run package          # writes human-centered-agent-0.2.1.vsix
code --install-extension human-centered-agent-0.2.1.vsix
cd demo/app && npm install              # the demo's tests are the check the extension runs
code .
```

Then run **Human-Centered Agent: Open Panel** from the Command Palette and follow [the walkthrough](demo/walkthrough.md). The extension edits files in `demo/app`; run `npm run demo:reset` from the repository root to start over.

## Develop

```bash
npm install
npm run build        # host bundle to dist/, webview to webview/dist/
npm test             # Vitest: controller, function graph, fake agent, protocol
npm run typecheck
npm run check:offline # full local reliability check: tests + build
npm run dev:webview  # the UI in a browser with the scripted agent, no VS Code needed (add ?large for a big graph)
npm run preview:fixture  # regenerate the graphs the browser preview shows
npm run package      # builds, then writes an installable .vsix
```

### Offline validation and Factory setup

The extension remains usable without a Factory API key because it falls back to the deterministic fake agent. That makes it easy to keep improving the extension while the team is waiting on account access.

For a Windows shell:

```powershell
$env:FACTORY_API_KEY = "your-key-here"
```

Or, in VS Code, run **Human-Centered Agent: Set Factory API Key** from the Command Palette. The extension reads the key from secret storage first, then from `FACTORY_API_KEY`.

Press F5 in VS Code to open an Extension Development Host on `demo/app`, then run **Human-Centered Agent: Open Panel** from the Command Palette. The fake agent is on by default (`humanCenteredAgent.useFakeAgent`).

## Start here

- Agents and teammates: read [AGENTS.md](AGENTS.md), then [the documentation index](agents/README.md).
- Build order and demo acceptance: [MVP roadmap](agents/mvp.md).
- Application code contract: [implementation specification](agents/implementation/application-spec.md).
- Architecture and boundaries: [architecture](agents/architecture.md).
- Unresolved choices: [decision record](agents/decisions.md).

Keep generated output, credentials, and runtime session data out of source control. The planned output locations are `dist/` for the extension bundle and `webview/dist/` for UI assets.
