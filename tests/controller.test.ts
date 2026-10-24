import { cpSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { GuardError, SessionController } from "../src/agent/controller";
import { FakeAgentAdapter } from "../src/agent/fakeAdapter";
import type { ActivityEvent } from "../src/shared/messages";
import { CheckDefinition, type ApplicationState } from "../src/shared/schema";
import { NodeWorkspace } from "./helpers/nodeWorkspace";

const DEMO = path.resolve(__dirname, "../demo/app");

/** A fresh copy of the demo app's sources, sharing its installed node_modules. */
function demoCopy() {
  const dir = mkdtempSync(path.join(tmpdir(), "hca-demo-"));
  for (const entry of ["src", "test", "package.json", "tsconfig.json", "vitest.config.ts"]) {
    cpSync(path.join(DEMO, entry), path.join(dir, entry), { recursive: true });
  }
  symlinkSync(path.join(DEMO, "node_modules"), path.join(dir, "node_modules"), "dir");
  return dir;
}

const node = (script: string, invariantIds: string[] = []) =>
  CheckDefinition.parse({ id: "check", label: "check", executable: process.execPath, args: ["-e", script], invariantIds });

function setup(checks: CheckDefinition[] = [], agent = new FakeAgentAdapter({ delayMs: 0 })) {
  const workspace = new NodeWorkspace(demoCopy(), checks);
  const states: ApplicationState[] = [];
  const activity: ActivityEvent[] = [];
  const controller = new SessionController(agent, workspace, { onState: (s) => states.push(s), onActivity: (a) => activity.push(a) }, {
    sessionId: "s1",
    workspaceId: "file:///demo",
  });
  const guard = () => ({ sessionId: "s1", expectedRevision: controller.getState().stateRevision });
  const state = () => controller.getState();
  return { controller, workspace, states, activity, guard, state };
}

async function planned(checks: CheckDefinition[] = []) {
  const ctx = setup(checks);
  await ctx.controller.startFeature("Add caching", ctx.guard());
  return ctx;
}

describe("planning", () => {
  it("moves idle -> inspecting -> planReady and streams activity", async () => {
    const { controller, states, activity, guard } = setup();
    await controller.startFeature("Add caching", guard());
    expect(states.map((s) => s.phase)).toEqual(["inspecting", "planReady"]);
    expect(controller.getState().plan?.intent).toBe("Add caching");
    expect(activity.length).toBeGreaterThan(0);
  });

  it("rejects stale revisions, other sessions, and a second start while busy", async () => {
    const { controller, guard } = setup([], new FakeAgentAdapter({ delayMs: 20 }));
    await expect(controller.startFeature("x", { sessionId: "s1", expectedRevision: 5 })).rejects.toBeInstanceOf(GuardError);
    await expect(controller.startFeature("x", { sessionId: "other", expectedRevision: 0 })).rejects.toBeInstanceOf(GuardError);
    const first = controller.startFeature("Add caching", guard());
    await expect(controller.startFeature("Again", guard())).rejects.toBeInstanceOf(GuardError);
    await first;
  });

  it("cancellation returns to the previous stable phase without an error", async () => {
    const { controller, guard } = setup([], new FakeAgentAdapter({ delayMs: 50 }));
    const running = controller.startFeature("Add caching", guard());
    controller.cancel({ sessionId: "s1" });
    await running;
    expect(controller.getState().phase).toBe("idle");
    expect(controller.getState().error).toBeNull();
  });

  it("surfaces invalid agent output as a recoverable error", async () => {
    class BrokenAgent extends FakeAgentAdapter {
      override async inspectAndPlan(): Promise<never> {
        throw new Error("structured output missing");
      }
    }
    const { controller, guard } = setup([], new BrokenAgent({ delayMs: 0 }));
    await controller.startFeature("Add caching", guard());
    expect(controller.getState().phase).toBe("idle");
    expect(controller.getState().error?.stage).toBe("invalid-output");
  });
});

describe("proposing", () => {
  it("only proposes dependency-ready steps, without touching files", async () => {
    const { controller, workspace, guard, state } = await planned();
    await expect(controller.startStep("s-use-cache", guard())).rejects.toBeInstanceOf(GuardError);

    const before = await workspace.snapshot(["src/app.ts", "src/cache.ts"]);
    await controller.startStep("s-cache-module", guard());
    expect(state().phase).toBe("previewReady");
    expect(state().proposal?.files.map((f) => f.path)).toEqual(["src/cache.ts"]);
    expect(await workspace.snapshot(["src/app.ts", "src/cache.ts"])).toEqual(before);
    expect(controller.baselineFor(state().proposal!.id, "src/cache.ts")?.exists).toBe(false);
  });

  it("answers questions without changing phase or files", async () => {
    const { controller, guard, state } = await planned();
    await controller.startStep("s-cache-module", guard());
    await controller.askQuestion("Why lazy expiry?", guard());
    expect(state().phase).toBe("previewReady");
    expect(state().questions[0]?.answer).toMatch(/TTL cache module/);
  });
});

describe("applying", () => {
  it("applies a proposal exactly once and rejects a replay", async () => {
    const { controller, workspace, guard, state } = await planned();
    await controller.startStep("s-cache-module", guard());
    const proposalId = state().proposal!.id;
    await controller.applyAndContinue(proposalId, guard());

    expect((await workspace.snapshot(["src/cache.ts"]))[0]?.exists).toBe(true);
    expect(state().history.map((h) => h.stepId)).toEqual(["s-cache-module"]);
    await expect(controller.applyAndContinue(proposalId, guard())).rejects.toBeInstanceOf(GuardError);
  });

  it("blocks application when the file changed after the proposal, keeping the newer source", async () => {
    const { controller, workspace, guard, state } = await planned();
    await controller.startStep("s-cache-module", guard());
    await controller.applyAndContinue(state().proposal!.id, guard()); // no checks: advances to s-use-cache
    expect(state().phase).toBe("previewReady");
    expect(state().currentStepId).toBe("s-use-cache");

    await workspace.write("src/app.ts", "// edited by hand\n");
    await controller.applyAndContinue(state().proposal!.id, guard());
    expect(state().phase).toBe("needsAttention");
    expect(state().error?.stage).toBe("stale-source");
    expect((await workspace.snapshot(["src/app.ts"]))[0]?.content).toBe("// edited by hand\n");
  });

  it("pauses on unsaved changes instead of saving them", async () => {
    const { controller, workspace, guard, state } = await planned();
    await controller.startStep("s-cache-module", guard());
    workspace.dirty.add("src/cache.ts");
    await controller.applyAndContinue(state().proposal!.id, guard());
    expect(state().error?.stage).toBe("save");
    expect(state().history).toHaveLength(0);
  });

  it("reports real outcomes when a write fails and does not complete the step", async () => {
    const { controller, workspace, guard, state } = await planned();
    await controller.startStep("s-cache-module", guard());
    workspace.failWrites.add("src/cache.ts");
    await controller.applyAndContinue(state().proposal!.id, guard());
    expect(state().phase).toBe("needsAttention");
    expect(state().error?.stage).toBe("apply");
    expect(state().history).toHaveLength(0);
  });

  it("retires a pending proposal when its file changes outside the session", async () => {
    const { controller, workspace, guard, state } = await planned();
    await controller.startStep("s-cache-module", guard());
    await controller.applyAndContinue(state().proposal!.id, guard());
    await workspace.write("src/app.ts", "// edited\n");
    await controller.noteSourceChanged(["src/app.ts"]);
    expect(state().proposal).toBeNull();
    expect(state().error?.stage).toBe("stale-source");
    expect(state().plan?.concepts.find((c) => c.id === "c-endpoint")?.sourceRefs[0]?.status).toBe("stale");
  });
});

describe("checks and evidence", () => {
  it("records failing checks, keeps the applied code, and continues only on request", async () => {
    const { controller, workspace, guard, state } = await planned([node("process.exit(1)", ["inv-case-insensitive-key"])]);
    await controller.startStep("s-cache-module", guard());
    await controller.applyAndContinue(state().proposal!.id, guard());

    expect(state().phase).toBe("needsAttention");
    expect(state().error?.stage).toBe("checks");
    expect((await workspace.snapshot(["src/cache.ts"]))[0]?.exists).toBe(true);
    const lookup = state().plan!.concepts.find((c) => c.id === "c-cache-lookup")!;
    expect(lookup.invariants[0]?.status).toBe("failed");

    await controller.continueAfterFailure(guard());
    expect(state().currentStepId).toBe("s-use-cache");
    expect(state().evidence.at(-1)?.status).toBe("failed");
  });

  it("supports an invariant after a passing check and marks it stale after an outside edit", async () => {
    const { controller, workspace, guard, state } = await planned([node("process.exit(0)", ["inv-case-insensitive-key"])]);
    await controller.startStep("s-cache-module", guard());
    await controller.applyAndContinue(state().proposal!.id, guard());
    const status = () => state().plan!.concepts.find((c) => c.id === "c-cache-lookup")!.invariants[0]?.status;
    expect(status()).toBe("supported");

    await controller.noteSourceChanged(["src/cache.ts"]); // same content: the session's own write
    expect(status()).toBe("supported");
    await workspace.write("src/cache.ts", "export {};\n");
    await controller.noteSourceChanged(["src/cache.ts"]);
    expect(status()).toBe("stale");
  });
});

describe("full loop on the real demo app", () => {
  it(
    "applies all three caching steps and the demo tests support the schema invariant",
    async () => {
      const demoTests = CheckDefinition.parse({
        id: "demo-tests",
        label: "Weather API tests",
        executable: process.execPath,
        args: [path.join(DEMO, "node_modules/vitest/vitest.mjs"), "run"],
        invariantIds: ["inv-same-schema"],
        timeoutMs: 60_000,
      });
      const { controller, guard, state } = await planned([demoTests]);
      await controller.startStep("s-cache-module", guard());
      for (let i = 0; i < 3 && state().phase === "previewReady"; i++) {
        await controller.applyAndContinue(state().proposal!.id, guard());
      }

      expect(state().error).toBeNull();
      expect(state().phase).toBe("complete");
      expect(state().history.map((h) => h.stepId)).toEqual(["s-cache-module", "s-use-cache", "s-prove-schema"]);
      expect(state().evidence.every((e) => e.status === "passed")).toBe(true);
      expect(state().evidence.at(-1)?.output).toMatch(/6 passed/);
      const response = state().plan!.concepts.find((c) => c.id === "c-response")!;
      expect(response.invariants[0]?.status).toBe("supported");
      const lookup = state().plan!.concepts.find((c) => c.id === "c-cache-lookup")!;
      expect(lookup.sourceRefs.map((r) => r.path)).toContain("src/cache.ts");
    },
    120_000,
  );
});
