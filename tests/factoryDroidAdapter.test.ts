import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSession } from "@factory/droid-sdk/node";
import { FactoryDroidAdapter } from "../src/agent/factoryDroidAdapter";

const makeValidPlanningTurn = () => ({
  summary: "Cache the weather response.",
  next: {
    id: "fn-cache-1",
    name: "createTtlCache",
    kind: "function",
    path: "src/cache.ts",
    change: "new",
    signature: "export function createTtlCache()",
    purpose: "Store weather data with a TTL.",
    details: ["Use a bounded in-memory cache.", "Expire entries after 60 seconds."],
    calls: [],
    calledBy: ["createApp"],
    evidence: [
      {
        path: "src/app.ts",
        startLine: 12,
        endLine: 12,
        quote: "      await deps.upstream.fetchForecast(city);",
        rationale: "This is the existing provider call.",
      },
    ],
  },
  upcoming: [{ name: "createApp", summary: "Wire the cache into the app." }],
  reworkNote: undefined,
});

vi.mock("@factory/droid-sdk/node", () => ({
  createSession: vi.fn(async () => ({
    async *stream() {
      yield { type: "assistant", text: JSON.stringify(makeValidPlanningTurn()) };
      yield { type: "result", success: true, error: null };
    },
    close: async () => {},
  })),
  DroidMessageType: {},
}));

const options = () => ({ operationId: "op", signal: new AbortController().signal, onActivity: () => {} });

describe("FactoryDroidAdapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requires a Factory API key before a real session begins", async () => {
    const agent = new FactoryDroidAdapter({ apiKey: undefined });

    await expect(
      agent.planNext({ intent: "Cache it", context: [], history: [], lastDecision: null }, options()),
    ).rejects.toThrow(/Factory API key/i);
  });

  it("accepts a valid planning payload from the SDK", async () => {
    const agent = new FactoryDroidAdapter({ apiKey: "test-key" });

    const turn = await agent.planNext({ intent: "Cache it", context: [], history: [], lastDecision: null }, options());

    expect(turn.summary).toBe("Cache the weather response.");
    expect(turn.next?.name).toBe("createTtlCache");
    expect(turn.next?.evidence?.[0]?.quote).toContain("fetchForecast");
    expect(turn.upcoming[0]?.name).toBe("createApp");
  });

  it("configures the Factory session to stay proposal-only and auto-reject prompts", async () => {
    const agent = new FactoryDroidAdapter({ apiKey: "test-key" });
    await agent.planNext({ intent: "Cache it", context: [], history: [], lastDecision: null }, options());

    expect(vi.mocked(createSession)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKey: "test-key",
        autoRejectPermissionRequests: true,
        disableBuiltinSkills: true,
      }),
    );
  });

  it("deduplicates the final SDK result text from the assistant message stream", async () => {
    const agent = new FactoryDroidAdapter({ apiKey: "test-key" });
    vi.mocked(createSession).mockImplementationOnce(async () => ({
      async *stream() {
        const text = JSON.stringify(makeValidPlanningTurn());
        yield { type: "assistant", text };
        yield { type: "result", success: true, text, error: null };
      },
      close: async () => {},
    } as any));

    const turn = await agent.planNext({ intent: "Cache it", context: [], history: [], lastDecision: null }, options());

    expect(turn.summary).toBe("Cache the weather response.");
    expect(turn.next?.name).toBe("createTtlCache");
  });

  it("accepts Factory structured output from the final SDK result", async () => {
    const agent = new FactoryDroidAdapter({ apiKey: "test-key" });
    vi.mocked(createSession).mockImplementationOnce(async () => ({
      async *stream() {
        yield { type: "assistant", text: "thinking..." };
        yield { type: "result", success: true, text: "", structuredOutput: makeValidPlanningTurn(), error: null };
      },
      close: async () => {},
    } as any));

    const turn = await agent.planNext({ intent: "Cache it", context: [], history: [], lastDecision: null }, options());

    expect(turn.summary).toBe("Cache the weather response.");
    expect(turn.next?.name).toBe("createTtlCache");
  });

  it("accepts structured implementation and describe payloads from the final SDK result", async () => {
    const agent = new FactoryDroidAdapter({ apiKey: "test-key" });
    vi.mocked(createSession).mockResolvedValue({
      async *stream(prompt: string) {
        if (prompt.includes("Write the accepted plan as full-content file updates.")) {
          yield { type: "assistant", text: "drafting implementation" };
          yield {
            type: "result",
            success: true,
            text: "",
            structuredOutput: [
              { kind: "create", path: "src/cache.ts", newContent: "export const cache = {};\n" },
            ],
            error: null,
          };
          return;
        }

        if (prompt.includes("Describe the given nodes in one sentence each.")) {
          yield { type: "assistant", text: "describing nodes" };
          yield {
            type: "result",
            success: true,
            text: "",
            structuredOutput: { "fn-cache-1": "Caches weather results for one minute." },
            error: null,
          };
          return;
        }

        throw new Error(`Unexpected Factory prompt: ${prompt.slice(0, 80)}`);
      },
      close: async () => {},
    } as any);

    const files = await agent.implement({ intent: "Cache it", functions: [], context: [] }, options());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("src/cache.ts");

    const descriptions = await agent.describe({ nodes: [{ id: "fn-cache-1", name: "createTtlCache", path: "src/cache.ts", code: "export const cache = {};" }] }, options());
    expect(descriptions["fn-cache-1"]).toBe("Caches weather results for one minute.");
  });

  it("recreates the session after a failed SDK response so later attempts still work", async () => {
    const agent = new FactoryDroidAdapter({ apiKey: "test-key" });
    vi.mocked(createSession)
      .mockImplementationOnce(async () => ({
        async *stream() {
          yield { type: "assistant", text: '{"summary":"bad","next":{},"upcoming":[]}' };
          yield { type: "result", success: true, error: null };
        },
        close: async () => {},
      } as any))
      .mockImplementationOnce(async () => ({
        async *stream() {
          yield { type: "assistant", text: JSON.stringify(makeValidPlanningTurn()) };
          yield { type: "result", success: true, text: JSON.stringify(makeValidPlanningTurn()), error: null };
        },
        close: async () => {},
      } as any));

    await expect(
      agent.planNext({ intent: "Cache it", context: [], history: [], lastDecision: null }, options()),
    ).rejects.toThrow(/invalid data|summary|next/i);

    const turn = await agent.planNext({ intent: "Cache it", context: [], history: [], lastDecision: null }, options());

    expect(turn.summary).toBe("Cache the weather response.");
    expect(turn.next?.name).toBe("createTtlCache");
  });

  it("rejects malformed planning output that does not match the app schema", async () => {
    const agent = new FactoryDroidAdapter({ apiKey: "test-key" });
    vi.mocked(createSession).mockImplementationOnce(async () => ({
      async *stream() {
        yield { type: "assistant", text: '{"summary":"bad","next":{},"upcoming":[]}' };
        yield { type: "result", success: true, error: null };
      },
      close: async () => {},
    } as any));

    await expect(
      agent.planNext({ intent: "Cache it", context: [], history: [], lastDecision: null }, options()),
    ).rejects.toThrow(/invalid data|summary|next/i);
  });
});
