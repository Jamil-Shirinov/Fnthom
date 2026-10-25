// Builds a local demo website in site/: a landing page (index.html) around the real Fnthom panel (app.html).
// The panel is the extension's webview bundle running on its browser mock host and the scripted demo agent,
// inlined into one file so both pages open straight from disk, no server needed.

import { build } from "vite";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const site = path.join(root, "site");
const temp = path.join(site, ".build");

rmSync(site, { recursive: true, force: true });
await build({
  configFile: path.join(root, "webview/vite.config.ts"),
  logLevel: "warn",
  build: { outDir: temp, emptyOutDir: true },
});

const assets = path.join(temp, "assets");
const extra = readdirSync(assets).filter((f) => f !== "index.js" && f !== "index.css");
if (extra.length) throw new Error(`Unexpected assets that would not be inlined: ${extra.join(", ")}`);
const js = readFileSync(path.join(assets, "index.js"), "utf8").replace(/<\/script/gi, "<\\/script");
const css = readFileSync(path.join(assets, "index.css"), "utf8").replace(/<\/style/gi, "<\\/style");

const app = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fnthom panel</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${js}</script>
  </body>
</html>
`;

const logo = readFileSync(path.join(root, "media/icon.png")).toString("base64");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const request = "Add caching so repeated weather requests do not hit the upstream forecast provider";

const index = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fnthom</title>
    <link rel="icon" href="data:image/png;base64,${logo}" />
    <style>
      :root { --bg: #f6f6f4; --fg: #141414; --muted: #5c5c5c; --line: #dcdcd8; --card: #ffffff; --accent: #3794ff; }
      @media (prefers-color-scheme: dark) {
        :root { --bg: #111111; --fg: #f0f0f0; --muted: #a0a0a0; --line: #2c2c2c; --card: #1a1a1a; }
        .logo { filter: invert(1); }
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { max-width: 1240px; margin: 0 auto; padding: 40px 16px 56px; }
      header { display: flex; align-items: center; gap: 16px; }
      .logo { width: 56px; height: 56px; border-radius: 12px; mix-blend-mode: multiply; }
      @media (prefers-color-scheme: dark) { .logo { mix-blend-mode: screen; } }
      h1 { font-size: 40px; letter-spacing: -0.02em; margin: 0; }
      .tagline { font-size: 20px; margin: 20px 0 8px; max-width: 760px; }
      .sub { color: var(--muted); margin: 0 0 28px; max-width: 760px; }
      .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 32px; }
      .feature { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
      .feature b { display: block; margin-bottom: 4px; }
      .feature span { color: var(--muted); font-size: 14px; }
      .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
      .bar button { font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
      .bar button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
      .bar .spacer { flex: 1; }
      .hint { color: var(--muted); font-size: 14px; margin: 0 0 10px; }
      .hint code { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; font-size: 13px; cursor: copy; }
      .frame { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: #1e1e1e; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18); }
      .frame__top { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: #2d2d2d; color: #c8c8c8; font-size: 12px; }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: #5a5a5a; }
      .frame__top span { margin-left: 8px; }
      iframe { display: block; width: 100%; height: 820px; border: 0; }
      footer { color: var(--muted); font-size: 13px; margin-top: 16px; }
      @media (max-width: 640px) { h1 { font-size: 32px; } iframe { height: 720px; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <img class="logo" src="data:image/png;base64,${logo}" alt="" />
        <h1>Fnthom</h1>
      </header>
      <p class="tagline">Plan with an AI coding agent one function at a time, then see how it all connects.</p>
      <p class="sub">Fnthom is a VS Code extension. The agent proposes each function before any code exists; you accept it or say what to change. Only when the plan is done does it write the code, run the tests and draw a map of your functions.</p>

      <section class="features">
        <div class="feature"><b>One function at a time</b><span>Name, file, signature, how it works and who calls it, before a line is written.</span></div>
        <div class="feature"><b>Rework with a reason</b><span>Say what's wrong and the agent replans everything that depends on it.</span></div>
        <div class="feature"><b>A live map</b><span>Accepted functions appear on the graph right away; click any box to see its code.</span></div>
        <div class="feature"><b>Zoom like a map</b><span>Zoom out and related functions merge into named groups, so big projects stay readable.</span></div>
      </section>

      <div class="bar">
        <button type="button" data-src="app.html" aria-pressed="true">Weather app demo</button>
        <button type="button" data-src="app.html?large" aria-pressed="false">Large project (zoom out on the Graph tab)</button>
        <span class="spacer"></span>
        <button type="button" id="restart">Restart demo</button>
      </div>
      <p class="hint">Try it: type <code id="request" title="Click to copy">${request}</code> and click <b>Plan it</b>, then rework the first function with "memory has to stay bounded".</p>

      <div class="frame">
        <div class="frame__top"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span>Fnthom panel in VS Code</span></div>
        <iframe id="panel" src="app.html" title="Fnthom panel"></iframe>
      </div>
      <footer>Runs the scripted demo agent in your browser; nothing is sent anywhere. Fnthom ${version}.</footer>
    </main>
    <script>
      const panel = document.getElementById("panel");
      const tabs = document.querySelectorAll("[data-src]");
      tabs.forEach((tab) => tab.addEventListener("click", () => {
        tabs.forEach((t) => t.setAttribute("aria-pressed", String(t === tab)));
        panel.src = tab.dataset.src;
      }));
      document.getElementById("restart").addEventListener("click", () => { panel.src = panel.getAttribute("src"); });
      document.getElementById("request").addEventListener("click", (e) => {
        navigator.clipboard?.writeText(e.target.textContent).catch(() => {});
      });
    </script>
  </body>
</html>
`;

mkdirSync(site, { recursive: true });
writeFileSync(path.join(site, "app.html"), app);
writeFileSync(path.join(site, "index.html"), index);
rmSync(temp, { recursive: true, force: true });
console.log(`Wrote ${path.relative(root, site)}/index.html and app.html. Open site/index.html in a browser.`);
