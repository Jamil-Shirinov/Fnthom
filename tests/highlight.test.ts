import { describe, expect, it } from "vitest";
import { tokenize } from "../webview/src/highlight";

const kinds = (code: string) =>
  tokenize(code)
    .filter((t) => t.kind !== "space" && t.kind !== "punctuation")
    .map((t) => `${t.text}:${t.kind}${t.depth !== undefined ? t.depth : ""}`);

describe("coloring signatures like the editor", () => {
  it("tells functions, parameters, types, keywords and nested brackets apart", () => {
    expect(kinds("createTtlCache<V>(options: { ttlMs: number; now?: () => number }): ForecastCache<V>")).toEqual([
      "createTtlCache:function",
      "<:bracket0", "V:type", ">:bracket0",
      "(:bracket0",
      "options:variable",
      "{:bracket1",
      "ttlMs:variable", "number:type",
      "now:variable", "(:bracket2", "):bracket2", "number:type",
      "}:bracket1",
      "):bracket0",
      "ForecastCache:type", "<:bracket0", "V:type", ">:bracket0",
    ]);
  });

  it("handles method calls, strings and keywords", () => {
    expect(kinds('app.get("/api/weather/:city", handler)')).toEqual([
      "app:variable", "get:function", "(:bracket0", '"/api/weather/:city":string', "handler:variable", "):bracket0",
    ]);
    expect(kinds("load(id: string): Promise<void>")).toContain("void:keyword");
  });
});
