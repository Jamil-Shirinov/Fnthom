import { describe, expect, it } from "vitest";
import type { GraphNode } from "../src/shared/schema";
import { findNode } from "../src/workspace/plannedGraph";

const node = (path: string, name: string, kind: GraphNode["kind"], planned?: boolean): GraphNode => ({
  id: `${path}#${name}`,
  name,
  kind,
  path,
  startLine: 1,
  endLine: 2,
  exported: true,
  bodyHash: "h",
  status: planned ? "new" : "unchanged",
  ...(planned ? { planned } : {}),
});

describe("finding the function a name in a plan refers to", () => {
  const nodes = [
    node("src/app.ts", "createApp", "function"),
    node("src/server.ts", "(module)", "module"),
    node("src/upstream.ts", "fetchForecast", "method"),
    node("src/cache.ts", "createTtlCache", "function", true),
  ];

  it("matches function names, file names of entry modules, and Type.member names", () => {
    expect(findNode(nodes, "createApp")).toMatchObject({ node: { id: "src/app.ts#createApp" }, via: "name" });
    expect(findNode(nodes, "createApp()")?.node.id).toBe("src/app.ts#createApp");
    expect(findNode(nodes, "server.ts")).toMatchObject({ node: { id: "src/server.ts#(module)" }, via: "file" });
    expect(findNode(nodes, "WeatherUpstream.fetchForecast")).toMatchObject({ node: { name: "fetchForecast" }, via: "member" });
    expect(findNode(nodes, "createTtlCache")?.node.planned).toBe(true);
    expect(findNode(nodes, "nothingLikeThis")).toBeUndefined();
  });

  it("sends Type.member names to the function that returns that type, but never to the function itself", () => {
    const withTypes = [
      { ...node("src/upstream.ts", "createMockUpstream", "function"), returns: ["WeatherUpstream"] },
      { ...node("src/cachedUpstream.ts", "withCache", "function", true), returns: ["WeatherUpstream"] },
    ];
    expect(findNode(withTypes, "WeatherUpstream.get")).toMatchObject({ node: { name: "withCache" }, via: "returns" });
    expect(findNode(withTypes, "WeatherUpstream.get", "src/cachedUpstream.ts#withCache")?.node.name).toBe("createMockUpstream");
  });
});
