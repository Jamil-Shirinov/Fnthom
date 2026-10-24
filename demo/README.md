# Demo target and walkthrough

The small application the agent modifies lives here, separate from the extension source. The scenario is adding API caching to a weather endpoint, in TypeScript with Express and Vitest (see [the decision record](../agents/decisions.md)).

- `app/`: baseline Express API with a slow mocked forecast provider and no cache. Its tests check the response schema, input validation and provider failures. `app/.vscode/settings.json` configures the `demo-tests` check the extension may run.
- The fake agent's scripted plan for this app lives in `src/agent/fakeScenario.ts`: five functions, each with two designs. Every combination of accepted and rejected designs was checked against this baseline: the app typechecks and its tests pass.

```bash
cd demo/app
npm install
npm test       # 3 baseline tests
npm start      # http://localhost:3000/api/weather/Berkeley
```

To restore the baseline after a demo run, use `npm run demo:reset` from the repository root. It restores only `demo/app/` from the last commit and removes untracked files under `demo/app/src` and `demo/app/test`.

Use synthetic data and keep credentials outside the repository. The step-by-step tester guide is [walkthrough.md](walkthrough.md). See [the MVP demo story](../agents/mvp.md).
