#!/bin/bash
set -euo pipefail

# TinyJobs Production Deployment Script
# Runs on the DigitalOcean droplet to deploy/update the app

DEPLOY_DIR="/mnt/tinyjobs-data/app"
PM2_HOME="/mnt/tinyjobs-data/pm2"
export PM2_HOME

echo "=== TinyJobs Deployment ==="

# Ensure persistent volume is mounted
if ! mountpoint -q /mnt/tinyjobs-data; then
  echo "ERROR: Persistent volume not mounted at /mnt/tinyjobs-data"
  exit 1
fi

# Create persistent directories
mkdir -p /mnt/tinyjobs-data/workspaces
mkdir -p /mnt/tinyjobs-data/sources-cache
mkdir -p /mnt/tinyjobs-data/memory
mkdir -p /mnt/tinyjobs-data/app

# Symlink temp dirs to persistent volume
ln -sfn /mnt/tinyjobs-data/workspaces /tmp/tinyjobs-workspaces
ln -sfn /mnt/tinyjobs-data/sources-cache /tmp/tinyjobs-sources-cache
ln -sfn /mnt/tinyjobs-data/memory /tmp/tinyjobs-memory

cd "$DEPLOY_DIR"

# Clone or pull latest code
if [ ! -d ".git" ]; then
  git clone https://github.com/anantgarg/tinyjobs.git .
else
  git fetch origin master
  git reset --hard origin/master
fi

# Install dependencies
npm ci

# Build TypeScript
npm run build

# Build Docker runner image
docker build -t tinyjobs-runner:latest ./docker/

# Stop existing PM2 processes (if any)
pm2 delete all 2>/dev/null || true

# Start PM2 with ecosystem config
pm2 start ecosystem.config.js

# Save PM2 process list for resurrection on reboot
pm2 save

echo "=== Deployment Complete ==="
pm2 list
