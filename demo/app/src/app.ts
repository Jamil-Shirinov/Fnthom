import express from "express";
import { WeatherResponse } from "./schema";
import type { WeatherUpstream } from "./upstream";

export function createApp(deps: { upstream: WeatherUpstream }) {
  const app = express();

  app.get("/api/weather/:city", async (req, res) => {
    const city = req.params.city.trim();
    if (!/^[\p{L} .'-]{1,64}$/u.test(city)) {
      res.status(400).json({ error: "Invalid city name" });
      return;
    }

    try {
      const forecast = await deps.upstream.fetchForecast(city);
      const body = WeatherResponse.parse({ city, ...forecast, fetchedAt: new Date().toISOString() });
      res.json(body);
    } catch {
      res.status(502).json({ error: "Forecast provider unavailable" });
    }
  });

  return app;
}
