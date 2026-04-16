---
id: plan-002
title: Fix agent creation not saving instructions (or any multi-word settings)
status: complete
created: 2026-04-16
completed: 2026-04-16T11:08:27.000Z
---

## Summary

When creating an agent through the web dashboard, the generated instructions (and every other multi-word setting like channels, effort, memory, access, etc.) are silently discarded. The agent gets created with hardcoded defaults — most visibly, "You are a helpful AI assistant." instead of the AI-generated system prompt. The dashboard shows a success toast, making users believe the save worked.

## Why

A user (Gaurav) reported this via screen recording: after completing the full agent creation wizard (goal description, identity with generated instructions, settings, tools), the newly created agent's overview page shows the default "You are a helpful AI assistant." instead of the detailed instructions that were generated. Editing the instructions after creation also appears to fail (toast says saved, but value reverts). This makes the creation wizard essentially broken — it generates good instructions but throws them away.

## Root Cause Analysis

### Bug #1: Agent creation — camelCase/snake_case key mismatch (CONFIRMED)

The data flows through three layers with inconsistent key conventions:

1. **Frontend** (`web/src/api/agents.ts:194`): `useCreateAgent` converts the payload from camelCase to snake_case via `toSnakeKeys()` before sending:
   ```
   { systemPrompt: "..." } → toSnakeKeys → { system_prompt: "..." }
   ```

2. **API route** (`src/api/routes/agents.ts:53`): Passes `req.body` straight through:
   ```typescript
   const params = { ...req.body, createdBy: userId };
   const agent = await createAgent(workspaceId, params);
   ```
   So `params` has snake_case keys from the body: `{ system_prompt: "...", max_turns: 25, ... }`

3. **Backend function** (`src/modules/agents/index.ts:27-60`): `createAgent()` expects the `CreateAgentParams` interface, which uses **camelCase**:
   ```typescript
   system_prompt: params.systemPrompt || 'You are a helpful AI assistant.',  // line 41
   max_turns: params.maxTurns || 50,                                         // line 49
   ```
   Since the body has `system_prompt` but the code reads `params.systemPrompt`, the value is `undefined`, and every field falls back to its default.

**Every multi-word field is affected:**

| Field | Sent as (snake_case) | Read as (camelCase) | Default used |
|-------|---------------------|---------------------|-------------|
| Instructions | `system_prompt` | `params.systemPrompt` | "You are a helpful AI assistant." |
| Avatar | `avatar_emoji` | `params.avatarEmoji` | `:robot_face:` |
| Channels | `channel_ids` | `params.channelIds` | `[]` (empty) |
| Effort | `max_turns` | `params.maxTurns` | `50` |
| Memory | `memory_enabled` | `params.memoryEnabled` | `false` |
| Activation | `mentions_only` | `params.mentionsOnly` | `false` |
| Respond to all | `respond_to_all_messages` | `params.respondToAllMessages` | `false` |
| Default access | `default_access` | `params.defaultAccess` | `viewer` |
| Write policy | `write_policy` | `params.writePolicy` | `auto` |
| Evolution mode | `self_evolution_mode` | `params.selfEvolutionMode` | `autonomous` |

Single-word fields (`name`, `model`, `tools`) are unaffected because their snake_case and camelCase forms are identical.

**Why Slack creation works fine:** The Slack commands (`src/slack/commands.ts:843`) call `createAgent()` directly with camelCase keys, bypassing the API route entirely.

### Bug #2: Instructions edit appears to not persist (LIKELY RESOLVED BY FIX #1)

The update code path (`PATCH /agents/:id`) is actually correct — the backend `updateAgent()` function uses `Partial<Agent>` which has snake_case fields matching what `toSnakeKeys` sends. The DB update succeeds and the toast fires. The query invalidation triggers a re-fetch.

After fixing Bug #1, new agents will have correct instructions stored. The update flow should work correctly as-is. The issue in the video is most likely the creation bug cascading: the agent was created with the wrong prompt, then the user's edits may have been saving correctly but the re-fetch appeared stale due to timing or the recording ended before the UI updated.

If the update bug persists independently after fixing creation, it would need runtime debugging (network tab, DB queries) to isolate.

## Approach

**Fix the backend API route** to normalize snake_case request bodies to camelCase before calling `createAgent()`. This is the safest approach because:
- It doesn't change the frontend API contract (snake_case over HTTP is a valid convention)
- It doesn't change the `createAgent` function signature (which other callers like Slack commands use correctly)
- It handles both camelCase and snake_case inputs gracefully

Add a `snakeToCamelKeys` utility function to the agents route file and apply it to `req.body` in the POST handler.

## Instructions for Claude Code

### Step 1: Add snakeToCamelKeys utility to the agents route

**File:** `src/api/routes/agents.ts`

Add a utility function near the top of the file (after imports):

```typescript
/** Convert top-level snake_case keys to camelCase so both conventions are accepted. */
function snakeToCamelKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return result;
}
```

### Step 2: Apply the normalization in the POST /agents route

**File:** `src/api/routes/agents.ts`, line 53

Change:
```typescript
const params = { ...req.body, createdBy: userId };
```

To:
```typescript
const params = { ...snakeToCamelKeys(req.body), createdBy: userId };
```

**Important:** The `credential_modes` handling later in the same route (lines 92-133) reads from `req.body.credential_modes` directly — leave those references untouched since they access `req.body`, not `params`.

### Step 3: Update tests

Update or add tests that verify:
1. Agent creation via the API with snake_case body saves all fields correctly (system_prompt, channel_ids, max_turns, etc.)
2. Agent creation via the API with camelCase body still works (backward compatibility)
3. The system_prompt specifically is NOT the default "You are a helpful AI assistant." when a value is provided

### Step 4: Verify the update flow still works

After the fix, manually verify:
1. Create an agent via the web dashboard wizard — instructions should persist
2. Edit instructions on the agent detail page — save and verify they persist after page refresh
3. Change model/effort dropdowns — verify those persist too

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` → `- [x]` for the criteria you've satisfied. Do this as you go, not only at the very end — small honest updates beat one big sweep. If a criterion cannot be satisfied as written (ambiguous, wrong, or blocked), leave it unchecked and add a one-line note below it explaining why.

## Test Plan

- [ ] Create an agent via POST /agents with snake_case body containing a custom system_prompt — verify the returned agent has that prompt, not the default
- [ ] Create an agent via POST /agents with camelCase body (backward compat) — verify it still works
- [ ] Create an agent via the web dashboard wizard with a goal that generates instructions — verify the overview page shows the generated instructions, not "You are a helpful AI assistant."
- [ ] Edit instructions on an existing agent's overview page — verify they persist after save and page refresh
- [ ] Change model/effort on the overview page — verify they persist
- [ ] Verify Slack-based agent creation still works (no regression from the route change)

## Acceptance Criteria

- [x] `POST /agents` with a snake_case `system_prompt` field saves that value to the database (not the default)
- [x] `POST /agents` with a snake_case `max_turns` field saves that value (not default 50)
- [x] `POST /agents` with a snake_case `channel_ids` field saves the channels (not empty)
- [x] All existing unit and integration tests pass
- [x] The `snakeToCamelKeys` utility is tested or covered by the agent creation tests

## Out of Scope

- Changing the frontend to send camelCase instead of snake_case — the backend should accept both conventions
- Refactoring the `updateAgent` function or PATCH route — those already work correctly with snake_case
- Investigating PgBouncer read-after-write consistency — that's a separate operational concern
- Adding `Cache-Control: no-cache` headers to API responses — nice-to-have but not the root cause
