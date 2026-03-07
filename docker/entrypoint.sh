#!/usr/bin/env bash
set -euo pipefail

# ── TinyJobs Agent Container Entrypoint ──

# Install custom tools — both file-based and DB-stored code
if [ -n "${CUSTOM_TOOLS_CONFIG:-}" ] && [ "$CUSTOM_TOOLS_CONFIG" != "[]" ]; then
  echo "$CUSTOM_TOOLS_CONFIG" | jq -c '.[]' | while read -r tool; do
    TOOL_NAME=$(echo "$tool" | jq -r '.name')

    # DB-stored code: write inline script to /tools/
    SCRIPT_CODE=$(echo "$tool" | jq -r '.script_code // empty')
    if [ -n "$SCRIPT_CODE" ]; then
      LANG=$(echo "$tool" | jq -r '.language // "javascript"')
      case "$LANG" in
        javascript) EXT="js" ;;
        python)     EXT="py" ;;
        bash)       EXT="sh" ;;
        *)          EXT="js" ;;
      esac
      echo "$SCRIPT_CODE" > "/tools/${TOOL_NAME}.${EXT}"
      chmod +x "/tools/${TOOL_NAME}.${EXT}"
      echo "Installed DB-stored tool: $TOOL_NAME ($LANG)" >&2
      continue
    fi

    # File-based: copy from mounted path
    SCRIPT_PATH=$(echo "$tool" | jq -r '.script_path // empty')
    if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
      cp "$SCRIPT_PATH" /tools/ 2>/dev/null || true
      echo "Installed file tool: $TOOL_NAME" >&2
    fi
  done
fi

# Build MCP config from skills if provided
MCP_ARGS=""
if [ -n "${SKILLS_CONFIG:-}" ] && [ "$SKILLS_CONFIG" != "[]" ]; then
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

# Build tool availability context for the agent
TOOL_CONTEXT=""
if [ -d "/tools" ] && [ "$(ls -A /tools 2>/dev/null)" ]; then
  TOOL_CONTEXT="\n\n## Available Custom Tools\nYou have custom tools in /tools/. To use them, run the appropriate script:\n"
  for script in /tools/*; do
    TOOL_CONTEXT="${TOOL_CONTEXT}- $(basename "$script")\n"
  done
fi

# Capture start time for duration tracking
START_TIME=$(date +%s%N)

# Run Claude with the task prompt + tool context, capture output
FULL_PROMPT="${TASK_PROMPT}${TOOL_CONTEXT}"
OUTPUT=$(echo "${FULL_PROMPT}" | claude "${CLAUDE_ARGS[@]}" 2>/dev/null || echo "Agent execution error")

END_TIME=$(date +%s%N)
DURATION_MS=$(( (END_TIME - START_TIME) / 1000000 ))

# Emit structured output for the host to parse
# Format: TINYJOBS_OUTPUT:{json}
cat <<EOJSON
TINYJOBS_OUTPUT:{"output":$(echo "$OUTPUT" | head -c 10000 | jq -Rs .),"input_tokens":0,"output_tokens":0,"tool_calls_count":0,"duration_ms":$DURATION_MS}
EOJSON
