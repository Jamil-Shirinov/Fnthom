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
  action("startFeature", { ...sessionGuard, intent: z.string().trim().min(1).max(4000), useSelection: z.boolean() }),
  action("startStep", { ...sessionGuard, stepId: z.string().min(1) }),
  action("selectConcept", { conceptId: z.string().min(1).nullable() }),
  action("openSource", { conceptId: z.string().min(1), refIndex: z.number().int().min(0) }),
  action("previewFile", { ...sessionGuard, proposalId: z.string().min(1), path: WorkspacePath }),
  action("applyAndContinue", { ...sessionGuard, proposalId: z.string().min(1) }),
  action("askQuestion", { ...sessionGuard, question: z.string().trim().min(1).max(4000) }),
  action("reviseApproach", { ...sessionGuard, instruction: z.string().trim().min(1).max(4000) }),
  action("regenerateProposal", { ...sessionGuard, stepId: z.string().min(1) }),
  action("rerunChecks", { ...sessionGuard }),
  action("continueAfterFailure", { ...sessionGuard }),
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
  hostMessage("answer", z.object({ questionId: z.string(), answer: z.string() })),
  hostMessage("requestError", z.object({ message: z.string(), nextAction: z.string().optional() })),
  hostMessage("requestComplete", z.object({})),
]);
export type HostMessage = z.infer<typeof HostMessage>;
