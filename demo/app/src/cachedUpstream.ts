import { cacheKey, type ForecastCache } from "./cache";
import type { Forecast, WeatherUpstream } from "./upstream";

/** Answers repeated requests for a city from the cache; only misses reach the real provider. */
export function withCache(upstream: WeatherUpstream, cache: ForecastCache<Forecast>): WeatherUpstream {
  return {
    async fetchForecast(city) {
      const key = cacheKey(city);
      const cached = cache.get(key);
      if (cached) return cached;
      const forecast = await upstream.fetchForecast(city);
      cache.set(key, forecast);
      return forecast;
    },
  };
}
