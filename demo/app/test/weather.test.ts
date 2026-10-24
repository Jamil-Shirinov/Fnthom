import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { WeatherResponse } from "../src/schema";
import { createMockUpstream } from "../src/upstream";

describe("GET /api/weather/:city", () => {
  it("returns a response that matches the WeatherResponse schema", async () => {
    const app = createApp({ upstream: createMockUpstream({ latencyMs: 0 }) });
    const res = await request(app).get("/api/weather/Berkeley");

    expect(res.status).toBe(200);
    expect(WeatherResponse.safeParse(res.body).success).toBe(true);
    expect(res.body.city).toBe("Berkeley");
  });

  it("rejects invalid city names without calling upstream", async () => {
    const upstream = createMockUpstream({ latencyMs: 0 });
    const res = await request(createApp({ upstream })).get("/api/weather/%3Cscript%3E");

    expect(res.status).toBe(400);
    expect(upstream.calls).toBe(0);
  });

  it("reports provider failures as 502", async () => {
    const upstream = { fetchForecast: async () => Promise.reject(new Error("down")) };
    const res = await request(createApp({ upstream })).get("/api/weather/Oakland");

    expect(res.status).toBe(502);
  });
});
