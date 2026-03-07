#!/usr/bin/env bash
set -euo pipefail

# ── TinyJobs Agent Container Entrypoint ──
# All tools, MCP configs, and code artifacts are injected from DB — zero filesystem dependency

mkdir -p /tools /workspace/artifacts

# ── 1. Install custom tools (DB-stored code → /tools/) ──
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
      echo "[tools] Installed: $TOOL_NAME ($LANG)" >&2
      continue
    fi

    # Legacy file-based fallback
    SCRIPT_PATH=$(echo "$tool" | jq -r '.script_path // empty')
    if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
      cp "$SCRIPT_PATH" /tools/ 2>/dev/null || true
      echo "[tools] Installed (file): $TOOL_NAME" >&2
    fi
  done
fi

# ── 2. Install code artifacts from DB → /workspace/artifacts/ ──
if [ -n "${CODE_ARTIFACTS_CONFIG:-}" ] && [ "$CODE_ARTIFACTS_CONFIG" != "[]" ]; then
  echo "$CODE_ARTIFACTS_CONFIG" | jq -c '.[]' | while read -r artifact; do
    FILE_PATH=$(echo "$artifact" | jq -r '.file_path')
    CONTENT=$(echo "$artifact" | jq -r '.content')

    # Create directory structure and write file
    DEST="/workspace/artifacts${FILE_PATH}"
    mkdir -p "$(dirname "$DEST")"
    echo "$CONTENT" > "$DEST"
    echo "[artifacts] Installed: $FILE_PATH" >&2
  done
fi

# ── 3. Configure MCP servers from DB-stored configs ──
MCP_CONFIG_DIR="/tmp/mcp-configs"
mkdir -p "$MCP_CONFIG_DIR"
if [ -n "${SKILLS_CONFIG:-}" ] && [ "$SKILLS_CONFIG" != "[]" ]; then
  echo "$SKILLS_CONFIG" | jq -c '.[] | select(.type == "mcp")' | while read -r skill; do
    SKILL_NAME=$(echo "$skill" | jq -r '.name')
    echo "$skill" | jq '.config' > "${MCP_CONFIG_DIR}/${SKILL_NAME}.json"
    echo "[mcp] Configured: $SKILL_NAME" >&2
  done
fi

# ── 4. Build claude command arguments ──
CLAUDE_ARGS=(
  "--print"
  "--model" "${MODEL:-claude-sonnet-4-6}"
  "--max-turns" "${MAX_TURNS:-25}"
)

if [ "${PERMISSION_MODE:-}" = "bypassPermissions" ]; then
  CLAUDE_ARGS+=("--dangerously-skip-permissions")
fi

if [ -n "${DISALLOWED_TOOLS:-}" ] && [ "$DISALLOWED_TOOLS" != "[]" ]; then
  for tool in $(echo "$DISALLOWED_TOOLS" | jq -r '.[]'); do
    CLAUDE_ARGS+=("--disallowed-tools" "$tool")
  done
fi

# ── 5. Build context about available capabilities ──
TOOL_CONTEXT=""
if [ -d "/tools" ] && [ "$(ls -A /tools 2>/dev/null)" ]; then
  TOOL_CONTEXT="\n\n## Available Custom Tools\nYou have custom tools in /tools/. To use them, run the appropriate script with INPUT env var:\n"
  for script in /tools/*; do
    TOOL_CONTEXT="${TOOL_CONTEXT}- $(basename "$script")\n"
  done
fi

if [ -d "/workspace/artifacts" ] && [ "$(find /workspace/artifacts -type f 2>/dev/null | head -1)" ]; then
  TOOL_CONTEXT="${TOOL_CONTEXT}\n\n## Code Artifacts\nAgent-generated code is available in /workspace/artifacts/:\n"
  find /workspace/artifacts -type f | while read -r f; do
    TOOL_CONTEXT="${TOOL_CONTEXT}- ${f#/workspace/artifacts}\n"
  done
fi

# ── 6. Execute ──
START_TIME=$(date +%s%N)

FULL_PROMPT="${TASK_PROMPT}${TOOL_CONTEXT}"
OUTPUT=$(echo "${FULL_PROMPT}" | claude "${CLAUDE_ARGS[@]}" 2>/dev/null || echo "Agent execution error")

END_TIME=$(date +%s%N)
DURATION_MS=$(( (END_TIME - START_TIME) / 1000000 ))

# Emit structured output for the host to parse
cat <<EOJSON
TINYJOBS_OUTPUT:{"output":$(echo "$OUTPUT" | head -c 10000 | jq -Rs .),"input_tokens":0,"output_tokens":0,"tool_calls_count":0,"duration_ms":$DURATION_MS}
EOJSON
