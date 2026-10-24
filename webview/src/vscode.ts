// Typed bridge to the extension host. The webview never sees credentials or touches files.
// Outside VS Code (npm run dev:webview) a mock host serves fixture state for UI work.

import { HostMessage, PROTOCOL_VERSION, type UiAction } from "../../src/shared/messages";
import { createMockHost } from "./mockHost";

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type UiActionInput = DistributiveOmit<UiAction, "protocolVersion" | "requestId">;

export type Bridge = {
  isPreview: boolean;
  send(action: UiActionInput): string;
  subscribe(handler: (message: HostMessage) => void): () => void;
};

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

let counter = 0;
const nextRequestId = () => `req-${Date.now().toString(36)}-${(counter += 1)}`;

export function createBridge(): Bridge {
  const handlers = new Set<(message: HostMessage) => void>();
  const deliver = (raw: unknown) => {
    const parsed = HostMessage.safeParse(raw);
    if (!parsed.success) {
      console.warn("Ignoring malformed host message", parsed.error.issues);
      return;
    }
    for (const handler of handlers) handler(parsed.data);
  };

  const inVsCode = typeof acquireVsCodeApi === "function";
  const api = inVsCode ? acquireVsCodeApi() : undefined;
  const post = api ? (message: unknown) => api.postMessage(message) : createMockHost(deliver);
  if (inVsCode) window.addEventListener("message", (event) => deliver(event.data));

  return {
    isPreview: !inVsCode,
    send(action) {
      const requestId = nextRequestId();
      post({ ...action, protocolVersion: PROTOCOL_VERSION, requestId });
      return requestId;
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
