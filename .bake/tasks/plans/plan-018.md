---
id: plan-018
title: Stop asking for credentials on built-in tools (Knowledge Base, Documents) and fix runtime tool provisioning
status: complete
created: 2026-04-21
completed: 2026-04-21T14:10:48.000Z
---

## Summary

Built-in tools (**Knowledge Base** and **Documents**) are incorrectly treated like third-party integrations that need user-supplied credentials. This shows up in two places:

1. **Dashboard** — the agent Tools page shows Knowledge Base with Credentials = "Not configured" in an orange warning state, offering a dropdown with nothing valid to pick.
2. **Runtime (Slack)** — when a user asks the agent about the KB, it replies *"the kb-search tool isn't currently available in this session. This usually means the knowledge base connection needs to be set up"* and directs them to the Connections page. The tool is never provisioned into the Docker container because the credential resolver flags it as unconfigured.

Both are symptoms of the same root cause: the credential-resolution layer doesn't know these tools are auto-configured by the platform.

## Why

Two screenshots from the ARK KB agent:

- Dashboard Tools tab: "Knowledge Base" in Connected Tools with Credentials = "Not configured" (orange warning, dead-end dropdown).
- Slack thread: user asks `@TinyHands what do you know in your kb?` and the agent replies that kb-search isn't available and sends them to Connections.

KB and Documents have no external credentials — KB is backed by PostgreSQL tsvector full-text search; Docs is backed by the `documents`/`document_versions`/`sheet_tabs` tables. `CLAUDE.md` lists both with Config Keys: `(auto-configured)`. The current behavior:

- Confuses non-technical users, who assume the tool is broken or waiting on setup.
- Breaks the core KB feature entirely at runtime — the agent literally cannot search its own knowledge base.
- Creates a dead-end in the UI: the credentials dropdown offers no valid option.

### Evidence from production DB (2026-04-21)

Verified against the prod database:

- ARK KB agent (`1dd4b170-e47a-4be5-ac8e-d1cf79b7085b`, workspace `T01PFPBDGT0`) has `tools: ["kb-search"]` configured correctly.
- **Zero rows in `agent_tool_connections`** for this agent — so the runtime has no connection-mode row for `kb-search`, and the tool gets dropped when the container is built.
- The workspace has **6 `kb_entries`** — real content that should be searchable.
- Most recent run `fd170e3d-642f-44e5-b3e9-9bde852f5c78` (2026-04-21 13:34 UTC) completed with `tool_calls_count=2` — the agent attempted `kb-search` twice, the SDK reported it unavailable, and the agent composed the "check the Connections page" reply seen in Slack.
- Across all agents, **7 agents do have `kb-search` rows in `agent_tool_connections`** with `connection_mode` set to `team` or `runtime`, but `connection_id` is `NULL` on every one of them — these are meaningless rows created by the UI forcing a connection-mode picker for a tool that doesn't need one. They should not exist, and they should not be gating tool provisioning.
- No `connections` row has `integration_id='kb'` — correct, because KB isn't a real integration. The runtime must stop treating it like one.

## Approach

Treat "auto-configured" as a first-class property on the tool manifest so every layer — dashboard, connections API, and runtime — can short-circuit credential checks for platform-backed tools.

1. Add `autoConfigured?: boolean` to `ToolManifest` and set it on `integrations/kb` and `integrations/docs`.
2. **Connections layer** — in `src/modules/connections/`, skip credential-mode resolution for auto-configured tools so they never surface as "needing configuration" in `listAgentToolConnections`.
3. **Dashboard UI** — in the agent Tools page, render a muted "Built-in" label for auto-configured rows instead of the "Not configured" dropdown.
4. **Runtime (worker / execution)** — in `src/modules/execution/` (wherever tools are provisioned into the Docker container and listed for the Claude Agent SDK), ensure auto-configured tools are **always included** regardless of credential status. Today they are being filtered out, which is why the agent says kb-search is "not available in this session."
5. Audit other built-in tools (anything in `src/modules/tools/integrations/` with no `configKeys`) and either mark them `autoConfigured` or confirm they genuinely need credentials.

Trade-off: we could hardcode `['kb', 'docs']` in each layer, but a manifest flag keeps the list in one place and makes it trivial to add more built-in tools later.

## Instructions for Claude Code

