# CI/CD & Build Pipeline

## Build Process

```bash
npm run build            # TypeScript → dist/ (tsc)
npm run build:web        # React → web/dist/ (Vite)
```

The Dockerfile uses a 2-stage build:
1. **Build stage**: Install deps, compile TypeScript, copy migrations
2. **Runtime stage**: Node 20-slim + PM2, expose port 3000

## Auto-Update

The project includes a pull-based auto-update system (`src/modules/auto-update/`):
- GitHub deploy webhooks trigger updates
- Controlled via `AUTO_UPDATE_ENABLED` env var
- Pulls latest code, rebuilds, and restarts PM2 processes

## Pre-commit Hooks

Husky v9 is configured for git hooks. Runs linting and type checking before commits.

## Test Pipeline

```bash
npm test                 # Unit tests (Vitest, mocked DB/Redis)
npm run test:integration # Integration tests (testcontainers with real PostgreSQL + Redis)
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
```

All tests must pass before merging. Integration tests use testcontainers to spin up real PostgreSQL and Redis instances.
