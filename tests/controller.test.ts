import { describe, expect, it } from "vitest";
import type { AgentAdapter } from "../src/agent/adapter";
import { GuardError, SessionController } from "../src/agent/controller";
import { FakeAgentAdapter } from "../src/agent/fakeAdapter";
import type { ActivityEvent } from "../src/shared/messages";
import type { ApplicationState } from "../src/shared/schema";

function setup(agent: AgentAdapter = new FakeAgentAdapter({ delayMs: 0 })) {
  const states: ApplicationState[] = [];
  const activity: ActivityEvent[] = [];
  const controller = new SessionController(
    agent,
    { onState: (s) => states.push(s), onActivity: (a) => activity.push(a) },
    { sessionId: "s1", workspaceId: "file:///demo" },
  );
  const guard = () => ({ sessionId: "s1", expectedRevision: controller.getState().stateRevision });
  return { controller, states, activity, guard };
}

describe("SessionController", () => {
  it("moves idle -> inspecting -> planReady and streams activity", async () => {
    const { controller, states, activity, guard } = setup();
    await controller.startFeature("Add caching", guard());

    expect(states.map((s) => s.phase)).toEqual(["inspecting", "planReady"]);
    expect(controller.getState().plan?.intent).toBe("Add caching");
    expect(controller.getState().operationId).toBeNull();
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every((a) => a.operationId === "op-1")).toBe(true);
  });

  it("increments the state revision on every change", async () => {
    const { controller, states, guard } = setup();
    await controller.startFeature("Add caching", guard());
    expect(states.map((s) => s.stateRevision)).toEqual([1, 2]);
  });

  it("rejects actions made against a stale revision or another session", async () => {
    const { controller } = setup();
    await expect(controller.startFeature("x", { sessionId: "s1", expectedRevision: 5 })).rejects.toBeInstanceOf(GuardError);
    await expect(controller.startFeature("x", { sessionId: "other", expectedRevision: 0 })).rejects.toBeInstanceOf(GuardError);
  });

  it("rejects a second start while one is running", async () => {
    const { controller, guard } = setup(new FakeAgentAdapter({ delayMs: 20 }));
    const first = controller.startFeature("Add caching", guard());
    await expect(controller.startFeature("Again", guard())).rejects.toBeInstanceOf(GuardError);
    await first;
  });

  it("cancellation returns to the previous stable phase without an error", async () => {
    const { controller, guard } = setup(new FakeAgentAdapter({ delayMs: 50 }));
    const running = controller.startFeature("Add caching", guard());
    controller.cancel({ sessionId: "s1" });
    await running;

    expect(controller.getState().phase).toBe("idle");
    expect(controller.getState().plan).toBeNull();
    expect(controller.getState().error).toBeNull();
  });

  it("surfaces invalid agent output as a recoverable error", async () => {
    class BrokenAgent extends FakeAgentAdapter {
      override async inspectAndPlan(): Promise<never> {
        throw new Error("structured output missing");
      }
    }
    const { controller, guard } = setup(new BrokenAgent({ delayMs: 0 }));
    await controller.startFeature("Add caching", guard());

    expect(controller.getState().phase).toBe("idle");
    expect(controller.getState().error?.stage).toBe("invalid-output");
  });

  it("reset clears session metadata but keeps the session id", async () => {
    const { controller, guard } = setup();
    await controller.startFeature("Add caching", guard());
    controller.reset();
    expect(controller.getState().plan).toBeNull();
    expect(controller.getState().phase).toBe("idle");
    expect(controller.getState().sessionId).toBe("s1");
  });
});