1. Open `src/modules/tools/manifest.ts` and add an optional `autoConfigured?: boolean` field to `ToolManifest`. Document its meaning: "Tool is fully configured by the platform and has no user-supplied credentials."
2. Set `autoConfigured: true` on the manifests in:
   - `src/modules/tools/integrations/kb/index.ts`
   - `src/modules/tools/integrations/docs/index.ts`
3. In `src/modules/connections/` (wherever `listAgentToolConnections` and `getIntegrationIdForTool` are defined), skip emitting credential-status entries for tools whose manifest has `autoConfigured: true`. These tools should report as "ready" with no credential mode.
4. In the dashboard (`web/src/`), find the agent Tools tab that renders the Connected Tools table (the page shown in the first screenshot — Agents → {agent} → Tools). For rows where the tool is auto-configured:
   - Replace the Credentials cell with a muted "Built-in" label (plain text, no color warning, no dropdown, no "Not configured").
   - Ensure the "Access" cell (e.g., "Can view data") still renders normally.
5. **Runtime fix** — in `src/modules/execution/`, find the code path that decides which tools get mounted/registered into the Docker container for a run (and the list passed to the Claude Agent SDK). When a tool's manifest has `autoConfigured: true`, it must always be included — do not gate it on an `agent_tool_connections` row existing, a `connection_id` being set, or `listAgentToolConnections` reporting it as "ready with credentials." Production evidence: ARK KB has `tools: ["kb-search"]` but zero `agent_tool_connections` rows, and its last run was `tool_calls_count=2` with a "not available" response — confirming the gate is on connection-row existence.
6. **Data cleanup** — delete stale `agent_tool_connections` rows where `tool_name` maps to an auto-configured tool (today: any row where `tool_name = 'kb-search'`). There are 7 such rows in production, all with `connection_id = NULL`. Ship this as a one-off migration in `src/db/migrations/` (`DELETE FROM agent_tool_connections WHERE tool_name IN (<auto-configured tool names>)`). After this migration, the same rows should never be created again because step 3 will skip auto-configured tools at the API layer.
7. Verify no other built-in tools are affected: search `src/modules/tools/integrations/` for any manifest without `configKeys` and confirm they either take the `autoConfigured` flag or legitimately require credentials.
8. Update `CLAUDE.md` tool table if the manifest shape changes materially.

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` → `- [x]`.

## Test Plan

- [ ] Open an agent's Tools tab in the dashboard. Confirm Knowledge Base and Documents show as "Built-in" (or equivalent) in the Credentials column — no orange "Not configured" badge, no dropdown.
- [ ] Confirm a third-party tool on the same agent (e.g., Linear, HubSpot) still shows the credential selector and "Not configured" state when credentials are missing.
- [ ] Add Knowledge Base / Documents to a new agent and confirm no credential prompt appears in any flow.
- [ ] In Slack, mention an agent that has Knowledge Base attached (like ARK KB) and ask about its KB content. Verify the agent actually uses kb-search and returns real results — it must NOT reply "the kb-search tool isn't currently available in this session."
- [ ] Same test for Documents: ask an agent with Documents attached to list/create a document and verify the tool runs.
- [ ] Regression: confirm the Tools tab still loads for agents with a mix of built-in and third-party tools, and that adding/removing tools works unchanged.
- [ ] Regression: confirm third-party tools (Linear, HubSpot, etc.) that genuinely lack credentials still correctly fail to provision at runtime and surface a clear error.

## Acceptance Criteria

- [x] `ToolManifest` exposes an `autoConfigured` flag, and KB + Documents manifests set it to `true`.
- [x] The agent Tools page no longer shows "Not configured" or a credentials dropdown for Knowledge Base or Documents.
- [x] At runtime, agents with Knowledge Base or Documents attached can actually invoke `kb-search` / docs tools — no "tool isn't currently available in this session" message in Slack.
- [x] Third-party integrations (Linear, HubSpot, Chargebee, etc.) continue to show credentials UI exactly as before and still gate correctly when credentials are missing.
- [x] Unit/integration tests cover the auto-configured path in both `listAgentToolConnections` and the runtime tool-provisioning code so future integrations can't regress.

## Out of Scope

- Changing how third-party credentials are entered, stored, or resolved.
- Redesigning the Connected Tools table beyond the Credentials column for auto-configured tools.
- Adding new built-in tools.
- Migrating tool manifests to a different shape beyond the single `autoConfigured` addition.
