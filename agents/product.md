# Product concept

## Problem and thesis

Coding agents can generate changes faster than developers can build an understanding of them. Developers often inspect a large diff after the implementation is complete, without having formed a useful model of the system.

The product should transfer an inspectable implementation model to the developer while code is being generated. "Mental model" means a user-facing representation of architecture, behavior, assumptions, and evidence; it does not mean exposing a model's private chain of thought.

Target workflow (user direction, Oct 24):

```text
Prompt → Plan one function → Accept or reject → … → Implement → Function graph linked to code
```

## Three synchronized layers

1. **Intent:** What the developer wants to accomplish.
2. **Mental model:** Components, data flow, responsibilities, dependencies, and invariants.
3. **Implementation:** The code associated with the current concept, linked back to the map.

For example, "Add caching so repeated API calls do not hit the upstream model" becomes:

```text
User request → API endpoint → Cache lookup
                              ├─ hit → Response
                              └─ miss → Upstream API → Cache write → Response
```

Selecting "Cache lookup" should navigate to its implementation. The current node lights up as its code is proposed. Planned nodes must be distinguishable from code that actually exists.

## Intended interaction

1. Developer requests a feature.
2. Agent reads relevant repository context.
3. Agent proposes the first function or module: what it is for, how it works, its signature and file, and what it calls and is called by. Upcoming functions are listed so the developer sees where the plan is going.
4. Developer accepts or rejects it. A rejection, optionally with a reason, makes the agent propose a replacement and rework the upcoming functions to account for it.
5. Planning continues one function at a time until the agent reports the plan complete. No code is written before this point.
6. The extension implements every accepted function, runs the configured checks, and shows a graph of how the project's functions now connect, with new and changed functions marked.
7. Clicking a node shows a small pop-up with the function's purpose and opens its code in an editor tab with the responsible lines highlighted.
8. The product exports a concise reference: decisions, rejected designs, the graph, and check results.

Planning decisions are about meaningful units (functions and modules), not tiny edits, so accepting each one stays fast.

## Invariants as a differentiator

Useful explanations describe properties developers can reason about:

- Authentication: every `/admin` route requires successful authentication before execution.
- Caching: cached and uncached responses have the same schema.
- React: `Dashboard` owns `selectedProjectId`; `ProjectPanel` receives it through props.

Link each claim to source and, where possible, a relevant check. A diagram that inaccurately says "middleware protects every route" can increase false confidence. The product must make claims inspectable and distinguish intended behavior from supported behavior.

## Optional learning features

Prediction checkpoints can occasionally ask the developer to anticipate the next architectural step. For example, after authenticated-user storage is implemented, ask which layer should enforce authorization and explain the answer in the actual application's context.

Keep these optional. Potential modes:

- **Understand mode:** conceptual checkpoints and optional prediction questions.
- **Flow mode:** fewer interruptions while retaining the architecture map.

The exact pacing and controls are unresolved.

## Positioning hypotheses

The original concept contrasts this product with HumanLayer's approval/control emphasis, Kiro's specification emphasis, and the generation/review emphasis associated with Cursor, Claude Code, and Copilot-style agents. These products evolve; verify current capabilities before presenting comparative claims externally.

The intended differentiation is concept-level generation plus a persistent visual model linked directly to code. The underlying coding model need not be novel; orchestration and interaction design are the innovation.

## Avoid

- Character-by-character generation and artificial waiting.
- A product dominated by approvals for tiny edits.
- Generic explanations detached from source.
- Automatic comments everywhere.
- Documentation generation as the main experience.
- A polished map that conceals missing implementation or unsupported claims.

## Pitch material

Problem: "Coding agents optimize for code generation velocity, but human understanding does not scale at the same rate."

Solution: let the developer shape the implementation one function at a time before code exists, then show the result as a function graph linked directly to source.

Original one-line positioning: "Cursor helps you write less code. We help you understand the code AI writes."

Treat this as draft positioning, subject to competitive verification and team revision.
