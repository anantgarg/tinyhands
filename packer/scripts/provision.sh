#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "=== TinyJobs: Provisioning image ==="

# ── System updates ──
apt-get update
apt-get upgrade -y
apt-get install -y curl git jq ufw fail2ban

# ── Install Docker Engine + Compose plugin ──
curl -fsSL https://get.docker.com | sh
systemctl enable docker

# ── Configure firewall ──
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 3000/tcp
ufw --force enable

# ── Clone TinyJobs ──
git clone https://github.com/anantgarg/tinyjobs.git /opt/tinyjobs
cd /opt/tinyjobs

# ── Pre-build Docker images (so first boot is fast) ──
echo "=== Building Docker images (this takes a few minutes) ==="
docker compose build tinyjobs
docker build -t tinyjobs-runner:latest ./docker/

# Pre-pull remaining images
docker pull postgres:16-alpine
docker pull redis:7-alpine
docker pull docker:24-cli

# ── Create systemd service ──
cat > /etc/systemd/system/tinyjobs.service <<'EOF'
[Unit]
Description=TinyJobs - Slack AI Agent Platform
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/tinyjobs
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

# Don't enable yet — user must configure .env first

# ── Disable default MOTD noise ──
chmod -x /etc/update-motd.d/* 2>/dev/null || true

# ── Create first-boot flag ──
touch /opt/tinyjobs/.needs-setup

echo "=== Provisioning complete ==="
