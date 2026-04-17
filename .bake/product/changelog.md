# Changelog

- 2026-04-16: Fix web dashboard agent creation silently ignoring instructions and all multi-word settings (system_prompt, channel_ids, max_turns, etc.) due to snake_case/camelCase key mismatch in POST /agents route
- 2026-04-16: Fix "Create Trigger" button on Agent Detail page — was posting to non-existent route `/agents/{id}/triggers` instead of `POST /triggers`
- 2026-04-16: plan-004 merged. Deferred to backlog: manual browser verification of schedule/webhook trigger creation and trigger listing
- 2026-04-17: plan-010 merged. Multi-tenant workspaces: single deployment now hosts many Slack workspaces with isolated data, per-workspace Anthropic API keys (encrypted + validated), Sign in with Slack + workspace switcher, Slack OAuth install flow, workspace-scoped Redis/webhooks/OAuth state, per-run container isolation, platform-admin health view, and idempotent migration from single-tenant.
- 2026-04-17: plan-010 merged. Deferred to backlog: live install into 2 real Slack workspaces; end-to-end sign-in + workspace-switcher UI verification; live container-level runner isolation test; live BullMQ queue-fairness soak test; platform-admin page UI verification; migration dry-run against a production DB snapshot; full regression sweep of existing flows in the migrated workspace.
