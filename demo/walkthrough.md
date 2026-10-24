# Tester walkthrough

This guide takes you through the full loop on the caching demo in about five minutes. The agent is the deterministic fake (`humanCenteredAgent.useFakeAgent` is on by default), so every run proposes the same three steps.

## Set up once

You need VS Code 1.90 or later and Node.js 20 or later, with `npm` on your PATH.

1. Clone the repository and install the demo's dependencies:

   ```bash
   git clone https://github.com/Jamil-Shirinov/calhacks-13.0.git
   cd calhacks-13.0/demo/app
   npm install
   npm test      # 3 tests pass on the baseline
   ```

2. Install the extension. Either use a prebuilt `human-centered-agent-0.0.1.vsix`:

   ```bash
   code --install-extension path/to/human-centered-agent-0.0.1.vsix
   ```

   or build it yourself from the repository root with `npm install && npm run package`. In VS Code you can also use **Extensions › ⋯ › Install from VSIX…**.

3. Open the `demo/app` folder itself in VS Code (`code .` from inside it), not the repository root. The check the extension runs is configured in `demo/app/.vscode/settings.json`. Trust the workspace when VS Code asks; the extension will not apply edits or run checks in an untrusted workspace.

## Run the loop

1. Open the Command Palette (Cmd/Ctrl+Shift+P) and run **Human-Centered Agent: Open Panel**. The panel opens beside the editor.
2. Keep the prefilled feature request, or type your own, and click **Show the plan**. The map shows five components: the weather endpoint, cache lookup, the upstream call, cache write, and response shaping. Click a component to see its purpose, inputs, outputs, claims and source. Click a source link to jump to that code.
3. Click **Start first step**. The panel shows what the step does and why, its inputs and outputs, and the files it will touch.
4. Click **Preview diff** next to a file. VS Code's diff editor shows the current file against the proposal. Nothing has been written yet.
5. Optionally ask a question in **Ask about this step**. The fake agent gives a canned answer.
6. Click **Apply & Continue**. The extension writes and saves the files, runs `npm test` in the demo, records the result under **Checks**, and proposes the next step.
7. Repeat for steps two and three. After the last step the panel says **Feature complete**, the "cached and uncached responses share a schema" claim shows **Supported**, and the demo has 6 passing tests.
8. Click **Export feature reference** and save `feature-reference.md`. It contains a Mermaid diagram of the map, the steps, and the check results.

## Things worth trying

- **Edit a file during a proposal.** While a step is waiting for review, change and save a file it touches. The proposal is retired and the panel asks you to regenerate it, because the diff you reviewed is no longer what would be applied.
- **Leave a file unsaved.** Make an unsaved edit to a file the step touches, then click Apply & Continue. The extension stops and asks you to save or revert first.
- **Break a test.** While step two is waiting for review, change an expected value in `demo/app/test/weather.test.ts` and save it, then click Apply & Continue. The check fails, the loop pauses with **Rerun checks** and **Continue anyway**, and the applied code is kept. Undo your edit and click Rerun checks to recover.
- **Revise the approach.** Expand **Revise the approach** and send an instruction. Applied steps stay; the fake agent records the instruction as an assumption.

## Start over

Run **Human-Centered Agent: Reset Session** to clear the plan (source files are not touched). To restore the demo's files, run this from the repository root:

```bash
npm run demo:reset
```

It restores `demo/app/` from the last commit and removes untracked files under `demo/app/src` and `demo/app/test`. Delete an exported `feature-reference.md` yourself.

## If something goes wrong

- **The check fails with "spawn npm ENOENT"**: VS Code cannot find `npm`. Start VS Code from a terminal where `npm` works (`code .`), or set the check's `executable` to the full path of `npm` in `demo/app/.vscode/settings.json`.
- **"Open a folder to begin"**: open `demo/app` as a folder first, then reopen the panel.
- **Anything else**: open **Help › Toggle Developer Tools** and check the console, and note what you clicked. The panel itself was checked in a browser preview and the bundled extension was run against a stubbed VS Code API, but this build has not yet been run inside a real VS Code window.
