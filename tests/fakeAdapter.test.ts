import { describe, expect, it } from "vitest";
import { FakeAgentAdapter } from "../src/agent/fakeAdapter";
import { contentHash } from "../src/workspace/hash";

const options = () => ({ operationId: "op", signal: new AbortController().signal, onActivity: () => {} });

describe("FakeAgentAdapter", () => {
  const agent = new FakeAgentAdapter({ delayMs: 0 });

  it("returns a valid plan carrying the requested intent", async () => {
    const plan = await agent.inspectAndPlan({ intent: "Cache it", context: [] }, options());
    expect(plan.intent).toBe("Cache it");
    expect(plan.steps.map((s) => s.id)).toEqual(["s-cache-module", "s-use-cache", "s-prove-schema"]);
  });

  it("proposes updates against the snapshot it was given", async () => {
    const plan = await agent.inspectAndPlan({ intent: "Cache it", context: [] }, options());
    const content = "export {};\n";
    const proposal = await agent.proposeStep(
      { plan, stepId: "s-use-cache", context: [{ path: "src/app.ts", exists: true, content, contentHash: contentHash(content) }] },
      options(),
    );
    const update = proposal.files.find((f) => f.kind === "update");
    expect(update && update.kind === "update" && update.baseHash).toBe(contentHash(content));
  });

  it("stops when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new FakeAgentAdapter({ delayMs: 0 }).inspectAndPlan(
        { intent: "x", context: [] },
        { operationId: "op", signal: controller.signal, onActivity: () => {} },
      ),
    ).rejects.toThrow(/cancelled/);
  });
});
