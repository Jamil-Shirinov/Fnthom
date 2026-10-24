# Shared contracts

Portable runtime schemas and types used by both the extension host and the webview: planned functions and planning turns, file changes, the function graph, check results, session state (`schema.ts`), the host/webview protocol (`messages.ts`), and the Markdown export (`exportMarkdown.ts`).

Do not import `vscode`, Node APIs, Droid runtime code, or React here. Keep credentials out of every message sent to the webview. Serialized source lines are one-based and inclusive.
