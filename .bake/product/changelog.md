# Changelog

- 2026-04-16: Fix web dashboard agent creation silently ignoring instructions and all multi-word settings (system_prompt, channel_ids, max_turns, etc.) due to snake_case/camelCase key mismatch in POST /agents route
- 2026-04-16: Fix "Create Trigger" button on Agent Detail page — was posting to non-existent route `/agents/{id}/triggers` instead of `POST /triggers`
- 2026-04-16: plan-004 merged. Deferred to backlog: manual browser verification of schedule/webhook trigger creation and trigger listing
