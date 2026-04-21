---
id: plan-019
title: Audit and harden remaining getDefaultWorkspaceId() fallback call sites
status: draft
created: 2026-04-21
---

## Summary

Sweep every remaining `getDefaultWorkspaceId()` call in non-internal code paths — primarily the ~60 `body.team?.id || getDefaultWorkspaceId()` fallbacks in `src/slack/{commands,events,actions}.ts` and the unscoped calls in `src/sync.ts` — and either (a) replace the fallback with an explicit error when tenant context is missing, or (b) prove via the upstream contract that the fallback is unreachable and delete it. The goal is to eliminate the "silently route to the default tenant" failure mode that caused the KB isolation bug fixed in v1.50.5.

## Why

v1.50.5 fixed 13 `/internal/kb/*` and `/internal/docs/*` endpoints that hardcoded `getDefaultWorkspaceId()`. The bug was discovered because ARK KB in Splitsie (workspace `T01PFPBDGT0`) reported "knowledge base is empty" — the internal KB search was actually running against CometChat's 2945-entry KB under the default workspace, and the agent_id filter hid the cross-tenant rows.

The same pattern exists elsewhere:

- `grep -c 'getDefaultWorkspaceId()' src/` returns ~80 call sites.
- Most are `body.team?.id || getDefaultWorkspaceId()` in Slack handlers. In the happy path, Slack always delivers `team.id`, so the fallback is dead. But if an upstream ever forwards a stripped payload, a webhook stub misses the header, or a future refactor introduces a code path without `body`, the fallback will silently route the request to the default tenant — the exact failure mode that cost us a day this week.
- A few calls in `src/sync.ts` use `getDefaultWorkspaceId()` with no fallback at all (lines 81, 111, 137). These run in the sync process and predate multi-tenant. For each: either they should iterate over *all* workspaces, or they should be deleted.

The cost of the fallback is asymmetric: it prevents at most a crash when tenant context is missing, but when it fires it silently cross-leaks tenant data. Flipping the default from "fall back" to "fail loudly" is the right multi-tenant posture.

## Approach

1. **Inventory** every remaining `getDefaultWorkspaceId()` / `getDefaultWorkspaceIdOrNull()` call site and classify each one:
   - **A. Required by contract** — the caller is guaranteed to have tenant context; fallback is dead code.
   - **B. Optional fallback** — the caller might legitimately run without tenant context (e.g., sync tick, bootstrap), but only against the default workspace.
   - **C. Legacy single-tenant** — the code predates multi-tenant and should iterate all workspaces or be deleted.
   - **D. Wrong** — the fallback is silently masking a bug like v1.50.5.

2. **Replace (A) with explicit errors.** If tenant context is missing where it was guaranteed, it's a bug; throwing is better than picking a random tenant. Use `throw new Error('workspaceId required')` or a typed `TenantContextMissingError`.

3. **Replace (C) with per-workspace iteration or deletion.** The sync process should iterate every `workspaces` row and sync each independently.

4. **Fix (D) with the v1.50.5 pattern** — thread workspace through the call chain.

5. **Keep (B) as-is,** but annotate each with a short comment explaining *why* the default fallback is correct.

6. **Add a lint guard.** A custom ESLint rule or test that fails the build if `getDefaultWorkspaceId()` is introduced in new code under `src/server.ts` (internal endpoints) or `src/modules/**` without an `// allow-default-workspace:` comment justifying it.

## Instructions for Claude Code

1. Run `Grep` for `getDefaultWorkspaceId` across `src/` and build a table: file, line, call site, caller's upstream contract, classification (A/B/C/D).
2. Start with the highest-risk category: `src/sync.ts` lines 81, 111, 137. Trace what each sync loop does. If it's meant to sync data for one tenant, lift it into an `async for (const ws of listWorkspaces())` loop.
3. Move to `src/slack/commands.ts`, `src/slack/events.ts`, `src/slack/actions.ts`. Each `body.team?.id || getDefaultWorkspaceId()` should become `body.team?.id ?? (() => { throw new Error('Slack payload missing team.id'); })()`, OR if the call can legitimately be invoked outside Slack (e.g., from a test harness), keep the fallback and add an inline comment explaining that.
4. Add a regression test that constructs a Slack-handler call without `team.id` and asserts the expected behavior (throw, not silent route).
5. In `src/server.ts`, grep for any remaining `getDefaultWorkspaceId()` calls outside the already-fixed internal KB/docs endpoints. Lines 108, 124, 246 look relevant. Decide A/B/C/D and fix accordingly.
6. Add the lint guard. The simplest mechanism is a test under `tests/unit/` that scans `src/**/*.ts` and asserts no new `getDefaultWorkspaceId()` calls appear outside an allowlist that matches today's B-category sites. Keep the allowlist short and explicit.
7. Update `FEATURES.md` → **Isolation invariants** with a line: *"`getDefaultWorkspaceId()` is only called from explicitly allowed sites; all other multi-tenant code paths must derive the workspace from the request, Slack payload, or worker context."*
8. Update `TODO.md` — remove the "Audit remaining `getDefaultWorkspaceId()` fallback call sites" item once this plan merges.

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` → `- [x]`. If a criterion turns out wrong or blocked, leave it unchecked with a one-line note.

## Test Plan

- [ ] Build and full test suite (`npm test`) passes with no regressions.
- [ ] Manual: trigger a Slack slash command in a non-default workspace and verify the handler resolves to that workspace (not the default).
- [ ] Manual: kick off a sync tick on the running host (`pm2 restart tinyhands-sync`) and grep the logs for `workspaceId=` — every line should reflect a real tenant, not always the default.
- [ ] Edge: invoke a Slack handler with a payload that has `team = null` (simulated in a unit test) and assert it throws rather than silently using the default workspace.
- [ ] Regression: the v1.50.5 KB isolation test stays green — internal KB/docs endpoints continue to use `X-Workspace-Id`.
- [ ] Lint guard: add a new `getDefaultWorkspaceId()` call in a test file outside the allowlist and confirm the guard test fails. Revert.

## Acceptance Criteria

- [ ] Every `getDefaultWorkspaceId()` / `getDefaultWorkspaceIdOrNull()` call in `src/` is either (a) in the documented allowlist with a justifying comment, or (b) replaced with an explicit error / per-workspace iteration.
- [ ] `src/sync.ts` iterates over all active workspaces for each sync task — no silent single-tenant assumption remains.
- [ ] No Slack handler silently resolves to the default workspace when `team.id` is missing; every such path either throws or has a documented allow-comment.
- [ ] A new unit test (`tests/unit/workspace-resolution-guard.test.ts` or similar) scans `src/` and fails if an unauthorized `getDefaultWorkspaceId()` call appears.
- [ ] FEATURES.md Isolation invariants section gains a bullet documenting the allowlist rule.
- [ ] TODO.md "audit remaining `getDefaultWorkspaceId()` fallbacks" item is removed once this plan merges.

## Out of Scope

- Refactoring `getDefaultWorkspaceId()` itself (it stays; the legitimate bootstrap and single-tenant fallback use cases keep it).
- Broader multi-tenant audit beyond workspace resolution (e.g., Redis key prefixing, webhook routing — already covered by separate invariants).
- Adding new telemetry or metrics around workspace resolution — nice-to-have but not required by this plan.
- Changing the public Slack OAuth install flow or workspace membership model.
