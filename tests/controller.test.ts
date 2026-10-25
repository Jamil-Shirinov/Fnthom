import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentCallOptions } from "../src/agent/adapter";
import { GuardError, SessionController } from "../src/agent/controller";
import { FakeAgentAdapter } from "../src/agent/fakeAdapter";
import type { ActivityEvent } from "../src/shared/messages";
import { CheckDefinition, type ApplicationState, type FileChange, type FileSnapshot, type PlannedFunction } from "../src/shared/schema";
import { NodeWorkspace } from "./helpers/nodeWorkspace";

const DEMO = path.resolve(__dirname, "../demo/app");

/** A fresh copy of the demo app's sources, sharing its installed node_modules. */
function demoCopy() {
  const dir = mkdtempSync(path.join(tmpdir(), "hca-demo-"));
  for (const entry of ["src", "test", "package.json", "tsconfig.json", "vitest.config.ts"]) {
    cpSync(path.join(DEMO, entry), path.join(dir, entry), { recursive: true });
  }
  cpSync(path.join(DEMO, "node_modules"), path.join(dir, "node_modules"), { recursive: true });
  return dir;
}

const node = (script: string) => CheckDefinition.parse({ id: "check", label: "check", executable: process.execPath, args: ["-e", script] });

function setup(checks: CheckDefinition[] = [], agent: FakeAgentAdapter = new FakeAgentAdapter({ delayMs: 0 })) {
  const workspace = new NodeWorkspace(demoCopy(), checks);
  const states: ApplicationState[] = [];
  const activity: ActivityEvent[] = [];
  const controller = new SessionController(agent, workspace, { onState: (s) => states.push(s), onActivity: (a) => activity.push(a) }, {
    sessionId: "s1",
    workspaceId: "file:///demo",
  });
  const guard = () => ({ sessionId: "s1", expectedRevision: controller.getState().stateRevision });
  const state = () => controller.getState();
  const proposal = () => state().plan!.functions.find((f) => f.status === "proposed")!;
  const read = (p: string) => readFileSync(path.join(workspace.root, p), "utf8");
  return { controller, workspace, states, activity, guard, state, proposal, read };
}

type Ctx = ReturnType<typeof setup>;

/** Accepts every proposal (rejecting the ones `reject` picks) until planning ends. */
async function decideAll(ctx: Ctx, reject: (f: PlannedFunction) => boolean = () => false) {
  for (let i = 0; i < 12 && ctx.state().phase === "reviewing"; i++) {
    const p = ctx.proposal();
    if (reject(p)) await ctx.controller.rejectFunction(p.id, "not this design", ctx.guard());
    else await ctx.controller.acceptFunction(p.id, ctx.guard());
  }
}

