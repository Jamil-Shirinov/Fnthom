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
| Main interaction | User direction (Oct 24) | Plan one function at a time with Accept/Reject; a rejection makes the agent rework the remaining plan; implement everything after planning; then show a function graph from the actual code, where clicking a node shows its purpose and highlights its code. Replaces the earlier concept map with one applied step at a time, which the user found was not the intended concept after testing it |
| Editor platform | Working recommendation | VS Code extension; no core-editor requirement identified |
| Coding engine | Working recommendation following user interest | Factory Droid SDK replaces the earlier direct Claude SDK suggestion |
| UI stack | Working recommendation | TypeScript, React, Vite, React Flow |
| Edit ownership | Working recommendation | Droid proposes; extension validates, previews, and applies |
| Infrastructure | Working recommendation | Local-first MVP without a separate backend or database service |
| Decision size | Working recommendation | One decision per function or module, so planning stays fast and each decision is meaningful |
| Function graph | Working recommendation; implemented | Built from source with the TypeScript compiler API: functions, methods, Express routes and entry modules; direct calls, calls through an interface (dashed, linked to every function returning that interface), and route registrations. New/changed is found by comparing declaration hashes with the pre-implementation graph. Limited to TypeScript and JavaScript |
| Proposal follow-up questions | User direction (Oct 24); implemented | Ask beside Accept/Rework; the agent answers using the active proposal and repository context without revising the proposal or plan. Follow-up exchanges stay in in-memory session state and are scoped to their proposal |
| Proposal evidence trail | User direction (Oct 24); implemented | Optional source excerpts cite workspace-relative paths and line ranges with a rationale. The extension checks exact quote text against planning context; the UI makes the excerpt clickable and clearly says this context is not proof |
| Verification presentation | Working recommendation | Check results are shown beside the graph with their output; they are not presented as proof of every edge. The earlier per-claim invariant badges were dropped with the concept map |
| Publishing | Open | Local VSIX is enough for a demo; no publication requested |
| Demo fixture | User decision (Oct 24) | API caching on a small weather endpoint in `demo/app/`; clearest hit/miss data flow and a simple schema invariant |
| Fixture stack | User decision (Oct 24) | TypeScript + Express + Vitest, so the team uses one toolchain; a Zod response schema backs the "cached and uncached responses share a schema" invariant |
| Build tooling | Working recommendation; implemented in MVP step 1 | esbuild bundles the host to `dist/`, Vite bundles the webview to `webview/dist/`, Vitest runs `tests/`; exact versions pinned in `package.json` |
| Agent during development | Working recommendation; implemented in MVP step 1 | A deterministic fake adapter (`src/agent/fakeAdapter.ts`) serves the caching fixture until the real Droid adapter passes the proposal-only gate; the `humanCenteredAgent.useFakeAgent` setting defaults to true |
| Step loop | Superseded (Oct 24) | The propose → preview → apply → check loop per step was replaced by planning first and implementing once; its edit validation, check runner and VS Code edit handling were kept |
| Testing without VS Code | Working recommendation | VS Code cannot be downloaded in the cloud build sandbox, so the full loop is covered by Vitest on a copy of `demo/app` and by a stubbed-API smoke run of the bundled extension; real-editor testing happens on a teammate's machine from the `.vsix` |

## Questions to resolve before or during implementation

1. Resolved: caching in `demo/app/`, TypeScript + Express + Vitest (see the record above).
2. Who has Factory account access, what models are available, and what are the budget and authentication constraints?
3. Which compatible SDK/CLI versions will be pinned, and can their tool configuration enforce proposal-only operation?
4. Validate the specification's proposed full-content edit schema and separate step-dependency/data-flow graphs during implementation.
5. MVP default: failed checks do not block the graph; applied code is kept and checks can be rerun. Partial writes are reported and never replayed.
6. MVP default: graph nodes are re-resolved from source on every save, instead of storing line ranges.
7. Open: should the developer be able to edit a proposal directly instead of only accepting or rejecting?
8. MVP default: state is in memory only; a save dialog writes Markdown exports. Persistence across reloads is deferred.
9. MVP default: desktop/local only, one selected workspace root; remote/browser execution deferred.
10. What simple user evaluation will demonstrate improved understanding?

## Updating this record

When a choice changes, record the concrete reason and update the corresponding design document. Distinguish a tested integration from a documentation-based expectation. Do not silently turn recommendations into user requirements.
