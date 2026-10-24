import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { annotateGraph, buildCodeGraph } from "../src/workspace/codeGraph";

const demo = path.resolve(__dirname, "../demo/app");
const demoFiles = () =>
  ["src", "test"].flatMap((dir) =>
    readdirSync(path.join(demo, dir)).map((name) => ({ path: `${dir}/${name}`, content: readFileSync(path.join(demo, dir, name), "utf8") })),
  );

const edgeList = (graph: ReturnType<typeof buildCodeGraph>) => graph.edges.map((e) => `${e.from} -${e.kind}-> ${e.to}`).sort();

describe("buildCodeGraph", () => {
  it("finds the demo's functions, route and entry module, and how they connect", () => {
    const graph = buildCodeGraph(demoFiles());
    expect(graph.nodes.map((n) => `${n.id} (${n.kind})`).sort()).toEqual([
      "src/app.ts#GET /api/weather/:city (route)",
      "src/app.ts#createApp (function)",
      "src/server.ts#(module) (module)",
      "src/upstream.ts#createMockUpstream (function)",
    ]);
    expect(edgeList(graph)).toEqual([
      "src/app.ts#GET /api/weather/:city -dispatch-> src/upstream.ts#createMockUpstream",
      "src/app.ts#createApp -registers-> src/app.ts#GET /api/weather/:city",
      "src/server.ts#(module) -call-> src/app.ts#createApp",
      "src/server.ts#(module) -call-> src/upstream.ts#createMockUpstream",
    ]);
    const upstream = graph.nodes.find((n) => n.name === "createMockUpstream")!;
    expect(upstream.purpose).toMatch(/^Stand-in for a slow, metered forecast provider/);
    expect(upstream.purposeSource).toBe("comment");
    expect(upstream.startLine).toBe(8);
    expect(graph.skipped).toEqual([]);
  });

  it("includes test files as test nodes only when asked", () => {
    const graph = buildCodeGraph(demoFiles(), { includeTests: true });
    const tests = graph.nodes.find((n) => n.kind === "test")!;
    expect(tests.id).toBe("test/weather.test.ts#(module)");
    expect(edgeList(graph)).toContain("test/weather.test.ts#(module) -call-> src/app.ts#createApp");
  });

  it("resolves imports, aliases, const arrow functions, class methods and JSX components", () => {
    const graph = buildCodeGraph([
      { path: "src/a.ts", content: "import { helper as h } from './b';\nexport const run = () => h(1);\nexport class Box {\n  open() { return run(); }\n}\n" },
      { path: "src/b.ts", content: "/** Doubles a number. */\nexport function helper(n: number) { return n * 2; }\n" },
      { path: "src/View.tsx", content: "import { Box } from './a';\nfunction Item() { return null; }\nexport function List() { new Box().open(); return <Item />; }\n" },
    ]);
    expect(edgeList(graph)).toEqual([
      "src/View.tsx#List -call-> src/View.tsx#Item",
      "src/View.tsx#List -call-> src/a.ts#Box.open",
      "src/a.ts#Box.open -call-> src/a.ts#run",
      "src/a.ts#run -call-> src/b.ts#helper",
    ]);
    expect(graph.nodes.find((n) => n.name === "helper")?.purpose).toBe("Doubles a number.");
  });

  it("marks new and changed functions against a baseline and prefers the plan's purpose", () => {
    const before = buildCodeGraph([{ path: "a.ts", content: "export function keep() {}\nexport function edit() { return 1; }\n" }]);
    const after = buildCodeGraph([{ path: "a.ts", content: "export function keep() {}\nexport function edit() { return 2; }\nexport function added() {}\n" }]);
    const annotated = annotateGraph(after, {
      baseline: before,
      planned: [
        { id: "f1", name: "added", kind: "function", path: "a.ts", change: "new", signature: "added()", purpose: "Planned purpose", details: [], calls: [], calledBy: [], status: "accepted" },
      ],
      descriptions: { "a.ts#keep": "Described by the agent" },
    });
    const byName = Object.fromEntries(annotated.nodes.map((n) => [n.name, n]));
    expect([byName.keep!.status, byName.edit!.status, byName.added!.status]).toEqual(["unchanged", "changed", "new"]);
    expect(byName.added!.purpose).toBe("Planned purpose");
    expect(byName.keep!.purposeSource).toBe("agent");
    expect(byName.edit!.purpose).toBeUndefined();
  });
});
