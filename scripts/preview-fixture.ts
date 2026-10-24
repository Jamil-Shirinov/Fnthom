// Regenerates webview/src/fixtures/caching-graphs.json, the graphs the browser preview shows:
// the demo app before the feature, and after the fake agent's default designs are implemented.
// Run with: npm run preview:fixture

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { EXISTING_DESCRIPTIONS, DEFAULT_CHOICES, STEP_KEYS, filesFor, proposalFor } from "../src/agent/fakeScenario";
import type { FileSnapshot, PlannedFunction } from "../src/shared/schema";
import { annotateGraph, buildCodeGraph } from "../src/workspace/codeGraph";
import { contentHash } from "../src/workspace/hash";

const demo = path.resolve("demo/app");
const files: FileSnapshot[] = ["src", "test"].flatMap((dir) =>
  readdirSync(path.join(demo, dir)).map((name) => {
    const content = readFileSync(path.join(demo, dir, name), "utf8");
    return { path: `${dir}/${name}`, exists: true, content, contentHash: contentHash(content) };
  }),
);

const planned: PlannedFunction[] = STEP_KEYS.map((step) => ({ id: `fn-${step}-1`, ...proposalFor(step, DEFAULT_CHOICES), status: "accepted" as const }));
const before = buildCodeGraph(files, { includeTests: true });
const changes = filesFor(DEFAULT_CHOICES, files);
const afterFiles = [
  ...files.filter((f) => !changes.some((c) => c.path === f.path)),
  ...changes.map((c) => ({ path: c.path, content: c.newContent })),
];
const after = buildCodeGraph(afterFiles, { includeTests: true });
const builtAt = "2026-10-24T00:00:00.000Z";

const out = {
  before: { ...annotateGraph(before, { descriptions: EXISTING_DESCRIPTIONS }), builtAt },
  after: { ...annotateGraph(after, { baseline: before, planned, descriptions: EXISTING_DESCRIPTIONS }), builtAt },
  applied: changes.map((c) => ({ path: c.path, baseHash: c.kind === "update" ? c.baseHash : null, appliedHash: contentHash(c.newContent) })),
};
writeFileSync("webview/src/fixtures/caching-graphs.json", `${JSON.stringify(out, null, 2)}\n`);
console.log(`before: ${out.before.nodes.length} nodes, after: ${out.after.nodes.length} nodes`);
