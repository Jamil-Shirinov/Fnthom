// Scripted caching scenario for the fake agent, written against demo/app.
// Five functions are proposed in order. Each has two designs: rejecting one swaps in the other and
// rewrites the rest of the plan to match, so the accept/reject loop can be demonstrated without a model.
// The generated code is assembled from the chosen designs; every combination typechecks and passes its tests.

import type { EvidenceReference, FileChange, FileSnapshot, FunctionProposal, PlannedFunction, UpcomingFunction } from "../shared/schema";

export const STEP_KEYS = ["store", "key", "wiring", "app", "tests"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
/** 0 is the first design for a step, 1 the alternative. */
export type Choices = Record<StepKey, 0 | 1>;

export const DEFAULT_CHOICES: Choices = { store: 0, key: 0, wiring: 0, app: 0, tests: 0 };

export const SUMMARY =
  "Cache forecasts in memory so repeated requests for the same city skip the slow upstream provider, without changing the response shape.";

/** Proposal ids carry their step: `fn-<step>-<n>`. */
export function stepOf(functionId: string): StepKey | undefined {
  const key = functionId.split("-")[1];
  return STEP_KEYS.find((k) => k === key);
}

/** Each rejection of a step's proposal flips to the other design. */
export function choicesFrom(history: PlannedFunction[]): Choices {
  const choices = { ...DEFAULT_CHOICES };
  for (const fn of history) {
    const step = stepOf(fn.id);
    if (step && fn.status === "rejected") choices[step] = choices[step] === 0 ? 1 : 0;
  }
  return choices;
}

const storeName = (c: Choices) => (c.store === 0 ? "createTtlCache" : "createLruCache");
const cacheDescription = (c: Choices) => (c.store === 0 ? "a 60-second TTL cache" : "an LRU cache (100 entries, 60-second TTL)");

type Draft = Omit<FunctionProposal, "id" | "replacesId">;

export function proposalFor(step: StepKey, c: Choices): Draft {
  switch (step) {
    case "store":
      return c.store === 0
        ? {
            name: "createTtlCache",
            kind: "function",
            path: "src/cache.ts",
            change: "new",
            signature: "createTtlCache<V>(options: { ttlMs: number; now?: () => number }): ForecastCache<V>",
            purpose: "Keeps recent forecasts in memory and forgets each one ttlMs after it was stored.",
            details: [
              "Entries live in a Map keyed by the normalized city name.",
              "Expiry is checked when an entry is read, so no timers run in the background.",
              "The clock (now) can be injected so tests can move time forward.",
              "Memory is not bounded: every distinct city stays until it expires.",
            ],
            calls: [],
            calledBy: [c.wiring === 0 ? "withCache" : "GET /api/weather/:city"],
          }
        : {
            name: "createLruCache",
            kind: "function",
            path: "src/cache.ts",
            change: "new",
            signature: "createLruCache<V>(options: { maxEntries: number; ttlMs: number; now?: () => number }): ForecastCache<V>",
            purpose: "Keeps at most maxEntries recent forecasts in memory, evicting the least recently used one when full; entries also expire after ttlMs.",
            details: [
              "A Map keeps insertion order; reading an entry moves it to the end.",
              "When the cache is full, the first entry (least recently used) is removed.",
              "Entries still expire ttlMs after they are written.",
            ],
            calls: [],
            calledBy: [c.wiring === 0 ? "withCache" : "GET /api/weather/:city"],
          };
    case "key":
      return {
        name: "cacheKey",
        kind: "function",
        path: "src/cache.ts",
        change: "new",
        signature: "cacheKey(city: string): string",
        purpose:
          c.key === 0
            ? "Turns a city name into its cache key, so \"Berkeley\", \"berkeley\" and \" Berkeley \" share one entry."
            : "Turns a city name into its cache key, ignoring case, surrounding spaces and accents, so \"Zürich\" and \"Zurich\" share one entry.",
        details:
          c.key === 0
            ? ["Trims surrounding spaces and lowercases.", "Used for both lookups and writes, so they always agree."]
            : [
                "Trims, lowercases, and strips diacritics with Unicode normalization (NFD).",
                "Used for both lookups and writes, so they always agree.",
              ],
        calls: [],
        calledBy: [c.wiring === 0 ? "withCache" : "GET /api/weather/:city"],
      };
    case "wiring":
      return c.wiring === 0
        ? {
            name: "withCache",
            kind: "function",
            path: "src/cachedUpstream.ts",
            change: "new",
            signature: "withCache(upstream: WeatherUpstream, cache: ForecastCache<Forecast>): WeatherUpstream",
            purpose: "Wraps the forecast provider so repeated requests for a city are answered from the cache; only misses reach the real provider.",
            details: [
              "Looks up cacheKey(city) first and returns the stored forecast on a hit.",
              "On a miss it calls the provider and stores the result.",
              "Failed provider calls are not cached, so the next request tries again.",
              "The route keeps its code: it receives a provider that happens to cache.",
            ],
            calls: ["cacheKey", "ForecastCache.get", "ForecastCache.set", "WeatherUpstream.fetchForecast"],
            calledBy: ["createApp"],
          }
        : {
            name: "GET /api/weather/:city",
            kind: "route",
            path: "src/app.ts",
            change: "change",
            signature: "app.get(\"/api/weather/:city\", handler)",
            purpose: "The weather route checks the cache itself before calling the forecast provider, and stores fresh forecasts.",
            details: [
              "All request handling stays in one place; there is no wrapper module.",
              "Validation still runs first, so invalid names never touch the cache.",
              "Failed provider calls are not cached.",
            ],
            calls: ["cacheKey", "ForecastCache.get", "ForecastCache.set", "WeatherUpstream.fetchForecast"],
            calledBy: ["createApp"],
          };
    case "app":
      return {
        name: "createApp",
        kind: "function",
        path: "src/app.ts",
        change: "change",
        signature:
          c.app === 0
            ? "createApp(deps: { upstream: WeatherUpstream; cache?: ForecastCache<Forecast> })"
            : "createApp(deps: { upstream: WeatherUpstream; cacheTtlMs?: number })",
        purpose:
          c.app === 0
            ? `Creates the Express app with ${cacheDescription(c)}, unless the caller passes its own cache.`
            : `Creates the Express app with ${cacheDescription(c)} whose lifetime comes from deps.cacheTtlMs (60 seconds by default).`,
        details: [
          c.wiring === 0 ? "Wraps deps.upstream with withCache before registering the route." : "Hands the cache to the weather route.",
          c.app === 0 ? "Tests can pass a cache with a fake clock." : "Callers cannot pass their own cache, only its lifetime.",
          "Existing callers (server.ts and the current tests) keep working unchanged.",
        ],
        calls: [storeName(c), ...(c.wiring === 0 ? ["withCache"] : [])],
        calledBy: ["server.ts"],
      };
    case "tests":
      return {
        name: "cache.test.ts",
        kind: "test",
        path: "test/cache.test.ts",
        change: "new",
        signature: "test/cache.test.ts",
        purpose:
          c.tests === 0
            ? "Proves the cache works: one provider call for repeated requests, the same response schema on hits and misses, and the cache module's own rules."
            : "Checks caching only through the HTTP endpoint, so the tests read like the API's behavior rather than the cache's internals.",
        details: testNames(c),
        calls: ["createApp", ...(c.tests === 0 ? [storeName(c), "cacheKey"] : [])],
        calledBy: [],
      };
  }
}

function testNames(c: Choices): string[] {
  const names = ["Repeated requests for a city call the provider once.", "Cached and uncached responses match the WeatherResponse schema."];
  if (c.tests === 0) {
    names.push("Entries expire after the TTL.");
    if (c.store === 1) names.push("The least recently used entry is evicted when the cache is full.");
    names.push("Case and surrounding spaces share one cache entry.");
  } else {
    names.push(c.app === 0 ? "A cache with a zero TTL calls the provider every time." : "cacheTtlMs: 0 calls the provider every time.");
    if (c.store === 1 && c.app === 0) names.push("A full cache evicts the least recently used city.");
  }
  if (c.key === 1) names.push("\"Zürich\" and \"Zurich\" share one cache entry.");
  return names;
}

export function upcomingAfter(index: number, c: Choices): UpcomingFunction[] {
  return STEP_KEYS.slice(index + 1).map((step) => {
    const p = proposalFor(step, c);
    return { name: p.name, summary: p.purpose };
  });
}

export const REWORK_NOTES: Record<StepKey, [string, string]> = {
  // [note after switching to design 1, note after switching back to design 0]
  store: [
    "Switched to a bounded LRU cache so memory can't grow with every new city. createApp now builds it with maxEntries: 100, and the tests add an eviction check.",
    "Back to the plain TTL cache. createApp and the tests no longer mention eviction.",
  ],
  key: [
    "The key now also ignores accents. The tests add a case for \"Zürich\" and \"Zurich\".",
    "Back to the simpler key (case and spaces only). The accent test is gone from the plan.",
  ],
  wiring: [
    "Caching now happens inside the route handler instead of a wrapper around the provider. There is no cachedUpstream.ts; createApp only creates the cache and the route uses it.",
    "Back to wrapping the provider with withCache. The route handler stays as it is.",
  ],
  app: [
    "createApp now takes a cacheTtlMs number instead of a cache object. The expiry test uses cacheTtlMs: 0 instead of a fake clock.",
    "createApp takes an optional cache object again, so tests can use a fake clock.",
  ],
  tests: [
    "The tests now go only through the HTTP endpoint. Checks on the cache module itself are dropped.",
    "The tests again cover the cache module directly as well as the endpoint.",
  ],
};

// ---------------------------------------------------------------- generated code

export function filesFor(c: Choices, context: FileSnapshot[]): FileChange[] {
  const app = context.find((s) => s.path === "src/app.ts");
  if (!app?.exists) throw new Error("src/app.ts is missing, so the fake agent cannot implement the caching demo here.");
  const files: FileChange[] = [{ kind: "create", path: "src/cache.ts", newContent: cacheModule(c) }];
  if (c.wiring === 0) files.push({ kind: "create", path: "src/cachedUpstream.ts", newContent: CACHED_UPSTREAM });
  files.push({ kind: "update", path: "src/app.ts", baseHash: app.contentHash, newContent: appModule(c) });
  files.push({ kind: "create", path: "test/cache.test.ts", newContent: testModule(c) });
  return files;
}

function cacheModule(c: Choices): string {
  const store =
    c.store === 0
      ? `/** Keeps recent values in memory and forgets each one ttlMs after it was stored. */
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
}`
      : `/** Keeps at most maxEntries values, evicting the least recently used, and forgets each one ttlMs after it was stored. */
export function createLruCache<V>(options: { maxEntries: number; ttlMs: number; now?: () => number }): ForecastCache<V> {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: V; expiresAt: number }>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expiresAt <= now()) return undefined;
      // Re-inserting moves the entry to the end: the Map's order is least to most recently used.
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + options.ttlMs });
      if (entries.size > options.maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
    get size() {
      return entries.size;
    },
  };
}`;
  const key =
    c.key === 0
      ? `/** Cities that differ only by case or surrounding spaces share one cache entry. */
export function cacheKey(city: string): string {
  return city.trim().toLowerCase();
}`
      : `/** Cities that differ only by case, surrounding spaces or accents share one cache entry. */
export function cacheKey(city: string): string {
  return city.trim().normalize("NFD").replace(/\\p{Diacritic}/gu, "").toLowerCase();
}`;
  return `export type ForecastCache<V> = {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  readonly size: number;
};

${store}

${key}
`;
}

const CACHED_UPSTREAM = `import { cacheKey, type ForecastCache } from "./cache";
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
`;

/** The cache constructor call; tests leave the value type to inference from createApp's parameter. */
function storeCall(c: Choices, ttl: string, typeArgument = "<Forecast>"): string {
  return c.store === 0
    ? `${storeName(c)}${typeArgument}({ ttlMs: ${ttl} })`
    : `${storeName(c)}${typeArgument}({ maxEntries: 100, ttlMs: ${ttl} })`;
}

function appModule(c: Choices): string {
  const depsType = c.app === 0 ? "{ upstream: WeatherUpstream; cache?: ForecastCache<Forecast> }" : "{ upstream: WeatherUpstream; cacheTtlMs?: number }";
  const created = c.app === 0 ? `deps.cache ?? ${storeCall(c, "60_000")}` : storeCall(c, "deps.cacheTtlMs ?? 60_000");
  const cacheImports = [
    ...(c.wiring === 1 ? ["cacheKey"] : []),
    storeName(c),
    ...(c.app === 0 ? ["type ForecastCache"] : []),
  ].join(", ");
  const imports = [
    `import express from "express";`,
    `import { ${cacheImports} } from "./cache";`,
    ...(c.wiring === 0 ? [`import { withCache } from "./cachedUpstream";`] : []),
    `import { WeatherResponse } from "./schema";`,
    `import type { Forecast, WeatherUpstream } from "./upstream";`,
  ].join("\n");

  const setup =
    c.wiring === 0 ? `  const upstream = withCache(deps.upstream, ${created});` : `  const cache = ${created};`;
  const fetch =
    c.wiring === 0
      ? `      const forecast = await upstream.fetchForecast(city);`
      : `      const key = cacheKey(city);
      let forecast = cache.get(key);
      if (!forecast) {
        forecast = await deps.upstream.fetchForecast(city);
        cache.set(key, forecast);
      }`;

  return `${imports}

export function createApp(deps: ${depsType}) {
  const app = express();
${setup}

  app.get("/api/weather/:city", async (req, res) => {
    const city = req.params.city.trim();
    if (!/^[\\p{L} .'-]{1,64}$/u.test(city)) {
      res.status(400).json({ error: "Invalid city name" });
      return;
    }

    try {
${fetch}
      const body = WeatherResponse.parse({ city, ...forecast, fetchedAt: new Date().toISOString() });
      res.json(body);
    } catch {
      res.status(502).json({ error: "Forecast provider unavailable" });
    }
  });

  return app;
}
`;
}

function testModule(c: Choices): string {
  const unit = c.tests === 0;
  const cacheImports = unit ? ["cacheKey", storeName(c)] : c.app === 0 ? [storeName(c)] : [];
  const imports = [
    `import request from "supertest";`,
    `import { describe, expect, it } from "vitest";`,
    `import { createApp } from "../src/app";`,
    ...(cacheImports.length ? [`import { ${cacheImports.join(", ")} } from "../src/cache";`] : []),
    `import { WeatherResponse } from "../src/schema";`,
    `import { createMockUpstream } from "../src/upstream";`,
  ].join("\n");

  const cases: string[] = [
    `  it("calls the provider once for repeated requests", async () => {
    const upstream = createMockUpstream({ latencyMs: 0 });
    const app = createApp({ upstream });
    await request(app).get("/api/weather/Berkeley");
    await request(app).get("/api/weather/berkeley");
    expect(upstream.calls).toBe(1);
  });`,
    `  it("returns the same schema for cached and uncached responses", async () => {
    const app = createApp({ upstream: createMockUpstream({ latencyMs: 0 }) });
    const miss = await request(app).get("/api/weather/Oakland");
    const hit = await request(app).get("/api/weather/Oakland");
    expect(WeatherResponse.safeParse(miss.body).success).toBe(true);
    expect(WeatherResponse.safeParse(hit.body).success).toBe(true);
    expect(Object.keys(hit.body).sort()).toEqual(Object.keys(miss.body).sort());
  });`,
  ];

  if (unit) {
    cases.push(`  it("forgets entries after the TTL", () => {
    let clock = 0;
    const cache = ${storeName(c)}<number>({ ${c.store === 1 ? "maxEntries: 10, " : ""}ttlMs: 1000, now: () => clock });
    cache.set("k", 1);
    clock = 999;
    expect(cache.get("k")).toBe(1);
    clock = 1000;
    expect(cache.get("k")).toBeUndefined();
  });`);
    if (c.store === 1) {
      cases.push(`  it("evicts the least recently used entry when full", () => {
    const cache = createLruCache<number>({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.size).toBe(2);
  });`);
    }
    cases.push(`  it("shares one entry across case and surrounding spaces", () => {
    expect(cacheKey(" Berkeley ")).toBe(cacheKey("berkeley"));
  });`);
    if (c.key === 1) {
      cases.push(`  it("shares one entry across accents", () => {
    expect(cacheKey("Zürich")).toBe(cacheKey("zurich"));
  });`);
    }
  } else {
    const zeroTtl = c.app === 0 ? `createApp({ upstream, cache: ${storeCall(c, "0", "")} })` : `createApp({ upstream, cacheTtlMs: 0 })`;
    cases.push(`  it("calls the provider every time when entries expire immediately", async () => {
    const upstream = createMockUpstream({ latencyMs: 0 });
    const app = ${zeroTtl};
    await request(app).get("/api/weather/Berkeley");
    await request(app).get("/api/weather/Berkeley");
    expect(upstream.calls).toBe(2);
  });`);
    if (c.store === 1 && c.app === 0) {
      cases.push(`  it("evicts the least recently used city when full", async () => {
    const upstream = createMockUpstream({ latencyMs: 0 });
    const app = createApp({ upstream, cache: createLruCache({ maxEntries: 1, ttlMs: 60_000 }) });
    await request(app).get("/api/weather/Berkeley");
    await request(app).get("/api/weather/Oakland");
    await request(app).get("/api/weather/Berkeley");
    expect(upstream.calls).toBe(3);
  });`);
    }
    if (c.key === 1) {
      cases.push(`  it("shares one entry across accents", async () => {
    const upstream = createMockUpstream({ latencyMs: 0 });
    const app = createApp({ upstream });
    await request(app).get("/api/weather/Z%C3%BCrich");
    await request(app).get("/api/weather/Zurich");
    expect(upstream.calls).toBe(1);
  });`);
    }
  }

  return `${imports}

describe("weather caching", () => {
${cases.join("\n\n")}
});
`;
}

/** Purposes for the demo's existing code that has no doc comment, as a real agent would describe it. */
export const EXISTING_DESCRIPTIONS: Record<string, string> = {
  "src/app.ts#createApp": "Builds the Express app and registers the weather route.",
  "src/app.ts#GET /api/weather/:city":
    "Validates the city name, gets a forecast from the provider and returns it in the WeatherResponse shape; provider failures become 502.",
  "src/server.ts#(module)": "Entry point: starts the API on PORT (3000 by default) with the mock forecast provider.",
  "test/weather.test.ts#(module)": "Baseline endpoint tests: response schema, input validation and provider failures.",
};

export function evidenceFor(step: StepKey): EvidenceReference[] {
  const reference = (path: string, startLine: number, endLine: number, quote: string, rationale: string): EvidenceReference => ({
    path,
    startLine,
    endLine,
    quote,
    rationale,
  });
  switch (step) {
    case "store":
      return [
        reference(
          "src/upstream.ts",
          7,
          7,
          "/** Stand-in for a slow, metered forecast provider. Counts calls so tests can see upstream traffic. */",
          "The current provider is deliberately slow and metered, making repeated calls a useful target for caching.",
        ),
      ];
    case "key":
      return [
        reference(
          "src/app.ts",
          9,
          9,
          "    const city = req.params.city.trim();",
          "The route trims city names before using them, so cache keys should follow the same normalization.",
        ),
      ];
    case "wiring":
      return [
        reference(
          "src/upstream.ts",
          3,
          5,
          "export interface WeatherUpstream {\n  fetchForecast(city: string): Promise<Forecast>;\n}",
          "The provider is expressed as an interface, so a wrapper can preserve the route's dependency shape.",
        ),
        reference(
          "src/app.ts",
          16,
          16,
          "      const forecast = await deps.upstream.fetchForecast(city);",
          "This is the current call site that reaches the upstream provider.",
        ),
      ];
    case "app":
      return [
        reference(
          "src/app.ts",
          8,
          8,
          '  app.get("/api/weather/:city", async (req, res) => {',
          "The route is registered inside createApp, where the caching dependency needs to be wired.",
        ),
        reference(
          "src/app.ts",
          16,
          16,
          "      const forecast = await deps.upstream.fetchForecast(city);",
          "This route currently calls the provider for each valid request.",
        ),
      ];
    case "tests":
      return [
        reference(
          "test/weather.test.ts",
          8,
          14,
          '  it("returns a response that matches the WeatherResponse schema", async () => {\n    const app = createApp({ upstream: createMockUpstream({ latencyMs: 0 }) });\n    const res = await request(app).get("/api/weather/Berkeley");\n\n    expect(res.status).toBe(200);\n    expect(WeatherResponse.safeParse(res.body).success).toBe(true);\n    expect(res.body.city).toBe("Berkeley");',
          "Existing endpoint tests assert the response schema and city, which should remain true for cached and uncached requests.",
        ),
      ];
  }
}
