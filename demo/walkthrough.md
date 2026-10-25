# Tester walkthrough

This guide takes you through the whole flow on the caching demo in about five minutes. The agent is a scripted fake (`humanCenteredAgent.useFakeAgent` is on by default). It proposes five functions and has two designs for each, so rejecting a function shows a real rework of the plan.

## Set up once

You need VS Code 1.90 or later and Node.js 20 or later, with `npm` on your PATH.

1. Get the repository and install the demo's dependencies:

   ```bash
   git clone https://github.com/Jamil-Shirinov/calhacks-13.0.git   # or: git pull in your existing clone
   cd calhacks-13.0/demo/app
   npm install
   npm test      # 3 tests pass on the baseline
   ```

   If you tried an earlier version, run `npm run demo:reset` from the repository root first so the demo starts without a cache.

2. Install the extension, either from a prebuilt file:

   ```bash
   code --install-extension path/to/human-centered-agent-0.2.1.vsix --force
   ```

   or by building it from the repository root with `npm install && npm run package` (this writes `human-centered-agent-0.2.1.vsix` there). In VS Code you can also use **Extensions › ⋯ › Install from VSIX…**. Reload the window after installing over an older version.

3. Open the `demo/app` folder itself in VS Code (`code .` from inside it), not the repository root. Trust the workspace when VS Code asks.

## Plan, implement, explore

1. Press Cmd/Ctrl+Shift+P and run **Human-Centered Agent: Open Panel**. The panel opens beside the editor.
2. Optional: open the **Graph** tab to see the demo before any changes (createApp, the weather route, the mock provider, and the server entry point). The panel has two tabs, **Decisions** and **Graph**, and you can switch between them at any time.
3. Keep the prefilled request and click **Plan it**. The first proposal appears: `createTtlCache`, with its purpose, how it works, its signature and file, and what calls it. The list below it shows the functions the agent expects to propose next.
4. Click **✕ Rework…**, type a reason such as "memory has to stay bounded", and click **Rework**. The agent proposes `createLruCache` instead and explains what it changed. Look at the upcoming list: `createApp` now mentions an LRU cache and the tests add an eviction check.
5. Click **✓ Accept** for the next functions. After each acceptance, open the **Graph** tab: the accepted functions appear as dashed boxes with faded arrows, because they are planned but not written yet. Try rejecting `withCache` too: the agent switches to caching inside the route, and the plan no longer has a `cachedUpstream.ts` file.
6. After the last acceptance, the extension writes all the code at once, runs `npm test` in the demo, and switches to the Graph tab. The dashed boxes become real functions.
7. Click any box in the graph. A pop-up explains what the function does and where that explanation came from, and the function opens in an editor tab with its lines highlighted. Green borders are new functions; yellow borders are changed ones. Arrow colors show the kind of connection: blue for a direct call, purple dashed for a call through an interface, and orange dotted for a route registration. The **What the arrows mean** legend at the top-right of the graph explains them; close it with × and reopen it with **Arrow colors**.
8. In the side panel, click **Diff** next to a file to see it before and after, and **Export as Markdown** to save the decisions and the graph.

## Things worth trying

- **Leave a file unsaved.** Before your last acceptance, make an unsaved edit to `src/app.ts`. Nothing is written; the panel asks you to save or revert, then **Try again**.
- **Edit code afterwards.** Add a few lines above a function and save. The graph rebuilds, and clicking the node still highlights the right lines.
- **Break a test.** After implementing, change an expected value in `test/weather.test.ts`, save, and click **Rerun checks**. The failure and its output appear next to the graph; the code is kept.
- **Zoom out.** Scroll out on the graph. Past a certain zoom, related functions shrink into named circles, with one arrow per pair of groups. Click a circle, or zoom back in, to see its functions. It matters most on large projects.
- **Show test files.** Tick the box in the side panel to add the test files to the graph and see which functions they exercise.

## Start over

**Reset** in the panel (or **Human-Centered Agent: Reset Session**) clears the session; source files are not touched. To restore the demo's files, run this from the repository root:

```bash
npm run demo:reset
```

It restores `demo/app/` from the last commit and removes untracked files under `demo/app/src` and `demo/app/test`. Delete an exported Markdown file yourself.

## If something goes wrong

- **"The fake agent only knows the weather demo"**: open the `demo/app` folder, not the repository root.
- **The check fails with "spawn npm ENOENT"**: VS Code cannot find `npm`. Start VS Code from a terminal where `npm` works (`code .`), or set the check's `executable` to the full path of `npm` in `demo/app/.vscode/settings.json`.
- **Anything else**: open **Help › Toggle Developer Tools**, check the console, and note what you clicked.
