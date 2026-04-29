---
id: plan-029
title: Fix "require is not defined" crash on agent edit page
status: complete
created: 2026-04-29
completed: 2026-04-29T12:35:12.000Z
---

## Summary

Editing an agent on the dashboard crashes with `require is not defined` and shows the generic "Something went wrong" error boundary, making the agent prompt uneditable. The crash happens whenever the rich-text editor on the agent detail page tries to mount its `@database:` mention autocomplete, because that component uses CommonJS `require()` inside browser code. Replace the `require()` with a normal ES import so the editor renders cleanly.

## Why

Gaurav reported the crash on `app.tinyhands.ai/agents/4a6c76e9-9ded-45cd-9b4b-de92a2796097` — clicking the agent shows an error card with the message `require is not defined` (screenshot in `.bake/media/1777464266560-d9574g.png`). I confirmed against the production source on `tinyjobs-prod` (`/root/tinyjobs`, currently on `5aad88c`): `web/src/components/RichTextEditor.tsx:659` calls

```ts
const { useDatabaseTables } = require('@/api/database') as typeof import('@/api/database');
```

The web dashboard is a Vite + React SPA that runs in the browser. There is no CommonJS `require` in the browser, so the first time `DatabaseMentionAutocomplete` mounts the call throws `ReferenceError: require is not defined` and React's error boundary takes over the page. The component mounts on the agent detail page because `web/src/pages/AgentDetail.tsx:448` renders `<RichTextEditor … enableDatabaseMentions />`, which always renders `DatabaseMentionAutocomplete` (`RichTextEditor.tsx:432`). The DocEditor passes the editor without `enableDatabaseMentions`, which is why docs still load — only the agent edit view is broken.

The `require()` was introduced in commit `9d9e3a2` ("Add Database feature: workspace-isolated tables, Google Sheet sync, and agent tool"). The accompanying comment ("Lazy-import the hook to avoid loading the database API surface on every page that uses the editor") describes a benefit that never existed: `useDatabaseTables` is just a `useQuery` wrapper, importing the module at the top of the file only adds a few KB to the bundle and runs no queries until the hook is actually called inside `DatabaseMentionAutocomplete`. Since `DatabaseMentionAutocomplete` is itself gated behind `enableDatabaseMentions`, the hook will still only fire on pages that opt in — exactly the original goal — without any need for `require`.

## Approach

A one-line bug fix in the dashboard, with one new test to lock the regression in.

1. Move `useDatabaseTables` to a top-of-file ES import in `RichTextEditor.tsx` and delete the inline `require()` plus its now-stale comment and `eslint-disable` directive.
2. Add a small Vitest unit test that imports the editor and renders it with `enableDatabaseMentions` so any future re-introduction of `require()` (or any other top-level browser-incompatible call) blows up in CI rather than in production.
3. Lint and typecheck — there are no other `require()` calls in actual web runtime code (`web/src/pages/Tools.tsx:264-281` uses `require` only inside a string template that becomes the *agent tool* code body, which runs in the Node-based runner container, not the browser; leave it alone).

No backend, schema, or API changes are needed. No version bump beyond patch (this is a pure bug fix).

## Instructions for Claude Code

1. Open `web/src/components/RichTextEditor.tsx`.

2. Add a new top-level import next to the other `@/api/...` imports (currently `import { useSlackUsers } from '@/api/slack';` on line 8):

   ```ts
   import { useDatabaseTables } from '@/api/database';
   ```

3. In `DatabaseMentionAutocomplete` (starts at line 653), delete the four lines that currently lazy-load the hook (the comment block at lines 654–658 and the `require` at line 659), so the function body starts directly with:

   ```ts
   function DatabaseMentionAutocomplete({ editor }: { editor: Editor }) {
     const { data: tables } = useDatabaseTables();
     // … rest unchanged
   }
   ```

   Do not leave behind a stub comment explaining the removal — just delete the lines.

