import { describe, expect, it } from "vitest";
import { largeProject } from "../scripts/largeProject";
import { clusterGraph, metaEdges } from "../src/workspace/clusters";
import { buildCodeGraph } from "../src/workspace/codeGraph";

describe("clustering the function graph", () => {
  const graph = buildCodeGraph(largeProject());
  const clusters = clusterGraph(graph.nodes, graph.edges);
  const clusterOf = (name: string) => clusters.find((c) => c.nodeIds.some((id) => id.endsWith(`#${name}`)));

  it("puts the functions of one feature together and keeps features apart", () => {
    expect(graph.nodes.length).toBeGreaterThan(80);
    expect(clusters.length).toBeGreaterThanOrEqual(6);
    expect(clusters.length).toBeLessThanOrEqual(14);
    expect(clusterOf("hashPassword")).toBe(clusterOf("verifyToken"));
    expect(clusterOf("chargeCard")).toBe(clusterOf("createInvoice"));
    expect(clusterOf("sendEmail")).toBe(clusterOf("queueMessage"));
    expect(clusterOf("hashPassword")).not.toBe(clusterOf("chargeCard"));
    expect(clusterOf("searchProducts")).not.toBe(clusterOf("sendEmail"));
    // Every node is in exactly one cluster.
    expect(clusters.flatMap((c) => c.nodeIds).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
  });

  it("names clusters after what they are for, without repeating a name", () => {
    const names = clusters.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(clusterOf("chargeCard")!.name).toBe("Billing");
    expect(clusterOf("hashPassword")!.name).toBe("Auth");
    expect(clusterOf("sendEmail")!.name.toLowerCase()).toMatch(/email|queue|sms|message|notification/);
  });

  it("merges the calls between clusters into one edge per pair", () => {
    const meta = metaEdges(clusters, graph.edges);
    const orders = clusterOf("placeOrder")!.id;
    const billing = clusterOf("chargeCard")!.id;
    const edge = meta.find((e) => e.from === orders && e.to === billing);
    expect(edge?.count).toBeGreaterThanOrEqual(2);
    expect(new Set(meta.map((e) => e.id)).size).toBe(meta.length);
    expect(meta.every((e) => e.from !== e.to)).toBe(true);
  });

  it("is stable for the same graph and handles tiny graphs", () => {
    expect(clusterGraph(graph.nodes, graph.edges)).toEqual(clusters);
    expect(clusterGraph([], [])).toEqual([]);
    const one = graph.nodes.slice(0, 1);
    expect(clusterGraph(one, [])).toHaveLength(1);
  });
});