describe("planning one function at a time", () => {
  it("proposes a function, waits for a decision, and moves on when it is accepted", async () => {
    const ctx = setup();
    await ctx.controller.startFeature("Add caching", ctx.guard());
    expect(ctx.states.map((s) => s.phase).filter((p, i, all) => p !== all[i - 1])).toEqual(["idle", "planning", "reviewing"]);
    expect(ctx.proposal().name).toBe("createTtlCache");
    expect(ctx.state().plan!.upcoming).toHaveLength(4);
    expect(ctx.activity.length).toBeGreaterThan(0);
    expect(ctx.proposal().evidence?.[0]).toMatchObject({
      path: "src/upstream.ts",
      startLine: 7,
      endLine: 7,
      verified: true,
    });

    await ctx.controller.acceptFunction(ctx.proposal().id, ctx.guard());
    expect(ctx.state().plan!.functions.map((f) => `${f.name}:${f.status}`)).toEqual(["createTtlCache:accepted", "cacheKey:proposed"]);
    expect(ctx.state().plan!.upcoming).toHaveLength(3);
  });

  it("adds each accepted function to the graph before any code is written", async () => {
    const ctx = setup();
    await ctx.controller.startFeature("Add caching", ctx.guard());
    const ids = () => ctx.state().graph!.nodes.map((n) => n.id);
    expect(ids()).toContain("src/app.ts#createApp");
    expect(ctx.state().graph!.nodes.some((n) => n.planned)).toBe(false);

    await ctx.controller.acceptFunction(ctx.proposal().id, ctx.guard());
    const ttl = ctx.state().graph!.nodes.find((n) => n.id === "src/cache.ts#createTtlCache");
    expect(ttl).toMatchObject({ planned: true, status: "new", purposeSource: "plan" });
    expect(ctx.read("src/app.ts")).not.toMatch(/cache/i);

    await ctx.controller.acceptFunction(ctx.proposal().id, ctx.guard()); // cacheKey
    await ctx.controller.acceptFunction(ctx.proposal().id, ctx.guard()); // withCache
    const graph = ctx.state().graph!;
    const edge = (from: string, to: string) => graph.edges.find((e) => e.from === from && e.to === to);
    expect(edge("src/cachedUpstream.ts#withCache", "src/cache.ts#cacheKey")).toMatchObject({ kind: "call", planned: true });
    expect(edge("src/cachedUpstream.ts#withCache", "src/cache.ts#createTtlCache")).toMatchObject({ kind: "dispatch", planned: true });
    expect(edge("src/app.ts#createApp", "src/cachedUpstream.ts#withCache")).toMatchObject({ planned: true });

    await ctx.controller.acceptFunction(ctx.proposal().id, ctx.guard()); // createApp, an existing function
    expect(ctx.state().graph!.nodes.find((n) => n.id === "src/app.ts#createApp")).toMatchObject({ planned: true, status: "changed" });

    await decideAll(ctx);
    expect(ctx.state().phase).toBe("done");
    expect(ctx.state().graph!.nodes.some((n) => n.planned)).toBe(false);
    expect(ctx.state().graph!.nodes.find((n) => n.id === "src/cache.ts#createTtlCache")?.status).toBe("new");
  });

  it("answers follow-up questions without changing the proposal or plan", async () => {
    const ctx = setup();
    await ctx.controller.startFeature("Add caching", ctx.guard());
    const proposal = ctx.proposal();
    const plan = ctx.state().plan;

    await ctx.controller.askQuestion(proposal.id, "How does this handle memory?", ctx.guard());

    expect(ctx.state().phase).toBe("reviewing");
    expect(ctx.state().plan).toBe(plan);
    expect(ctx.state().followUps).toEqual([
      expect.objectContaining({
        proposalId: proposal.id,
        question: "How does this handle memory?",
        answer: expect.stringContaining(proposal.purpose),
      }),
    ]);
    await ctx.controller.acceptFunction(proposal.id, ctx.guard());
    expect(ctx.proposal().name).toBe("cacheKey");
  });

  it("takes the pending proposal's preview out of the editor when the user starts over or resets", async () => {
    const ctx = setup();
    const discarded: string[] = [];
    ctx.workspace.discardFunctionPreview = async (id: string) => void discarded.push(id);
    await ctx.controller.startFeature("Add caching", ctx.guard());
    const first = ctx.proposal().id;
    await ctx.controller.startFeature("Add caching", ctx.guard());
    expect(discarded).toEqual([first]);
    ctx.controller.reset();
    await Promise.resolve();
    expect(discarded).toEqual([first, first]);
  });

  it("reworks the remaining plan after a rejection and keeps the rejected design in the history", async () => {
    const ctx = setup();
    await ctx.controller.startFeature("Add caching", ctx.guard());
    const first = ctx.proposal();
    const phases: string[] = [];
    ctx.states.length = 0;
    await ctx.controller.rejectFunction(first.id, "memory must be bounded", ctx.guard());
    phases.push(...ctx.states.map((s) => s.phase));

    expect(phases).toContain("reworking");
    expect(ctx.state().phase).toBe("reviewing");
    const next = ctx.proposal();
    expect(next.name).toBe("createLruCache");
    expect(next.replacesId).toBe(first.id);
    expect(ctx.state().plan!.reworkNote).toMatch(/memory must be bounded/);
    expect(ctx.state().plan!.functions[0]).toMatchObject({ status: "rejected", rejectionReason: "memory must be bounded" });
    expect(ctx.state().plan!.upcoming.find((u) => u.name === "createApp")?.summary).toMatch(/LRU/);
  });

  it("rejects decisions on the wrong proposal, stale revisions, and other sessions", async () => {
    const ctx = setup();
    await ctx.controller.startFeature("Add caching", ctx.guard());
    await expect(ctx.controller.acceptFunction("fn-nope", ctx.guard())).rejects.toBeInstanceOf(GuardError);
    await expect(ctx.controller.acceptFunction(ctx.proposal().id, { sessionId: "s1", expectedRevision: 0 })).rejects.toBeInstanceOf(GuardError);
    await expect(ctx.controller.acceptFunction(ctx.proposal().id, { sessionId: "other", expectedRevision: ctx.state().stateRevision })).rejects.toBeInstanceOf(
      GuardError,
    );
    const id = ctx.proposal().id;
    await ctx.controller.acceptFunction(id, ctx.guard());
    await expect(ctx.controller.acceptFunction(id, ctx.guard())).rejects.toBeInstanceOf(GuardError);
  });

  it("can be cancelled and continued from the last decision", async () => {
    const ctx = setup([], new FakeAgentAdapter({ delayMs: 30 }));
    await ctx.controller.startFeature("Add caching", ctx.guard());
    const accepting = ctx.controller.acceptFunction(ctx.proposal().id, ctx.guard());
    ctx.controller.cancel({ sessionId: "s1" });
    await accepting;
    expect(ctx.state().phase).toBe("needsAttention");
    expect(ctx.state().error?.message).toMatch(/cancelled/);

    await ctx.controller.retry(ctx.guard());
    expect(ctx.state().phase).toBe("reviewing");
    expect(ctx.proposal().name).toBe("cacheKey");
  });

  it("reports malformed agent output and recovers on retry", async () => {
    class Flaky extends FakeAgentAdapter {
      broken = true;
      override async planNext(...args: Parameters<FakeAgentAdapter["planNext"]>) {
        const turn = await super.planNext(...args);
        if (!this.broken) return turn;
        this.broken = false;
        return { ...turn, next: { ...turn.next!, path: "../outside.ts" } };
      }
    }
    const ctx = setup([], new Flaky({ delayMs: 0 }));
    await ctx.controller.startFeature("Add caching", ctx.guard());
    expect(ctx.state().phase).toBe("needsAttention");
    expect(ctx.state().error?.stage).toBe("invalid-output");
    expect(ctx.state().plan).toBeNull();

    await ctx.controller.retry(ctx.guard());
    expect(ctx.state().phase).toBe("reviewing");
  });
});

