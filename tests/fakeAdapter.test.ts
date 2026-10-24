import { describe, expect, it } from "vitest";
import { FakeAgentAdapter } from "../src/agent/fakeAdapter";
import type { PlannedFunction } from "../src/shared/schema";
import { contentHash } from "../src/workspace/hash";

const options = () => ({ operationId: "op", signal: new AbortController().signal, onActivity: () => {} });
const appTs = "export {};\n";
const context = [{ path: "src/app.ts", exists: true, content: appTs, contentHash: contentHash(appTs) }];

describe("FakeAgentAdapter", () => {
  const agent = new FakeAgentAdapter({ delayMs: 0 });

  it("proposes the first function and outlines the rest", async () => {
    const turn = await agent.planNext({ intent: "Cache it", context, history: [], lastDecision: null }, options());
    expect(turn.next?.name).toBe("createTtlCache");
    expect(turn.upcoming.map((u) => u.name)).toEqual(["cacheKey", "withCache", "createApp", "cache.test.ts"]);
  });

  it("reworks the proposal and the upcoming functions after a rejection", async () => {
    const first = await agent.planNext({ intent: "Cache it", context, history: [], lastDecision: null }, options());
    const rejected: PlannedFunction = { ...first.next!, status: "rejected", rejectionReason: "memory must be bounded" };
    const turn = await agent.planNext(
      { intent: "Cache it", context, history: [rejected], lastDecision: { functionId: rejected.id, decision: "rejected", reason: "memory must be bounded" } },
      options(),
    );
    expect(turn.next?.name).toBe("createLruCache");
    expect(turn.next?.replacesId).toBe(rejected.id);
    expect(turn.reworkNote).toMatch(/LRU/);
    expect(turn.reworkNote).toMatch(/memory must be bounded/);
    expect(turn.upcoming.find((u) => u.name === "createApp")?.summary).toMatch(/LRU/);
  });

  it("generates code for the chosen designs against the given snapshot", async () => {
    const history: PlannedFunction[] = [];
    let lastDecision = null as { functionId: string; decision: "accepted" | "rejected" } | null;
    // Reject the wrapper design once, accept everything else.
    for (let i = 0; i < 6; i++) {
      const turn = await agent.planNext({ intent: "Cache it", context, history, lastDecision }, options());
      if (!turn.next) break;
      const reject = turn.next.name === "withCache";
      history.push({ ...turn.next, status: reject ? "rejected" : "accepted" });
      lastDecision = { functionId: turn.next.id, decision: reject ? "rejected" : "accepted" };
    }
    const done = await agent.planNext({ intent: "Cache it", context, history, lastDecision }, options());
    expect(done.next).toBeNull();
    expect(history.filter((f) => f.status === "accepted").map((f) => f.name)).toEqual([
      "createTtlCache",
      "cacheKey",
      "GET /api/weather/:city",
      "createApp",
      "cache.test.ts",
    ]);

    const files = await agent.implement({ intent: "Cache it", functions: history, context }, options());
    expect(files.map((f) => f.path)).toEqual(["src/cache.ts", "src/app.ts", "test/cache.test.ts"]);
    const app = files.find((f) => f.path === "src/app.ts")!;
    expect(app.kind === "update" && app.baseHash).toBe(contentHash(appTs));
    expect(app.newContent).toContain("cache.get(key)");
  });

  it("refuses a workspace that is not the weather demo", async () => {
    await expect(agent.planNext({ intent: "x", context: [], history: [], lastDecision: null }, options())).rejects.toThrow(/weather demo/);
  });
});
