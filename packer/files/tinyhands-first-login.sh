#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="/opt/tinyhands"

echo -e "${BLUE}"
echo '╔╦╗┬┌┐┌┬ ┬  ╦ ╦┌─┐┌┐┌┌┬┐┌─┐'
echo ' ║ │││││ │  ╠═╣├─┤│││ ││└─┐'
echo ' ╩ ┴┘└┘ ┴  ╩ ╩┴ ┴┘└┘─┴┘└─┘'
echo -e "${NC}"
echo -e "${BOLD}Tiny Hands Setup${NC}"
echo ""

if [ ! -f "$INSTALL_DIR/.needs-setup" ]; then
  echo -e "${GREEN}Tiny Hands is already configured.${NC}"
  echo ""
  echo "  Status:   cd ${INSTALL_DIR} && docker compose ps"
  echo "  Logs:     cd ${INSTALL_DIR} && docker compose logs -f tinyhands"
  echo "  Restart:  cd ${INSTALL_DIR} && docker compose restart"
  echo ""
  echo "To reconfigure, delete .env and run this script again:"
  echo "  rm ${INSTALL_DIR}/.env && /opt/tinyhands-setup.sh"
  exit 0
fi

# ── Step 1: Slack app setup ──

echo -e "${BOLD}Step 1: Create a Slack App${NC}"
echo ""
echo "Go to: ${BOLD}https://api.slack.com/apps${NC}"
echo "Click \"Create New App\" > \"From scratch\""
echo ""
echo -e "${BOLD}Required Bot Token Scopes${NC} (OAuth & Permissions):"
echo "  channels:manage    channels:read     channels:history   channels:join"
echo "  chat:write         chat:write.customize"
echo "  commands           users:read"
echo "  reactions:read     reactions:write"
echo "  files:read         groups:history    groups:write"
echo "  im:history         im:write"
echo ""
echo -e "${BOLD}Enable Socket Mode${NC} (Settings > Socket Mode):"
echo "  Generate an App-Level Token with connections:write scope"
echo ""
echo -e "${BOLD}Slash Commands${NC} (create all three):"
echo "  /agents — Manage AI agents"
echo "  /tools  — Manage tool integrations"
echo "  /kb     — Knowledge base dashboard"
echo ""
echo -e "${BOLD}Event Subscriptions${NC} (subscribe to bot events):"
echo "  message.channels   message.im   app_mention"
echo "  reaction_added     app_home_opened"
echo ""
echo -e "${BOLD}Interactivity & Shortcuts${NC}: Enable Interactivity"
echo ""
echo "Install the app to your workspace when done."
echo ""
read -p "Press Enter when your Slack app is ready..."

# ── Step 2: Collect credentials ──

echo ""
echo -e "${BOLD}Step 2: Enter Credentials${NC}"
echo ""

read -p "Slack Bot Token (xoxb-...): " SLACK_BOT_TOKEN
read -p "Slack App Token (xapp-...): " SLACK_APP_TOKEN
read -p "Slack Signing Secret: " SLACK_SIGNING_SECRET

echo ""
echo "Get your API key at: https://console.anthropic.com/settings/keys"
read -p "Anthropic API Key (sk-ant-...): " ANTHROPIC_API_KEY

# Generate secure postgres password
POSTGRES_PASSWORD=$(openssl rand -hex 16)

# ── Step 3: Write config ──

echo ""
echo -e "${BLUE}Writing configuration...${NC}"

cat > "${INSTALL_DIR}/.env" <<EOF
# Slack
SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
SLACK_APP_TOKEN=${SLACK_APP_TOKEN}
SLACK_SIGNING_SECRET=${SLACK_SIGNING_SECRET}

# Anthropic
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

# Postgres (managed by Docker Compose — do not change)
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# Auto-update (pull-based deployment)
AUTO_UPDATE_ENABLED=true
AUTO_UPDATE_INTERVAL=300000

# Optional — uncomment and configure as needed
# GITHUB_TOKEN=ghp_...
# LOG_LEVEL=info
# DAILY_BUDGET_USD=50
# MAX_CONCURRENT_WORKERS=3
EOF

# ── Step 4: Update and start ──

echo -e "${BLUE}Pulling latest Tiny Hands...${NC}"
cd "${INSTALL_DIR}"
git pull origin main 2>/dev/null || true

echo -e "${BLUE}Starting Tiny Hands (this may take a minute)...${NC}"
docker compose up -d --build

# Enable systemd service for auto-start on reboot
systemctl enable tinyhands

# Remove first-boot flag
rm -f "${INSTALL_DIR}/.needs-setup"

echo ""
echo -e "${GREEN}${BOLD}Tiny Hands is running!${NC}"
echo ""
echo "  Health check: curl http://localhost:3000/health"
echo "  View logs:    cd ${INSTALL_DIR} && docker compose logs -f tinyhands"
echo "  Stop:         cd ${INSTALL_DIR} && docker compose down"
echo "  Restart:      cd ${INSTALL_DIR} && docker compose restart"
echo ""
echo -e "${YELLOW}Next step: Run /agents in Slack to initialize yourself as superadmin.${NC}"
echo ""
