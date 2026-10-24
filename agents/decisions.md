# Decisions and open questions

## Status vocabulary

- **User request:** explicitly requested in the conversation.
- **Working recommendation:** proposed direction suitable for implementation planning; change when evidence warrants it.
- **Open:** not settled or validated.

## Current record

| Topic | Status | Direction and reason |
| --- | --- | --- |
| Shared agent-readable context | User request | Root `AGENTS.md` points to a Markdown-only `agents/` tree |
| Project folder scaffold | User request; created | Extension host under `src/`, React under `webview/src/`, plus `demo/` and `tests/`; directory README files define ownership |
| Package organization | Working recommendation | One root package initially; shared contracts in `src/shared/` avoid weekend monorepo overhead |
| Application specification | User request; drafted | [Implementation contract](implementation/application-spec.md) defines proposed MVP behavior and acceptance criteria; integration remains unvalidated |
| Product purpose | User-provided concept | Improve developer comprehension while an agent generates code |
| Main interaction | Working recommendation | Persistent source-linked graph plus conceptual steps |
| Editor platform | Working recommendation | VS Code extension; no core-editor requirement identified |
| Coding engine | Working recommendation following user interest | Factory Droid SDK replaces the earlier direct Claude SDK suggestion |
| UI stack | Working recommendation | TypeScript, React, Vite, React Flow |
| Edit ownership | Working recommendation | Droid proposes; extension validates, previews, and applies |
| Infrastructure | Working recommendation | Local-first MVP without a separate backend or database service |
| Patch size | Working recommendation | Small coherent concepts; 10–50 lines is a heuristic |
| Invariant presentation | Working recommendation | Claims tied to source and evidence with explicit verification state |
| Publishing | Open | Local VSIX is enough for a demo; no publication requested |
| Demo fixture | User decision (Oct 24) | API caching on a small weather endpoint in `demo/app/`; clearest hit/miss data flow and a simple schema invariant |
| Fixture stack | User decision (Oct 24) | TypeScript + Express + Vitest, so the team uses one toolchain; a Zod response schema backs the "cached and uncached responses share a schema" invariant |
| Build tooling | Working recommendation; implemented in MVP step 1 | esbuild bundles the host to `dist/`, Vite bundles the webview to `webview/dist/`, Vitest runs `tests/`; exact versions pinned in `package.json` |
| Agent during development | Working recommendation; implemented in MVP step 1 | A deterministic fake adapter (`src/agent/fakeAdapter.ts`) serves the caching fixture until the real Droid adapter passes the proposal-only gate; the `humanCenteredAgent.useFakeAgent` setting defaults to true |
| Step loop | Working recommendation; implemented in MVP step 2 | `SessionController` drives propose → preview → apply → checks → next step against a `WorkspacePort`; the VS Code port applies one `WorkspaceEdit` per step, saves only touched files, and verifies the written content. Outside edits retire a pending proposal and mark references and evidence stale |
| Testing without VS Code | Working recommendation | VS Code cannot be downloaded in the cloud build sandbox, so the full loop is covered by Vitest on a copy of `demo/app` and by a stubbed-API smoke run of the bundled extension; real-editor testing happens on a teammate's machine from the `.vsix` |

## Questions to resolve before or during implementation

1. Resolved: caching in `demo/app/`, TypeScript + Express + Vitest (see the record above).
2. Who has Factory account access, what models are available, and what are the budget and authentication constraints?
3. Which compatible SDK/CLI versions will be pinned, and can their tool configuration enforce proposal-only operation?
4. Validate the specification's proposed full-content edit schema and separate step-dependency/data-flow graphs during implementation.
5. MVP default: collapse explanation is presentation-only; Flow mode and quizzes are deferred.
6. MVP default: pause on failed checks; preserve applied code and reconcile partial edits before retry. Validate recovery in editor integration tests.
7. MVP default: hash/symbol-based source references and conservative evidence invalidation on source changes. Validate usability on the fixture.
8. MVP default: workspace extension storage for runtime state and a save dialog for Markdown exports.
9. MVP default: desktop/local only, one selected workspace root; remote/browser execution deferred.
10. What simple user evaluation will demonstrate improved understanding?

## Updating this record

When a choice changes, record the concrete reason and update the corresponding design document. Distinguish a tested integration from a documentation-based expectation. Do not silently turn recommendations into user requirements.
