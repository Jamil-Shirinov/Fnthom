import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyProposalEvidence } from "../src/agent/evidence";
import type { FileSnapshot, FunctionProposal } from "../src/shared/schema";
import { contentHash } from "../src/workspace/hash";
import { evidenceFor, STEP_KEYS } from "../src/agent/fakeScenario";

const content = "export function fetchForecast(city: string) {\n  return city;\n}\n";
const file: FileSnapshot = {
  path: "src/upstream.ts",
  exists: true,
  content,
  contentHash: contentHash(content),
};
const proposal: FunctionProposal = {
  id: "fn-1",
  name: "cacheForecast",
  kind: "function",
  path: "src/cache.ts",
  change: "new",
  signature: "cacheForecast(city: string)",
  purpose: "Cache forecasts.",
  details: [],
  calls: [],
  calledBy: [],
  evidence: [
    {
      path: file.path,
      startLine: 1,
      endLine: 3,
      quote: "export function fetchForecast(city: string) {\n  return city;\n}",
      rationale: "The current provider call can be wrapped.",
      verified: false,
      verificationNote: "Agent-supplied status must not be trusted.",
    },
  ],
};

describe("proposal evidence", () => {
  it("marks exact source excerpts as matched and overrides agent verification fields", () => {
    const checked = verifyProposalEvidence(proposal, [file]);

    expect(checked.evidence?.[0]).toMatchObject({ verified: true, rationale: "The current provider call can be wrapped." });
    expect(checked.evidence?.[0]?.verificationNote).toBeUndefined();
  });

  it("marks altered, missing, and out-of-range citations as unverified", () => {
    const checked = verifyProposalEvidence(
      {
        ...proposal,
        evidence: [
          { ...proposal.evidence![0]!, quote: "invented source" },
          { ...proposal.evidence![0]!, path: "src/missing.ts" },
          { ...proposal.evidence![0]!, startLine: 1, endLine: 20 },
        ],
      },
      [file],
    );

    expect(checked.evidence?.map((reference) => [reference.verified, reference.verificationNote])).toEqual([
      [false, "The quoted text does not match the current source at these lines."],
      [false, "The cited source file was not included in the planning context."],
      [false, "The cited line range is outside the current source file."],
    ]);
  });

  it("keeps every scripted demo citation matched to its source", () => {
    const root = path.resolve(__dirname, "../demo/app");
    const files: FileSnapshot[] = ["src/app.ts", "src/upstream.ts", "test/weather.test.ts"].map((sourcePath) => {
      const source = readFileSync(path.join(root, sourcePath), "utf8");
      return { path: sourcePath, exists: true, content: source, contentHash: contentHash(source) };
    });
    const proposalForStep = (step: (typeof STEP_KEYS)[number]): FunctionProposal => ({
      ...proposal,
      evidence: evidenceFor(step),
    });

    for (const step of STEP_KEYS) {
      const evidence = verifyProposalEvidence(proposalForStep(step), files).evidence!;
      expect(evidence.every((reference) => reference.verified), `${step} citations should match demo sources`).toBe(true);
    }
  });
});
