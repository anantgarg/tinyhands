# Deployment

## Quick Start (Docker Compose)

```bash
cp .env.example .env     # Configure credentials
docker compose up -d     # Start full stack
```

Services: PostgreSQL 16, Redis 7, app (PM2 x6 processes), nginx (SSL), certbot (Let's Encrypt).

## Architecture

```
Internet → nginx (443/SSL) → Express (3000)
                                ├── Slack Socket Mode (listener)
                                ├── REST API (webhooks, dashboard)
                                └── BullMQ workers (3x)
                                    └── Docker containers (agent runs)

PostgreSQL ←→ App ←→ Redis (queue, sessions, rate limits)
```

## Detailed Guides

- [CI/CD & Build Pipeline](deployment/ci-cd.md)
- [Infrastructure & Hosting](deployment/infrastructure.md)
- [Environment & Configuration](deployment/environment.md)
