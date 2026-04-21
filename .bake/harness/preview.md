# Preview

## One-time setup

1. **Dependencies** — `npm install` in the worktree root.
2. **Infra** — Postgres running locally (or point `DATABASE_URL` at whatever you have), Redis on `:6379`. Easiest on this Mac:
   ```bash
   createdb tinyhands_dev
   redis-server --daemonize yes --port 6379 --dir /tmp
   ```
3. **Slack dev app** — create at https://api.slack.com/apps via **Create New App → From a manifest** and paste `dev/slack-manifest.json`. After it's created, copy these into `.env`:
   - Bot token (xoxb) from **Install App → Install to Workspace**
   - App token (xapp) generated under **Basic Information → App-Level Tokens** with scope `connections:write`
   - Signing secret / Client ID / Client Secret from **Basic Information → App Credentials**
4. **`.env`** — copy `.env.example` to `.env` and fill in the Slack values above plus:
   - `ANTHROPIC_API_KEY` — reuse the production key (fetch from the production host's `.env`) or use a fresh dev key
   - `DATABASE_URL=postgresql://localhost:5432/tinyhands_dev`
   - `REDIS_URL=redis://localhost:6379`
   - `ENCRYPTION_KEY` — 32+ chars from `openssl rand -base64 48`
   - `SESSION_SECRET` — anything random
   - `OAUTH_REDIRECT_BASE_URL=http://localhost:3000`
   - Google OAuth is configured per-workspace via the dashboard (Settings → Integrations → Google connection app). There is no env var for it — the platform never holds a Google OAuth identity of its own.
5. **Migrations** — `npm run migrate`. Mandatory before `npm run dev` whenever new migrations land; the listener does not auto-migrate.

`.env` is gitignored. The manifest file at `dev/slack-manifest.json` is checked in and reusable.

## Backend (Slack listener + API)

```bash
set -a && source .env && set +a && npm run dev
```

The app does not auto-load `.env` (it relies on PM2 injecting env vars in production). `set -a; source .env; set +a` exports every key in `.env` before running ts-node.

- **Port**: 3000
- **Requirements**: PostgreSQL, Redis, Slack app credentials, Anthropic API key (workspace 1 seeded via env bootstrap on first boot of a single-tenant install; otherwise pasted into the dashboard)
- **Environment**: see setup above

The dev server starts the Slack Socket Mode listener and Express HTTP server on port 3000.

## Web Dashboard

```bash
npm run dev:web
```

- **Port**: 5173 (Vite default). Vite auto-falls-through to 5174/5175/5176/… when the default is occupied — common when multiple worktrees run concurrently. Watch the startup banner for the actual URL.
- **Requirements**: Backend running on port 3000 (UI renders without it but API calls 502).

Starts the React/Vite development server with hot module replacement.

## Full Stack (Production)

```bash
docker compose up -d
```

- **Port**: 443 (HTTPS via nginx)
- **Services**: PostgreSQL 16, Redis 7, app (PM2 with 6 processes), nginx, certbot
- **Requirements**: Docker, domain name for SSL

## Known snag

`npm run dev` via `ts-node` can fail with `TS7016: Could not find a declaration file for module 'pdf-parse'` on a fresh `node_modules`. Unrelated to normal operation; workaround is `npm i --save-dev @types/pdf-parse` or run the compiled build (`npm run build && node dist/index.js`). This does not affect `npm test` or `npm run typecheck`, which both use `skipLibCheck`.
