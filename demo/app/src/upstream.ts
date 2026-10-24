export type Forecast = { temperatureC: number; conditions: string };

export interface WeatherUpstream {
  fetchForecast(city: string): Promise<Forecast>;
}

/** Stand-in for a slow, metered forecast provider. Counts calls so tests can see upstream traffic. */
export function createMockUpstream(options: { latencyMs?: number } = {}) {
  const latencyMs = options.latencyMs ?? 300;
  let calls = 0;

  const upstream: WeatherUpstream & { readonly calls: number } = {
    get calls() {
      return calls;
    },
    async fetchForecast(city) {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      const seed = [...city].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
      return { temperatureC: (seed % 35) - 5, conditions: ["sunny", "cloudy", "foggy", "rainy"][seed % 4]! };
    },
  };
  return upstream;
}