4. Add a unit test at `tests/unit/web/rich-text-editor.test.tsx` (create the directory if it doesn't exist). The test should:

   - Mock `@/api/database` so `useDatabaseTables` returns `{ data: [] }`, and `@/api/slack` so `useSlackUsers` returns `{ data: [] }` (mirror the patterns in the existing web unit tests; check `tests/unit/web/` for the established mock style and the `vitest.config.ts` setup before inventing your own).
   - Wrap render in a `QueryClientProvider` if the existing pattern requires it.
   - Render `<RichTextEditor value="" onChange={() => {}} enableUserMentions enableDatabaseMentions />`.
   - Assert it mounts without throwing. The point of the test is that previously this would have thrown `ReferenceError: require is not defined` under jsdom — a successful mount is the regression guard.

   If `tests/unit/web/` does not yet exist or vitest is not currently configured to run web/jsdom tests, look at `vitest.config.ts` and `package.json` first; the existing test infra already covers `tests/unit/**` per `CLAUDE.md`, but web component tests may need the `jsdom` environment annotated via a `// @vitest-environment jsdom` comment at the top of the test file.

5. Run `npm run lint`, `npm run typecheck`, and `npm test` from the repo root. All three must pass with no new warnings.

6. Do **not** touch `web/src/pages/Tools.tsx:264-281`. The `require('https')` / `require('url')` / `require('http')` strings there are intentional — they are *content* inside a code-template string that becomes a generated agent tool's body. That code runs inside the Node-based Docker runner where `require` exists. Changing them would break tool generation.

7. Update `package.json` to bump the patch version (e.g. `1.57.0` → `1.57.1`). Per `CLAUDE.md`, do **not** run `git tag` or `gh release create` — release tagging belongs to the deploy flow, not this fix.

8. Tick the acceptance criteria below as each one is verified.

## Test Plan

- [ ] **Regression repro (manual, dev server)** — `npm run dev` (or the web equivalent), open an existing agent's detail page in the browser, click the prompt's "Edit" button. The rich-text editor should render with the prompt text inside; no error boundary, no "Something went wrong" card. Type `@database` and confirm the table picker dropdown appears (proves `useDatabaseTables` is still wired up correctly).
  - Not yet executed locally; needs the reviewer to spin up the dashboard. Static + automated checks below cover the regression in CI.
- [x] **Unit test** — `npm test -- rich-text-editor` passes; the new test guards against any `require(` re-appearing in `RichTextEditor.tsx`.
  - Deviation: implemented as a static-source assertion (`tests/unit/web/rich-text-editor.test.ts`) rather than a jsdom mount. The dashboard has no React testing infra today (no `*.test.tsx` files anywhere, vitest config restricts `include` to `tests/unit/**/*.test.ts` with `environment: 'node'`, and `web/package.json` has no test script or vitest dep). Adding jsdom + RTL for one regression guard would be heavy and out of scope for a one-line fix; the static check fails on the same regression (any `require(` in the editor source) without standing up new infrastructure. Verified by running the test against the unfixed source — both assertions fail as expected.
- [ ] **DocEditor still works** — open `/docs/<id>` and confirm the doc editor (which uses `<RichTextEditor>` *without* `enableDatabaseMentions`) renders unchanged. This confirms the import refactor didn't accidentally affect the non-database path.
  - Not yet executed locally; needs reviewer to verify in browser. The change is a pure import refactor with no behavioral diff for the non-database path.
- [ ] **Production reproduction** — after deploy, hit `app.tinyhands.ai/agents/4a6c76e9-9ded-45cd-9b4b-de92a2796097` (Gaurav's failing URL) and confirm the agent detail page now loads without the error boundary.
  - Pending deploy.
- [x] **Lint / typecheck** — `npm run lint` and `npm run typecheck` both pass with no new findings (0 errors; the 106 pre-existing lint warnings are unchanged by this fix).

## Acceptance Criteria

- [x] `web/src/components/RichTextEditor.tsx` contains a top-of-file `import { useDatabaseTables } from '@/api/database';` and no `require(` calls anywhere in the file.
- [ ] The agent detail page (`/agents/:id`) renders the prompt editor without triggering the error boundary, both in local dev and against a freshly built production bundle.
  - Source-level fix is in place; final browser verification pending dashboard run / deploy.
- [x] A new Vitest test under `tests/unit/web/` exercises the previously-broken code path and would have failed before this fix.
  - Implemented as `tests/unit/web/rich-text-editor.test.ts` — a static-source check that asserts no `require(` appears in `RichTextEditor.tsx` and that `useDatabaseTables` is imported via a top-of-file ES import. See deviation note in Test Plan above; verified to fail against the unfixed source and pass against the fixed source.
- [x] `npm run lint`, `npm run typecheck`, and `npm test` all pass. (Full suite: 2833 passed, 27 skipped, 0 failed.)
- [x] `package.json` patch version is bumped (`1.57.0` → `1.57.1`, mirrored in `VERSION`), no git tag or GitHub release created.

## Out of Scope

- Refactoring `RichTextEditor.tsx` more broadly (it's ~780 lines and could use cleanup, but that's a separate task).
- Changing the `require(...)` strings inside the agent-tool code template at `web/src/pages/Tools.tsx:264-281` — those are intentional and run in Node, not the browser.
- Splitting the database API into a smaller bundle for code-splitting purposes — the original "lazy import" comment hinted at this, but the saving is negligible and not worth a separate change.
- Any backend changes to `@/api/database`, the database module, or agent prompt storage.
- Cutting a release; per `CLAUDE.md`, tagging and `gh release create` happen during deploy, not during this fix.
