# Repository and editor integration

Implement context collection, proposed-change previews, applying edits, source navigation, and relevant check execution here.

Suggested first modules: `context.ts`, `edits.ts`, and `sourceLinks.ts`. Add preview/check helpers as the real workflow requires them.

Read unsaved document contents where applicable. Associate proposals with source versions, reject stale edits, and refresh graph references after changes. Report actual check results rather than inferring success from model output.

Keep Droid prompts in `src/agent/` and portable payload schemas in `src/shared/`.
