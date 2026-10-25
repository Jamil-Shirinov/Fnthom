# Human-centered coding agent: shared context

This documentation makes the hackathon idea usable by teammates and their coding agents without requiring the original conversation or the file in the author's Downloads directory.

## Read by task

| Document | Purpose |
| --- | --- |
| [Product](product.md) | Problem, interaction design, differentiation, examples, and pitch |
| [Architecture](architecture.md) | System boundaries, the planning loop, edit safety, and how the function graph is grounded in source |
| [Stack](stack.md) | Working technology choices and deliberately deferred infrastructure |
| [Application specification](implementation/application-spec.md) | MVP implementation contract, schemas, state machine, module boundaries, and acceptance criteria |
| [Droid integration](integrations/factory-droid.md) | SDK capabilities, integration strategy, constraints, and first experiment |
| [VS Code extension](implementation/vscode-extension.md) | Extension setup, UI, APIs, edit handling, and packaging |
| [VS Code fork](implementation/vscode-fork.md) | Alternative path and when it would be justified |
| [MVP roadmap](mvp.md) | Priorities, demo, build sequence, and verification |
| [Decisions and open questions](decisions.md) | What is agreed, recommended, or unresolved |
| [Sources](sources.md) | Original concept provenance and official technical references |

## How to collaborate through an agent

Ask your agent to read `AGENTS.md` and this index, then give it a concrete task. Examples:

- "Read the product and architecture documents; critique the proposed comprehension workflow."
- "Read the Droid integration document; validate its API assumptions against our installed versions."
- "Implement the first milestone in the MVP roadmap and update the decisions document with any tradeoffs."
- "Review whether graph source references remain accurate after manual code changes."

These are suggested prompts, not standing authorization to implement anything.

## Status and scope

The MVP is implemented with a scripted fake agent: planning one function at a time with Accept/Reject and rework, implementation, checks, the function graph with pop-ups and highlighted navigation, export, and VSIX packaging. The real Factory Droid adapter is next. The interaction model changed on Oct 24 at the user's direction; see [the decision record](decisions.md).

The original concept supplied by the user is summarized in [product.md](product.md). Technical recommendations from the discussion are recorded separately. External product comparisons are positioning hypotheses rather than a current competitive audit.

## Offline-ready follow-up while waiting on a Factory key

Until the live key is available, the most useful work is to keep the extension hardened and ready for the real session:

1. Keep the fake-agent path a reliable, fully tested fallback.
2. Validate offline checks through `npm run check:offline` before each demo handoff.
3. Make the missing-key UX explicit so contributors know how to set `FACTORY_API_KEY` or use the command palette option.
4. Keep the live integration checklist in [factory-droid.md](integrations/factory-droid.md) ready for the first authenticated smoke test.
5. Treat the real adapter as a replacement for the fake backend, not as a product redesign.
