import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, UiAction } from "../src/shared/messages";

describe("UI action protocol", () => {
  it("accepts a well-formed startFeature", () => {
    const result = UiAction.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "r1",
      type: "startFeature",
      payload: { sessionId: "s1", expectedRevision: 0, intent: "Add caching" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown types, wrong protocol versions, and unsafe paths", () => {
    const base = { protocolVersion: PROTOCOL_VERSION, requestId: "r1" };
    expect(UiAction.safeParse({ ...base, type: "deleteEverything", payload: {} }).success).toBe(false);
    expect(UiAction.safeParse({ ...base, protocolVersion: 99, type: "ready", payload: {} }).success).toBe(false);
    expect(
      UiAction.safeParse({
        ...base,
        type: "previewChange",
        payload: { path: "../secrets.env" },
      }).success,
    ).toBe(false);
  });
});

describe("decision actions", () => {
  it("accepts a rejection with an optional reason", () => {
    const base = { protocolVersion: PROTOCOL_VERSION, requestId: "r1", type: "rejectFunction" as const };
    expect(UiAction.safeParse({ ...base, payload: { sessionId: "s1", expectedRevision: 3, functionId: "fn-1" } }).success).toBe(true);
    expect(UiAction.safeParse({ ...base, payload: { sessionId: "s1", expectedRevision: 3, functionId: "fn-1", reason: "too complex" } }).success).toBe(true);
    expect(UiAction.safeParse({ ...base, payload: { sessionId: "s1", expectedRevision: 3 } }).success).toBe(false);
  });
});
