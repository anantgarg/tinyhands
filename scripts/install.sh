#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="/opt/tinyhands"
REPO_URL="https://github.com/anantgarg/tinyhands.git"

echo -e "${BLUE}"
echo '╔╦╗┬┌┐┌┬ ┬  ╦ ╦┌─┐┌┐┌┌┬┐┌─┐'
echo ' ║ │││││ │  ╠═╣├─┤│││ ││└─┐'
echo ' ╩ ┴┘└┘ ┴  ╩ ╩┴ ┴┘└┘─┴┘└─┘'
echo -e "${NC}"
echo -e "${BOLD}✋ Tiny Hands Installer${NC}"
echo ""

# ── Pre-flight checks ──

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Please run as root (sudo bash install.sh)${NC}"
  exit 1
fi

if ! grep -qE 'Ubuntu|Debian' /etc/os-release 2>/dev/null; then
  echo -e "${YELLOW}Warning: This script is tested on Ubuntu/Debian. Other distros may work but are unsupported.${NC}"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# ── Install Docker ──

if ! command -v docker &>/dev/null; then
  echo -e "${BLUE}Installing Docker...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}Docker installed${NC}"
else
  echo -e "${GREEN}Docker already installed${NC}"
fi

if ! docker compose version &>/dev/null; then
  echo -e "${RED}Error: Docker Compose plugin not found.${NC}"
  echo "Install it with: apt-get install docker-compose-plugin"
  exit 1
fi

# ── Clone or update Tiny Hands ──

if [ ! -d "$INSTALL_DIR" ]; then
  echo -e "${BLUE}Cloning Tiny Hands to ${INSTALL_DIR}...${NC}"
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  echo -e "${YELLOW}${INSTALL_DIR} already exists. Pulling latest...${NC}"
  cd "$INSTALL_DIR" && git pull origin main
fi

cd "$INSTALL_DIR"

# ── Configure environment ──

echo ""
echo -e "${BOLD}=== Configuration ===${NC}"
echo ""

if [ -f .env ]; then
  echo -e "${YELLOW}Existing .env found.${NC}"
  read -p "Overwrite? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Keeping existing .env"
    echo ""
    echo -e "${BLUE}Starting Tiny Hands...${NC}"
    docker compose up -d --build
    echo ""
    echo -e "${GREEN}Tiny Hands is running!${NC}"
    echo "  Health check: curl http://localhost:${PORT:-3000}/health"
    echo "  Logs:         cd ${INSTALL_DIR} && docker compose logs -f"
    echo "  Stop:         cd ${INSTALL_DIR} && docker compose down"
    exit 0
  fi
fi

echo "Before continuing, you need a Slack app. Create one at:"
echo -e "${BOLD}  https://api.slack.com/apps${NC}"
echo ""
echo "Required setup:"
echo "  1. Enable Socket Mode → generate App-Level Token (xapp-...)"
echo "  2. Add Bot Token Scopes: channels:manage, channels:read, channels:history,"
echo "     channels:join, chat:write, chat:write.customize, commands, users:read,"
echo "     reactions:read, reactions:write, files:read, groups:history, im:history, im:write"
echo "  3. Create slash commands: /agents, /tools, /kb"
echo "  4. Subscribe to events: message.channels, message.im, app_mention,"
echo "     reaction_added, app_home_opened"
echo "  5. Install the app to your workspace"
echo ""
read -p "Press Enter when your Slack app is ready..."
echo ""

POSTGRES_PASSWORD=$(openssl rand -hex 16)

read -p "Slack Bot Token (xoxb-...): " SLACK_BOT_TOKEN
read -p "Slack App Token (xapp-...): " SLACK_APP_TOKEN
read -p "Slack Signing Secret: " SLACK_SIGNING_SECRET
read -p "Anthropic API Key (sk-ant-...): " ANTHROPIC_API_KEY

cat > .env <<EOF
# Slack
SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
SLACK_APP_TOKEN=${SLACK_APP_TOKEN}
SLACK_SIGNING_SECRET=${SLACK_SIGNING_SECRET}

# Anthropic
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

# Postgres (managed by Docker Compose)
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

echo -e "${GREEN}.env created${NC}"

# ── Start services ──

echo ""
echo -e "${BLUE}Building and starting Tiny Hands (this may take a few minutes)...${NC}"
docker compose up -d --build

echo ""
echo -e "${GREEN}${BOLD}Tiny Hands is running!${NC}"
echo ""
echo "  Health check: curl http://localhost:${PORT:-3000}/health"
echo "  View logs:    cd ${INSTALL_DIR} && docker compose logs -f tinyhands"
echo "  Stop:         cd ${INSTALL_DIR} && docker compose down"
echo "  Update:       cd ${INSTALL_DIR} && git pull && docker compose up -d --build"
echo ""
echo -e "${YELLOW}Next step: Run /agents in Slack to initialize yourself as superadmin. High five! ✋${NC}"
