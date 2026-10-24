# Product concept

## Problem and thesis

Coding agents can generate changes faster than developers can build an understanding of them. Developers often inspect a large diff after the implementation is complete, without having formed a useful model of the system.

The product should transfer an inspectable implementation model to the developer while code is being generated. "Mental model" means a user-facing representation of architecture, behavior, assumptions, and evidence; it does not mean exposing a model's private chain of thought.

Target workflow:

```text
Prompt → Mental model → Conceptual code step → Understand → Continue
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
3. Before edits, the interface shows components, files, data flow, and important assumptions.
4. Agent proposes one coherent conceptual patch.
5. The editor previews that patch; the panel explains why it exists, its inputs, outputs, and assumptions.
6. Developer can apply and continue, ask about the step, modify the approach, or skip its explanation.
7. The map updates as implementation progresses.
8. The product exports a concise permanent reference explaining the resulting feature.

"Skip explanation" and automatic continuation behavior need an explicit product decision; they must not silently imply permission to overwrite developer changes.

Aim for small patches, often around 10–50 changed lines, without enforcing an arbitrary line limit. A single concept can require coordinated edits across files.

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

Solution: show the implementation structure first, generate one conceptual unit at a time, and keep the map synchronized with source and evidence.

Original one-line positioning: "Cursor helps you write less code. We help you understand the code AI writes."

Treat this as draft positioning, subject to competitive verification and team revision.
