import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, UiAction } from "../src/shared/messages";

describe("UI action protocol", () => {
  it("accepts a well-formed startFeature", () => {
    const result = UiAction.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: "r1",
      type: "startFeature",
      payload: { sessionId: "s1", expectedRevision: 0, intent: "Add caching", useSelection: false },
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
        type: "previewFile",
        payload: { sessionId: "s1", expectedRevision: 0, proposalId: "p", path: "../secrets.env" },
      }).success,
    ).toBe(false);
  });
});
