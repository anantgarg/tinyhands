# Changelog

- 2026-04-16: Fix web dashboard agent creation silently ignoring instructions and all multi-word settings (system_prompt, channel_ids, max_turns, etc.) due to snake_case/camelCase key mismatch in POST /agents route
