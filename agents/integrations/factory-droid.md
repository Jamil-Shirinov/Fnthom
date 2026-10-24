# Factory Droid SDK integration

## Recommendation

Use Factory Droid SDK as the coding engine behind the VS Code extension. This replaces the original direct Claude SDK recommendation while keeping React Flow, the extension UI, and the conceptual-step controller.

Factory's official documentation describes persistent sessions, streaming messages, structured JSON output, tool controls, permission handlers, and SDK-backed MCP tools. These are useful integration points; none automatically implements the product's comprehension workflow.

## Setup assumptions to verify

```bash
npm install @factory/droid-sdk
```

Import Node APIs from `@factory/droid-sdk/node`. The documentation specifies Node.js 18+, a `droid` CLI executable discoverable through `PATH` or an explicit executable path, and Factory authentication. An API key can be supplied through `FACTORY_API_KEY` or SDK options. Do not commit an actual key.

The SDK documentation specifies Zod 3 when using its Zod-based helpers/tools. Pin and test compatible SDK, CLI, and schema-library versions. Validate the actual extension host runtime and executable discovery on demo machines.

## Relevant API surface

| Capability | Documented API |
| --- | --- |
| One-shot request | `run()` |
| Conversation with shared context | `createSession()` |
| Resume saved conversation | `resumeSession()` |
| Stream a turn | `session.stream()` |
| Available models | `listModels()` |
| Available tools | `session.listTools()` |
| Disable tools | `disabledToolIds` |
| Update session options | `session.updateSettings()` |
| Cancel active work | `session.interrupt()` or abort signals |
| Release resources | `session.close()` |
| Structured response | `outputFormat` with JSON Schema |
| Custom TypeScript tools | `tool()` and `createSdkMcpServer()` |

These names describe the reviewed documentation, not a frozen contract. Check installed declarations and official docs before implementation. Handle failed results, missing structured output, and runtime validation explicitly.

## Recommended orchestration

1. Inspect relevant repository context and return a structured implementation map.
2. Render the map before requesting code changes.
3. Request one conceptual step with proposed edits and supporting explanation.
4. Validate source versions and preview the diff in VS Code.
5. Apply via the extension's edit controller.
6. Run authorized, relevant checks and report actual resulting code and evidence back to Droid.
7. Request the next step only when the product controller advances.

Maintain context through a session, with one active stream at a time. Close sessions when their owner is disposed. Restored sessions may require runtime handlers and MCP servers to be reattached.

## Tool boundary

For proposal generation, discover the available tools and disable all mutation, execution, or delegation paths that could bypass extension-controlled edits. Do not assume that disabling a tool named `Edit` alone covers all ways to change files. Inspect configured MCP tools and other capabilities as well.

The documented public SDK exposes a subtractive disabled-tool list, not a restrictive allowlist. Permission handlers can approve or reject requests that reach the client; autonomy settings affect which requests require approval. Do not assume every action will reach a handler under every setting.

If reliable proposal-only behavior cannot be established, revisit the architecture before connecting the agent to the user's working files. A separate disposable workspace is a possible fallback to evaluate, not an agreed MVP requirement.

Custom tools could later publish graph updates or submit conceptual proposals. Such tool names and payloads would be your own design, not built-in Droid features.

## First integration experiment

Before building the full agent loop, prove that the extension host can:

1. Start an authenticated session for a small demo repository.
2. Obtain and validate a structured plan.
3. Obtain one patch proposal without changing the repository.
4. Surface useful streamed activity in the UI.
5. Apply the proposal through VS Code and supply the result on a subsequent turn.
6. Cancel and dispose cleanly.

The graph, conceptual granularity, explanations, and evidence links remain application responsibilities. Account access, costs, model availability, and distribution/onboarding details remain to be confirmed.

Primary reference: [Factory Droid TypeScript SDK](https://docs.factory.com/sdk/typescript).
