// A made-up online shop of about a hundred functions in eight features, for testing and previewing how the
// graph handles a large project. Each feature lives in its own folder and mostly calls itself; routes and a few
// features (orders, checkout) reach across. Used by tests/clusters.test.ts and `npm run preview:fixture`.

type Feature = { folder: string; files: Record<string, string[]> };

const FEATURES: Feature[] = [
  { folder: "auth", files: { session: ["createSession", "endSession", "sessionById", "refreshSession"], password: ["hashPassword", "verifyPassword", "passwordStrength"], token: ["signToken", "verifyToken", "tokenExpiry"] } },
  { folder: "catalog", files: { products: ["listProducts", "productById", "productSlug", "productImages"], search: ["searchProducts", "rankResults", "searchFacets", "spellSuggest"], pricing: ["priceFor", "salePrice", "currencyRound"] } },
  { folder: "cart", files: { cart: ["addToCart", "removeFromCart", "cartItems", "clearCart", "cartTotal"], coupons: ["applyCoupon", "couponValid", "couponDiscount"] } },
  { folder: "billing", files: { invoice: ["createInvoice", "invoiceLines", "invoicePdf", "invoiceNumber"], payments: ["chargeCard", "refundPayment", "paymentStatus", "captureAuthorization"], tax: ["taxFor", "taxRegion", "taxExempt"] } },
  { folder: "orders", files: { orders: ["placeOrder", "cancelOrder", "orderStatus", "orderHistory"], shipping: ["shipOrder", "shippingRates", "trackingUrl", "packageWeight"] } },
  { folder: "inventory", files: { stock: ["stockLevel", "reserveStock", "releaseStock", "restockAlert"], warehouses: ["nearestWarehouse", "warehouseById", "transferStock"] } },
  { folder: "notifications", files: { email: ["sendEmail", "renderTemplate", "emailFooter", "unsubscribeLink"], sms: ["sendSms", "smsAllowed"], queue: ["queueMessage", "drainQueue", "retryFailed"] } },
  { folder: "analytics", files: { events: ["trackEvent", "flushEvents", "eventSchema", "sampleRate"], reports: ["dailyRevenue", "topProducts", "conversionRate"] } },
];

/** Cross-feature calls: caller -> callees in other features. */
const CROSS: Record<string, string[]> = {
  placeOrder: ["cartItems", "cartTotal", "createInvoice", "chargeCard", "reserveStock", "queueMessage", "trackEvent", "verifyToken"],
  cancelOrder: ["refundPayment", "releaseStock", "queueMessage"],
  shipOrder: ["nearestWarehouse", "sendEmail"],
  cartTotal: ["priceFor", "taxFor"],
  addToCart: ["stockLevel", "trackEvent"],
  createInvoice: ["priceFor"],
  restockAlert: ["sendEmail"],
  topProducts: ["listProducts"],
  dailyRevenue: ["paymentStatus"],
  searchProducts: ["trackEvent"],
  createSession: ["trackEvent"],
};

const ROUTES: Array<[string, string, string]> = [
  ["post", "/login", "createSession"],
  ["post", "/logout", "endSession"],
  ["get", "/products", "listProducts"],
  ["get", "/products/:slug", "productById"],
  ["get", "/search", "searchProducts"],
  ["post", "/cart", "addToCart"],
  ["delete", "/cart/:id", "removeFromCart"],
  ["post", "/orders", "placeOrder"],
  ["delete", "/orders/:id", "cancelOrder"],
  ["get", "/orders/:id", "orderStatus"],
  ["get", "/reports/revenue", "dailyRevenue"],
];

export function largeProject(): Array<{ path: string; content: string }> {
  const fileOf = new Map<string, string>();
  for (const f of FEATURES) for (const [file, fns] of Object.entries(f.files)) for (const fn of fns) fileOf.set(fn, `src/${f.folder}/${file}`);

  const out: Array<{ path: string; content: string }> = [];
  for (const feature of FEATURES) {
    const files = Object.entries(feature.files);
    files.forEach(([file, fns], fileIndex) => {
      const here = `src/${feature.folder}/${file}`;
      // Inside a feature, each function calls the next one in its file, and the first function of the next file.
      const nextFile = files[(fileIndex + 1) % files.length]![1][0]!;
      const calls = (fn: string, i: number) => {
        const local = [fns[i + 1], i === 0 && files.length > 1 ? nextFile : undefined].filter((c): c is string => !!c && c !== fn);
        return [...local, ...(CROSS[fn] ?? [])];
      };
      const imported = new Map<string, Set<string>>();
      fns.forEach((fn, i) => {
        for (const c of calls(fn, i)) {
          const target = fileOf.get(c)!;
          if (target === here) continue;
          if (!imported.has(target)) imported.set(target, new Set());
          imported.get(target)!.add(c);
        }
      });
      const imports = [...imported].map(([target, names]) => `import { ${[...names].sort().join(", ")} } from "${relative(here, target)}";`);
      const bodies = fns.map((fn, i) => {
        const body = calls(fn, i).map((c) => `  ${c}(input);`).join("\n");
        return `/** ${sentence(fn)}. */\nexport function ${fn}(input: unknown): unknown {\n${body}${body ? "\n" : ""}  return input;\n}\n`;
      });
      out.push({ path: `${here}.ts`, content: [...imports, "", ...bodies].join("\n") });
    });
  }

  const routeImports = new Map<string, Set<string>>();
  for (const [, , fn] of ROUTES) {
    const target = fileOf.get(fn)!;
    if (!routeImports.has(target)) routeImports.set(target, new Set());
    routeImports.get(target)!.add(fn);
  }
  const routes = [
    `import express from "express";`,
    ...[...routeImports].map(([target, names]) => `import { ${[...names].sort().join(", ")} } from "${relative("src/server", target)}";`),
    "",
    "/** Creates the HTTP app with every route of the shop. */",
    "export function createServer() {",
    "  const app = express();",
    ...ROUTES.map(([method, path, fn]) => `  app.${method}("${path}", (req: any, res: any) => res.json(${fn}(req.body)));`),
    "  return app;",
    "}",
    "",
  ].join("\n");
  out.push({ path: "src/server.ts", content: routes });
  return out;
}

function relative(from: string, to: string): string {
  const a = from.split("/").slice(0, -1);
  const b = to.split("/");
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => "..");
  const path = [...up, ...b.slice(i)].join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

function sentence(name: string): string {
  const text = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
