import { describe, expect, it } from "vitest";
import { buildFeatureReference } from "../src/shared/exportMarkdown";
import { emptyState } from "../src/shared/schema";

describe("buildFeatureReference", () => {
  it("lists accepted and rejected designs and draws the graph without test files", () => {
    const md = buildFeatureReference({
      ...emptyState("s", "w"),
      plan: {
        intent: "Add caching",
        summary: "Cache forecasts.",
        upcoming: [],
        reworkNote: null,
        functions: [
          { id: "a", name: "createTtlCache", kind: "function", path: "src/cache.ts", change: "new", signature: "x", purpose: "TTL cache.", details: [], calls: [], calledBy: [], status: "rejected", rejectionReason: "unbounded" },
          {
            id: "b",
            name: "createLruCache",
            kind: "function",
            path: "src/cache.ts",
            change: "new",
            signature: "x",
            purpose: "LRU cache.",
            details: ["Evicts the oldest."],
            evidence: [
              {
                path: "src/app.ts",
                startLine: 12,
                endLine: 12,
                quote: "const result = await getForecast(city);",
                rationale: "Current route calls the provider.",
                verified: true,
              },
            ],
            calls: [],
            calledBy: [],
            status: "accepted",
          },
        ],
      },
      graph: {
        builtAt: "t",
        skipped: [],
        nodes: [
          { id: "src/app.ts#createApp", name: "createApp", kind: "function", path: "src/app.ts", startLine: 1, endLine: 9, exported: true, bodyHash: "h", status: "changed", purpose: "Builds the app." },
          { id: "src/cache.ts#createLruCache", name: "createLruCache", kind: "function", path: "src/cache.ts", startLine: 3, endLine: 20, exported: true, bodyHash: "h", status: "new" },
          { id: "test/a.test.ts#(module)", name: "a.test.ts", kind: "test", path: "test/a.test.ts", startLine: 1, endLine: 5, exported: false, bodyHash: "h", status: "new" },
        ],
        edges: [
          { id: "1", from: "src/app.ts#createApp", to: "src/cache.ts#createLruCache", kind: "call" },
          { id: "2", from: "test/a.test.ts#(module)", to: "src/app.ts#createApp", kind: "call" },
        ],
      },
    });
    expect(md).toContain("1. **createLruCache** in `src/cache.ts` (new): LRU cache.");
    expect(md).toContain("- **createTtlCache**: TTL cache. Reason: unbounded");
    expect(md).toContain("Source context (references, not proof)");
    expect(md).toContain("quote matched at planning time");
    expect(md).toContain("Current route calls the provider.");
    expect(md).toContain("n_src_app_ts_createApp --> n_src_cache_ts_createLruCache");
    expect(md).not.toContain("a.test.ts");
    expect(md).toContain("No checks have run.");
  });
});
