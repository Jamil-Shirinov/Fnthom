# Human-centered coding agent: shared context

This documentation makes the hackathon idea usable by teammates and their coding agents without requiring the original conversation or the file in the author's Downloads directory.

## Read by task

| Document | Purpose |
| --- | --- |
| [Product](product.md) | Problem, interaction design, differentiation, examples, and pitch |
| [Architecture](architecture.md) | System boundaries, state, conceptual steps, source grounding, and invariants |
| [Stack](stack.md) | Working technology choices and deliberately deferred infrastructure |
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

This is a design handoff. At the time of writing, no extension implementation has been established by this conversation. The user asked for stack advice, asked whether Factory Droid SDK could be used, and then requested this documentation. Building or publishing the product was not part of that documentation request.

The original concept supplied by the user is summarized in [product.md](product.md). Technical recommendations from the discussion are recorded separately. External product comparisons are positioning hypotheses rather than a current competitive audit.
