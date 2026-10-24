# Demo target and walkthrough

Keep the small application the agent will modify here, separate from the extension source. The recommended scenario is adding API caching; the target language/framework is still open.

Once selected, put the baseline app under `demo/app/`, any mocked graph/proposal payloads under `demo/fixtures/`, and the walkthrough in `demo/walkthrough.md`. Create those folders when there is real content to add.

Document a repeatable way to restore the baseline and verify cache behavior and response schema consistency. Demo resets must affect only the intended fixture. Do not reset the main project or overwrite teammates' work.

Use synthetic data and keep credentials outside the repository. See [the MVP demo story](../agents/mvp.md).
