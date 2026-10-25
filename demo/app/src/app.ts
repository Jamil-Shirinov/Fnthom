import express from "express";
import { createTtlCache, type ForecastCache } from "./cache";
import { withCache } from "./cachedUpstream";
import { WeatherResponse } from "./schema";
import type { Forecast, WeatherUpstream } from "./upstream";

export function createApp(deps: { upstream: WeatherUpstream; cache?: ForecastCache<Forecast> }) {
  const app = express();
  const upstream = withCache(deps.upstream, deps.cache ?? createTtlCache<Forecast>({ ttlMs: 60_000 }));

  app.get("/api/weather/:city", async (req, res) => {
    const city = req.params.city.trim();
    if (!/^[\p{L} .'-]{1,64}$/u.test(city)) {
      res.status(400).json({ error: "Invalid city name" });
      return;
    }

    try {
      const forecast = await upstream.fetchForecast(city);
      const body = WeatherResponse.parse({ city, ...forecast, fetchedAt: new Date().toISOString() });
      res.json(body);
    } catch {
      res.status(502).json({ error: "Forecast provider unavailable" });
    }
  });

  return app;
}
