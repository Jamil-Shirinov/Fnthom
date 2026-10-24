import { describe, expect, it } from "vitest";
import planFixture from "../demo/fixtures/caching-plan.json";
import proposalFixtures from "../demo/fixtures/caching-proposals.json";
import {
  FeaturePlan,
  StepProposal,
  WorkspacePath,
  conceptImplementationState,
  parsePlan,
  readySteps,
  verificationSummary,
} from "../src/shared/schema";

const fixture = () => structuredClone(planFixture) as FeaturePlan;

describe("plan validation", () => {
  it("accepts the caching fixture", () => {
    const result = parsePlan(fixture());
    expect(result.ok).toBe(true);
  });

  it("rejects duplicate concept ids", () => {
    const plan = fixture();
    plan.concepts.push({ ...plan.concepts[0]! });
    const result = parsePlan(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toContain("duplicate-id");
  });

  it("rejects edges and steps that reference unknown concepts or steps", () => {
    const plan = fixture();
    plan.edges.push({ id: "e-ghost", fromConceptId: "c-endpoint", toConceptId: "c-ghost", label: "" });
    plan.steps[1]!.dependsOnStepIds.push("s-ghost");
    const result = parsePlan(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.filter((i) => i.code === "unknown-reference")).toHaveLength(2);
  });

  it("rejects cyclic step dependencies but allows cyclic data flow", () => {
    const cyclicFlow = fixture();
    cyclicFlow.edges.push({ id: "e-back", fromConceptId: "c-response", toConceptId: "c-endpoint", label: "JSON" });
    expect(parsePlan(cyclicFlow).ok).toBe(true);

    const cyclicSteps = fixture();
    cyclicSteps.steps[0]!.dependsOnStepIds.push("s-prove-schema");
    const result = parsePlan(cyclicSteps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toContain("cyclic-steps");
  });

  it("rejects an empty implementation plan", () => {
    const plan = { ...fixture(), steps: [] };
    const result = parsePlan(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toContain("empty-plan");
  });

  it("reports schema problems with their path", () => {
    const result = parsePlan({ ...fixture(), revision: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.message).toMatch(/^revision:/);
  });
});

describe("workspace paths", () => {
  it.each(["/etc/passwd", "C:/x", "../outside.ts", "src/../../x", "src\\app.ts"])("rejects %s", (path) => {
    expect(WorkspacePath.safeParse(path).success).toBe(false);
  });

  it("accepts normalized relative paths", () => {
    expect(WorkspacePath.safeParse("src/cache.ts").success).toBe(true);
  });
});

describe("proposals", () => {
  it("parses every fixture proposal", () => {
    for (const proposal of Object.values(proposalFixtures)) {
      expect(StepProposal.safeParse(proposal).success).toBe(true);
    }
  });

  it("rejects two entries for the same path", () => {
    const proposal = structuredClone(proposalFixtures["s-cache-module"]);
    proposal.files.push(proposal.files[0]!);
    expect(StepProposal.safeParse(proposal).success).toBe(false);
  });
});

describe("graph state", () => {
  const plan = FeaturePlan.parse(fixture());
  const concept = (id: string) => plan.concepts.find((c) => c.id === id)!;

  it("marks concepts planned before any step is applied", () => {
    expect(conceptImplementationState(concept("c-cache-lookup"), plan, new Set(), null)).toBe("planned");
  });

  it("marks the current step's concepts active and applied steps' concepts applied", () => {
    const applied = new Set(["s-cache-module"]);
    expect(conceptImplementationState(concept("c-cache-lookup"), plan, applied, "s-use-cache")).toBe("applied");
    expect(conceptImplementationState(concept("c-endpoint"), plan, applied, "s-use-cache")).toBe("active");
  });

  it("marks a concept stale when any source reference is not resolved", () => {
    const stale = structuredClone(concept("c-upstream"));
    stale.sourceRefs[0]!.status = "stale";
    expect(conceptImplementationState(stale, plan, new Set(), null)).toBe("stale");
  });

  it("keeps verification separate and reports the worst invariant first", () => {
    const c = structuredClone(concept("c-response"));
    expect(verificationSummary(c)).toBe("unverified");
    c.invariants.push({ ...c.invariants[0]!, id: "inv-x", status: "failed" });
    expect(verificationSummary(c)).toBe("failed");
    expect(verificationSummary(concept("c-endpoint"))).toBe("none");
  });

  it("offers only dependency-ready steps", () => {
    expect(readySteps(plan, new Set()).map((s) => s.id)).toEqual(["s-cache-module"]);
    expect(readySteps(plan, new Set(["s-cache-module"])).map((s) => s.id)).toEqual(["s-use-cache"]);
  });
});
