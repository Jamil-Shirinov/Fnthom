# Shared contracts

Put portable TypeScript types and runtime schemas here: concept nodes/edges, source references, proposals, check evidence, session state, and host/webview messages.

Begin with `schema.ts`; split into `messages.ts` and domain-specific modules only when helpful. Both the extension and webview can import these contracts.

Do not import `vscode`, Node filesystem APIs, Droid runtime code, or React here. Keep credentials out of every message sent to the webview. Document source line-number conventions explicitly.

See [the proposed concept schema](../../agents/architecture.md).
