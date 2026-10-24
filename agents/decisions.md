# Decisions and open questions

## Status vocabulary

- **User request:** explicitly requested in the conversation.
- **Working recommendation:** proposed direction suitable for implementation planning; change when evidence warrants it.
- **Open:** not settled or validated.

## Current record

| Topic | Status | Direction and reason |
| --- | --- | --- |
| Shared agent-readable context | User request | Root `AGENTS.md` points to a Markdown-only `agents/` tree |
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

## Questions to resolve before or during implementation

1. Which demo repository and feature will be used: caching, authentication, or another bounded example?
2. Who has Factory account access, what models are available, and what are the budget and authentication constraints?
3. Which compatible SDK/CLI versions will be pinned, and can their tool configuration enforce proposal-only operation?
4. What exact schema represents proposed edits, graph edges, source anchors, and check evidence?
5. How does "skip explanation" differ from "apply and continue"? What actions are automatic in Flow mode?
6. How should the system recover from failed checks or partially completed conceptual steps?
7. How are source references and invariant evidence invalidated after manual changes?
8. Where will runtime session data and exported architecture references live outside `agents/`?
9. Is the initial extension desktop-only, and are remote development environments in scope?
10. What simple user evaluation will demonstrate improved understanding?

## Updating this record

When a choice changes, record the concrete reason and update the corresponding design document. Distinguish a tested integration from a documentation-based expectation. Do not silently turn recommendations into user requirements.
