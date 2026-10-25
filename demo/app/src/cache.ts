export type ForecastCache<V> = {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  readonly size: number;
};

/** Keeps recent values in memory and forgets each one ttlMs after it was stored. */
export function createTtlCache<V>(options: { ttlMs: number; now?: () => number }): ForecastCache<V> {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: V; expiresAt: number }>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.set(key, { value, expiresAt: now() + options.ttlMs });
    },
    get size() {
      return entries.size;
    },
  };
}

/** Cities that differ only by case or surrounding spaces share one cache entry. */
export function cacheKey(city: string): string {
  return city.trim().toLowerCase();
}
