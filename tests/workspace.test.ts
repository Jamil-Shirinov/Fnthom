import { describe, expect, it } from "vitest";
import planFixture from "../demo/fixtures/caching-plan.json";
import proposalFixtures from "../demo/fixtures/caching-proposals.json";
import { deriveInvariantStatus } from "../src/shared/evidence";
import { buildFeatureReference } from "../src/shared/exportMarkdown";
import { CheckDefinition, FeaturePlan, StepProposal, emptyState, type CheckResult } from "../src/shared/schema";
import { runCheckProcess } from "../src/workspace/checks";
import { stepContextPaths, validateProposal } from "../src/workspace/edits";
import { contentHash } from "../src/workspace/hash";

const plan = FeaturePlan.parse(planFixture);
const snap = (path: string, content: string | null) => ({
  path,
  exists: content !== null,
  content: content ?? "",
  contentHash: contentHash(content ?? ""),
});

describe("validateProposal", () => {
  const create = StepProposal.parse(proposalFixtures["s-cache-module"]);

  it("accepts a create against a missing file", () => {
    expect(validateProposal(create, plan, "s-cache-module", [snap("src/cache.ts", null)])).toEqual([]);
  });

  it("flags a create whose target now exists, and a missing baseline, as stale", () => {
    expect(validateProposal(create, plan, "s-cache-module", [snap("src/cache.ts", "x")])[0]?.kind).toBe("stale");
    expect(validateProposal(create, plan, "s-cache-module", [])[0]?.kind).toBe("stale");
  });

  it("flags an update whose base changed as stale and a no-op update as invalid", () => {
    const update = StepProposal.parse({
      ...proposalFixtures["s-use-cache"],
      files: [{ kind: "update", path: "src/app.ts", baseHash: contentHash("old"), newContent: "new" }],
    });
    expect(validateProposal(update, plan, "s-use-cache", [snap("src/app.ts", "changed")])[0]?.kind).toBe("stale");
    const noop = StepProposal.parse({ ...update, files: [{ kind: "update", path: "src/app.ts", baseHash: contentHash("same"), newContent: "same" }] });
    expect(validateProposal(noop, plan, "s-use-cache", [snap("src/app.ts", "same")])[0]?.kind).toBe("invalid");
  });

  it("refuses dependency, VCS and credential paths", () => {
    const bad = StepProposal.parse({ ...create, files: [{ kind: "create", path: "node_modules/x/index.js", newContent: "x" }] });
    expect(validateProposal(bad, plan, "s-cache-module", [snap("node_modules/x/index.js", null)]).some((i) => i.kind === "invalid")).toBe(true);
  });

  it("collects context paths from the step's concepts", () => {
    expect(stepContextPaths(plan, "s-cache-module").sort()).toEqual(["src/app.ts", "src/cache.ts"]);
  });
});

describe("deriveInvariantStatus", () => {
  const check = CheckDefinition.parse({ id: "t", label: "t", executable: "x", invariantIds: ["inv"] });
  const result = (status: CheckResult["status"], fingerprint = "gen-1"): CheckResult => ({
    id: "r",
    checkId: "t",
    stepId: "s",
    startedAt: "",
    finishedAt: "",
    output: "",
    status,
    sourceFingerprint: fingerprint,
  });

  it("is unverified without relevant evidence", () => {
    expect(deriveInvariantStatus("inv", [check], [], "gen-1").status).toBe("unverified");
    expect(deriveInvariantStatus("other", [check], [result("passed")], "gen-1").status).toBe("unverified");
  });

  it("is supported only by passing evidence on the current source", () => {
    expect(deriveInvariantStatus("inv", [check], [result("passed")], "gen-1").status).toBe("supported");
    expect(deriveInvariantStatus("inv", [check], [result("passed")], "gen-2").status).toBe("stale");
  });

  it("is failed by a failing check, but an infrastructure error proves nothing", () => {
    expect(deriveInvariantStatus("inv", [check], [result("failed")], "gen-1").status).toBe("failed");
    expect(deriveInvariantStatus("inv", [check], [result("timed-out")], "gen-1").status).toBe("unverified");
  });
});

describe("runCheckProcess", () => {
  const check = (args: string[], timeoutMs = 10_000) =>
    CheckDefinition.parse({ id: "c", label: "c", executable: process.execPath, args, timeoutMs });

  it("passes on exit 0 and fails on a non-zero exit, capturing output", async () => {
    const ok = await runCheckProcess(check(["-e", "console.log('hello')"]), process.cwd(), new AbortController().signal);
    expect(ok).toMatchObject({ status: "passed", exitCode: 0 });
    expect(ok.output).toContain("hello");
    const bad = await runCheckProcess(check(["-e", "process.exit(3)"]), process.cwd(), new AbortController().signal);
    expect(bad).toMatchObject({ status: "failed", exitCode: 3 });
  });

  it("times out and can be cancelled", async () => {
    const slow = ["-e", "setTimeout(() => {}, 10000)"];
    expect((await runCheckProcess(check(slow, 200), process.cwd(), new AbortController().signal)).status).toBe("timed-out");
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 100);
    expect((await runCheckProcess(check(slow), process.cwd(), abort.signal)).status).toBe("cancelled");
  });

  it("refuses a working directory outside the workspace", async () => {
    const outside = CheckDefinition.parse({ id: "c", label: "c", executable: "node", cwd: "../..", args: [] });
    expect((await runCheckProcess(outside, process.cwd(), new AbortController().signal)).status).toBe("error");
  });
});

describe("buildFeatureReference", () => {
  it("describes concepts, data flow and unresolved claims without a model", () => {
    const md = buildFeatureReference({ ...emptyState("s", "w"), plan });
    expect(md).toContain("```mermaid");
    expect(md).toContain('c_cache_lookup -->|"miss"| c_upstream');
    expect(md).toContain("### Cache lookup (planned)");
    expect(md).toContain("Cached and uncached responses have the same schema. (unverified)");
  });
});
