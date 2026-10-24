// Versioned host/webview protocol (application-spec.md, section 7).
// The host validates every incoming message and treats its own state snapshot as authoritative.

import { z } from "zod";
import { ApplicationState, WorkspacePath } from "./schema";

export const PROTOCOL_VERSION = 1;

const envelope = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string().min(1),
};

// Actions that change the session also carry the session and the state revision the UI saw,
// so the host can reject actions made against stale state.
const sessionGuard = {
  sessionId: z.string().min(1),
  expectedRevision: z.number().int().min(0),
};

const action = <T extends string, P extends z.ZodRawShape>(type: T, payload: P) =>
  z.object({ ...envelope, type: z.literal(type), payload: z.object(payload) });

export const UiAction = z.discriminatedUnion("type", [
  action("ready", {}),
  action("startFeature", { ...sessionGuard, intent: z.string().trim().min(1).max(4000) }),
  action("acceptFunction", { ...sessionGuard, functionId: z.string().min(1) }),
  action("rejectFunction", { ...sessionGuard, functionId: z.string().min(1), reason: z.string().trim().max(2000).optional() }),
  action("retry", { ...sessionGuard }),
  action("showGraph", { ...sessionGuard }),
  action("openNode", { nodeId: z.string().min(1) }),
  action("previewChange", { path: WorkspacePath }),
  action("rerunChecks", { ...sessionGuard }),
  action("cancel", { sessionId: z.string().min(1) }),
  action("export", {}),
  action("resetSession", { sessionId: z.string().min(1) }),
]);
export type UiAction = z.infer<typeof UiAction>;
export type UiActionType = UiAction["type"];

export const ActivityEvent = z.object({
  operationId: z.string(),
  kind: z.enum(["status", "tool", "text"]),
  message: z.string(),
  at: z.string(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

const hostMessage = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), type: z.literal(type), requestId: z.string().optional(), payload });

export const HostMessage = z.discriminatedUnion("type", [
  hostMessage("stateSnapshot", ApplicationState),
  hostMessage("activity", ActivityEvent),
  hostMessage("requestError", z.object({ message: z.string(), nextAction: z.string().optional() })),
  hostMessage("requestComplete", z.object({})),
]);
export type HostMessage = z.infer<typeof HostMessage>;
