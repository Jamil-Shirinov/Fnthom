import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { cacheKey, createTtlCache } from "../src/cache";
import { WeatherResponse } from "../src/schema";
import { createMockUpstream } from "../src/upstream";

describe("weather caching", () => {
  it("calls the provider once for repeated requests", async () => {
    const upstream = createMockUpstream({ latencyMs: 0 });
    const app = createApp({ upstream });
    await request(app).get("/api/weather/Berkeley");
    await request(app).get("/api/weather/berkeley");
    expect(upstream.calls).toBe(1);
  });

  it("returns the same schema for cached and uncached responses", async () => {
    const app = createApp({ upstream: createMockUpstream({ latencyMs: 0 }) });
    const miss = await request(app).get("/api/weather/Oakland");
    const hit = await request(app).get("/api/weather/Oakland");
    expect(WeatherResponse.safeParse(miss.body).success).toBe(true);
    expect(WeatherResponse.safeParse(hit.body).success).toBe(true);
    expect(Object.keys(hit.body).sort()).toEqual(Object.keys(miss.body).sort());
  });

  it("forgets entries after the TTL", () => {
    let clock = 0;
    const cache = createTtlCache<number>({ ttlMs: 1000, now: () => clock });
    cache.set("k", 1);
    clock = 999;
    expect(cache.get("k")).toBe(1);
    clock = 1000;
    expect(cache.get("k")).toBeUndefined();
  });

  it("shares one entry across case and surrounding spaces", () => {
    expect(cacheKey(" Berkeley ")).toBe(cacheKey("berkeley"));
  });
});
