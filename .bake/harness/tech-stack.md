# Tech Stack

## Language & Runtime

| Component | Technology | Version |
|-----------|-----------|---------|
| Language | TypeScript | 5.7 |
| Runtime | Node.js | 20 (LTS) |
| Target | ES2022 | CommonJS modules |
| Strict mode | Enabled | `strict: true` in tsconfig |

## Backend Framework

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Slack framework | @slack/bolt v4.1 | Socket Mode event handling, commands, actions |
| HTTP server | Express v4.21 | Webhooks, REST API, OAuth callbacks |
| Job queue | BullMQ v5.34 | Priority queue, rate limiting, job processing |
| Process manager | PM2 | 6 processes: listener, 3 workers, sync, scheduler |
| AI SDK | @anthropic-ai/sdk v0.39 | Claude API integration |
| Agent SDK | @anthropic-ai/claude-code v1.0 | Agent execution inside Docker containers |

## Frontend (Web Dashboard)

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Framework | React 18 | UI rendering |
| Build tool | Vite 6 | Dev server, bundling |
| Routing | React Router v7 | Client-side routing |
| Styling | Tailwind CSS 3 | Utility-first CSS |
| State | Zustand | Client-side state management |
| Server state | @tanstack/react-query | API data fetching/caching |
| UI primitives | Radix UI | Accessible headless components |
| Charts | Recharts | Dashboard analytics |
| Rich text | TipTap | Document editor |
| Icons | Lucide React | Consistent iconography |

## Data Layer

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Database | PostgreSQL 16 | Primary data store, full-text search (tsvector + GIN) |
| Cache/queue | Redis 7 | BullMQ backend, sessions, rate limiting, approval state |
| DB driver | pg v8.20 | PostgreSQL client |
| Redis driver | ioredis v5.4 | Redis client |
| Migrations | Raw SQL | 23 migration files in `src/db/migrations/` |

## Container & Deployment

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Containerization | Docker | Agent isolation (one container per run) |
| Orchestration | Docker Compose | PostgreSQL, Redis, app, nginx, certbot |
| Docker API | Dockerode v4.0 | Programmatic Docker management |
| Reverse proxy | Nginx | SSL termination, WebSocket upgrade |
| SSL | Let's Encrypt / Certbot | Auto-renewing TLS certificates |
| Image builder | Packer | DigitalOcean Marketplace snapshots |

## Development Tools

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Test framework | Vitest 2.1 | Unit and integration tests |
| Integration tests | Testcontainers | PostgreSQL + Redis containers for tests |
| Coverage | @vitest/coverage-v8 | Code coverage reporting |
| Linting | ESLint 9 | Code quality |
| Git hooks | Husky 9 | Pre-commit checks |
| Package manager | npm | Dependency management |

## Build & Run Commands

```bash
npm run build            # tsc — compile TypeScript
npm run dev              # ts-node src/index.ts — development listener
npm run dev:web          # Vite dev server for dashboard
npm test                 # vitest run — unit tests
npm run test:integration # vitest with testcontainers config
npm run lint             # eslint src/
npm run typecheck        # tsc --noEmit
npm run migrate          # run database migrations
```