describe("implementing after the last decision", () => {
  it(
    "writes every accepted function, runs the demo's tests, and graphs the result",
    async () => {
      const demoTests = CheckDefinition.parse({
        id: "demo-tests",
        label: "Weather API tests",
        executable: process.execPath,
        args: [path.join(DEMO, "node_modules/vitest/vitest.mjs"), "run"],
        timeoutMs: 60_000,
      });
      const ctx = setup([demoTests]);
      await ctx.controller.startFeature("Add caching", ctx.guard());
      await decideAll(ctx);

      const s = ctx.state();
      expect(s.error).toBeNull();
      expect(s.phase).toBe("done");
      expect(s.applied.map((f) => `${f.path}:${f.baseHash ? "updated" : "created"}`)).toEqual([
        "src/cache.ts:created",
        "src/cachedUpstream.ts:created",
        "src/app.ts:updated",
        "test/cache.test.ts:created",
      ]);
      expect(s.checks).toHaveLength(1);
      expect(s.checks[0]!.status).toBe("passed");
      expect(s.checks[0]!.output).toMatch(/Tests\s+7 passed/);

      const nodes = Object.fromEntries(s.graph!.nodes.map((n) => [n.id, n]));
      expect(nodes["src/cachedUpstream.ts#withCache"]).toMatchObject({ status: "new", purposeSource: "plan" });
      expect(nodes["src/cache.ts#createTtlCache"]?.status).toBe("new");
      expect(nodes["src/app.ts#createApp"]).toMatchObject({ status: "changed", purposeSource: "plan" });
      expect(nodes["src/upstream.ts#createMockUpstream"]).toMatchObject({ status: "unchanged", purposeSource: "comment" });
      expect(nodes["src/server.ts#(module)"]).toMatchObject({ status: "unchanged", purposeSource: "agent" });
      const edges = s.graph!.edges.map((e) => `${e.from} -> ${e.to}`);
      expect(edges).toContain("src/cachedUpstream.ts#withCache -> src/cache.ts#cacheKey");
      expect(edges).toContain("src/cachedUpstream.ts#withCache -> src/cache.ts#createTtlCache");
      expect(edges).toContain("src/app.ts#createApp -> src/cachedUpstream.ts#withCache");

      expect(ctx.controller.baselineFor("src/app.ts")?.exists).toBe(true);
      expect(ctx.controller.baselineFor("src/cache.ts")?.exists).toBe(false);
    },
    120_000,
  );

  it("implements the reworked designs after rejections", async () => {
    const ctx = setup();
    await ctx.controller.startFeature("Add caching", ctx.guard());
    await decideAll(ctx, (f) => f.name === "createTtlCache" || f.name === "withCache");
    expect(ctx.state().phase).toBe("done");
    expect(ctx.read("src/cache.ts")).toContain("createLruCache");
    expect(ctx.read("src/app.ts")).toContain("cache.get(key)");
    expect(ctx.state().applied.map((f) => f.path)).not.toContain("src/cachedUpstream.ts");
    expect(ctx.state().graph!.nodes.find((n) => n.name === "GET /api/weather/:city")?.purposeSource).toBe("plan");
  });

  it("pauses on unsaved files without writing anything, then continues on retry", async () => {
    const ctx = setup();
    ctx.workspace.dirty.add("src/app.ts");
    await ctx.controller.startFeature("Add caching", ctx.guard());
    await decideAll(ctx);
    expect(ctx.state().phase).toBe("needsAttention");
    expect(ctx.state().error?.stage).toBe("save");
    expect(ctx.read("src/app.ts")).not.toContain("withCache");

    ctx.workspace.dirty.clear();
    await ctx.controller.retry(ctx.guard());
    expect(ctx.state().phase).toBe("done");
    expect(ctx.read("src/app.ts")).toContain("withCache");
  });

  it("refuses to overwrite code that changed while it was being generated", async () => {
    class Racing extends FakeAgentAdapter {
      onImplement?: () => Promise<void>;
      override async implement(request: { intent: string; functions: PlannedFunction[]; context: FileSnapshot[] }, options: AgentCallOptions): Promise<FileChange[]> {
        const files = await super.implement(request, options);
        await this.onImplement?.();
        return files;
      }
    }
    const agent = new Racing({ delayMs: 0 });
    const ctx = setup([], agent);
    agent.onImplement = () => ctx.workspace.write("src/app.ts", "// edited by hand\n");
    await ctx.controller.startFeature("Add caching", ctx.guard());
    await decideAll(ctx);
    expect(ctx.state().error?.stage).toBe("stale-source");
    expect(ctx.read("src/app.ts")).toBe("// edited by hand\n");
    expect(ctx.state().applied).toEqual([]);
  });

  it("reports a partial write and does not offer to re-apply", async () => {
    const ctx = setup();
    ctx.workspace.failWrites.add("src/app.ts");
    await ctx.controller.startFeature("Add caching", ctx.guard());
    await decideAll(ctx);
    expect(ctx.state().error?.stage).toBe("apply");
    expect(ctx.state().error?.message).toMatch(/Failed: src\/app.ts/);
    expect(ctx.state().applied.map((f) => f.path)).toContain("src/cache.ts");
    await expect(ctx.controller.retry(ctx.guard())).rejects.toBeInstanceOf(GuardError);
  });

  it("keeps the result when a check fails and can rerun it", async () => {
    const ctx = setup([node("process.exit(1)")]);
    await ctx.controller.startFeature("Add caching", ctx.guard());
    await decideAll(ctx);
    expect(ctx.state().phase).toBe("done");
    expect(ctx.state().checks[0]?.status).toBe("failed");
    expect(ctx.state().graph).not.toBeNull();
    await ctx.controller.rerunChecks(ctx.guard());
    expect(ctx.state().phase).toBe("done");
    expect(ctx.state().checks[0]?.id).toBe("r-2");
  });
});

describe("the function graph", () => {
  it("can be built for the current code without a feature", async () => {
    const ctx = setup();
    await ctx.controller.showGraph(ctx.guard());
    const s = ctx.state();
    expect(s.phase).toBe("idle");
    expect(s.graph!.nodes.every((n) => n.status === "unchanged")).toBe(true);
    expect(s.graph!.nodes.find((n) => n.id === "src/app.ts#createApp")?.purpose).toMatch(/Express app/);
  });

  it("follows the code when the user edits it", async () => {
    const ctx = setup();
    await ctx.controller.showGraph(ctx.guard());
    const before = ctx.state().graph!.nodes.find((n) => n.name === "createMockUpstream")!;
    await ctx.workspace.write("src/upstream.ts", `// a new first line\n${ctx.read("src/upstream.ts")}`);
    await ctx.controller.noteSourceChanged();
    const after = ctx.state().graph!.nodes.find((n) => n.name === "createMockUpstream")!;
    expect(after.startLine).toBe(before.startLine + 1);
  });
});
