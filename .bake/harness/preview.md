# Preview

## Backend (Slack listener + API)

```bash
npm run dev
```

- **Port**: 3000
- **Requirements**: PostgreSQL, Redis, Slack app credentials, Anthropic API key
- **Environment**: Copy `.env.example` to `.env` and configure

The dev server starts the Slack Socket Mode listener and Express HTTP server on port 3000.

## Web Dashboard

```bash
npm run dev:web
```

- **Port**: 5173 (Vite default)
- **Requirements**: Backend running on port 3000

Starts the React/Vite development server with hot module replacement.

## Full Stack (Production)

```bash
docker compose up -d
```

- **Port**: 443 (HTTPS via nginx)
- **Services**: PostgreSQL 16, Redis 7, app (PM2 with 6 processes), nginx, certbot
- **Requirements**: Docker, domain name for SSL
