# Infrastructure & Hosting

## Docker Compose Stack

| Service | Image | Purpose |
|---------|-------|---------|
| postgres | postgres:16-alpine | Primary database |
| redis | redis:7-alpine | Job queue, sessions, rate limits |
| runner-build | docker:24-cli | Builds tinyhands-runner image at startup |
| tinyhands | Custom (Dockerfile) | Main application (6 PM2 processes) |
| nginx | nginx:alpine | SSL termination, reverse proxy |
| certbot | certbot/certbot | Auto-renewing Let's Encrypt certificates |

## PM2 Process Configuration

Defined in `ecosystem.config.js`:

| Process | Entry | Instances | Purpose |
|---------|-------|-----------|---------|
| tinyhands-listener | src/index.ts | 1 | Slack events, commands, Express server |
| tinyhands-worker-1 | src/worker.ts | 1 | BullMQ job processor |
| tinyhands-worker-2 | src/worker.ts | 1 | BullMQ job processor |
| tinyhands-worker-3 | src/worker.ts | 1 | BullMQ job processor |
| tinyhands-sync | src/sync.ts | 1 | KB sync, alerts, digest, auto-update |
| tinyhands-scheduler | src/scheduler.ts | 1 | Cron trigger evaluation (60s interval) |

Each process: 500MB memory limit, exponential backoff restart, 10s kill timeout.

## Nginx Configuration

- HTTP → HTTPS redirect
- TLS 1.2 / 1.3 with strong cipher suites
- Reverse proxy to `tinyhands:3000`
- WebSocket upgrade headers for Slack Socket Mode
- Template-based config (`nginx/default.conf.template`)

## DigitalOcean Marketplace (Packer)

`packer/tinyhands.pkr.hcl` builds a DigitalOcean droplet snapshot:
- Base: Ubuntu 22.04
- Pre-installs Docker, Docker Compose, system dependencies
- Target regions: NYC, SFO, Amsterdam, Singapore, London, Frankfurt, Bangalore, Toronto, Sydney
- Includes first-login setup script and MOTD

## Agent Execution Containers

Each agent run creates an isolated Docker container:
- Base image: `tinyhands-runner` (built at startup by runner-build service)
- Contains: Node.js runtime, mounted tools, source configs
- 30-second timeout on tool HTTP requests
- Container cleaned up after run completes
