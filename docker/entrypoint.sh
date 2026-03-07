#!/usr/bin/env bash
set -euo pipefail

# ── TinyJobs Agent Container Entrypoint ──

# Install custom tools if provided
if [ -n "${CUSTOM_TOOLS_CONFIG:-}" ] && [ "$CUSTOM_TOOLS_CONFIG" != "[]" ]; then
  echo "$CUSTOM_TOOLS_CONFIG" | jq -r '.[] | .script_path // empty' | while read -r script; do
    if [ -f "$script" ]; then
      cp "$script" /tools/ 2>/dev/null || true
    fi
  done
fi

# Build MCP config from skills if provided
MCP_ARGS=""
if [ -n "${SKILLS_CONFIG:-}" ] && [ "$SKILLS_CONFIG" != "[]" ]; then
  # Write MCP config for skills that need it
  echo "$SKILLS_CONFIG" | jq -c '.[] | select(.type == "mcp")' | while read -r skill; do
    SKILL_NAME=$(echo "$skill" | jq -r '.name')
    echo "MCP skill available: $SKILL_NAME" >&2
  done
fi

# Build claude command arguments
CLAUDE_ARGS=(
  "--print"
  "--model" "${MODEL:-claude-sonnet-4-6}"
  "--max-turns" "${MAX_TURNS:-25}"
)

# Add permission mode
if [ "${PERMISSION_MODE:-}" = "bypassPermissions" ]; then
  CLAUDE_ARGS+=("--dangerously-skip-permissions")
fi

# Add disallowed tools
if [ -n "${DISALLOWED_TOOLS:-}" ] && [ "$DISALLOWED_TOOLS" != "[]" ]; then
  for tool in $(echo "$DISALLOWED_TOOLS" | jq -r '.[]'); do
    CLAUDE_ARGS+=("--disallowed-tools" "$tool")
  done
fi

# Capture start time for duration tracking
START_TIME=$(date +%s%N)

# Run Claude with the task prompt, capture output
OUTPUT=$(echo "${TASK_PROMPT}" | claude "${CLAUDE_ARGS[@]}" 2>/dev/null || echo "Agent execution error")

END_TIME=$(date +%s%N)
DURATION_MS=$(( (END_TIME - START_TIME) / 1000000 ))

# Emit structured output for the host to parse
# Format: TINYJOBS_OUTPUT:{json}
cat <<EOJSON
TINYJOBS_OUTPUT:{"output":$(echo "$OUTPUT" | head -c 10000 | jq -Rs .),"input_tokens":0,"output_tokens":0,"tool_calls_count":0,"duration_ms":$DURATION_MS}
EOJSON
