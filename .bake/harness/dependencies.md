# Dependencies

## Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @anthropic-ai/claude-code | ^1.0.0 | Claude Code agent SDK for Docker-based agent execution |
| @anthropic-ai/sdk | ^0.39.0 | Claude API client for AI features (relevance checks, goal analysis) |
| @slack/bolt | ^4.1.0 | Slack bot framework — Socket Mode, commands, events, actions |
| @slack/web-api | ^7.8.0 | Slack Web API client for message posting, user lookup |
| bullmq | ^5.34.0 | Redis-backed job queue with priority, rate limiting, retries |
| connect-redis | ^7.1.1 | Redis session store for Express |
| cron-parser | ^5.5.0 | Parse cron expressions for scheduled triggers |
| dockerode | ^4.0.4 | Docker Engine API client for container lifecycle management |
| dotenv | ^17.3.1 | Load environment variables from .env files |
| express | ^4.21.0 | HTTP server for webhooks, REST API, OAuth callbacks |
| express-session | ^1.19.0 | Session middleware for web dashboard auth |
| ioredis | ^5.4.2 | Redis client for BullMQ, rate limiting, approval state |
| mammoth | ^1.8.0 | DOCX file parsing for knowledge base ingestion |
| multer | ^1.4.5-lts.1 | Multipart file upload handling |
| pdf-parse | ^1.1.1 | PDF text extraction for knowledge base ingestion |
| pg | ^8.20.0 | PostgreSQL client with connection pooling |
| uuid | ^11.1.0 | UUID generation for database IDs |
| winston | ^3.17.0 | Structured logging with levels and metadata |
| xlsx | ^0.18.5 | Excel/spreadsheet parsing and generation |

## Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @eslint/js | ^9.39.4 | ESLint JavaScript config |
| @types/dockerode | ^3.3.34 | TypeScript types for Dockerode |
| @types/express | ^5.0.0 | TypeScript types for Express |
| @types/express-session | ^1.18.2 | TypeScript types for express-session |
| @types/multer | ^1.4.12 | TypeScript types for Multer |
| @types/node | ^22.10.0 | TypeScript types for Node.js |
| @types/pdf-parse | ^1.1.5 | TypeScript types for pdf-parse |
| @types/pg | ^8.18.0 | TypeScript types for pg |
| @types/uuid | ^10.0.0 | TypeScript types for uuid |
| @typescript-eslint/eslint-plugin | ^8.0.0 | ESLint rules for TypeScript |
| @typescript-eslint/parser | ^8.0.0 | ESLint TypeScript parser |
| @vitest/coverage-v8 | ^2.1.9 | V8-based code coverage for Vitest |
| eslint | ^9.0.0 | Code linting and style enforcement |
| husky | ^9.0.0 | Git hooks for pre-commit checks |
| testcontainers | ^10.16.0 | Spin up PostgreSQL + Redis containers for integration tests |
| ts-node | ^10.9.2 | TypeScript execution for development |
| typescript | ^5.7.0 | TypeScript compiler |
| typescript-eslint | ^8.57.0 | ESLint TypeScript integration |
| vitest | ^2.1.0 | Test framework (unit + integration) |

## Web Dashboard Dependencies (web/package.json)

| Package | Version | Purpose |
|---------|---------|---------|
| react | 18 | UI rendering |
| react-dom | 18 | DOM rendering |
| react-router-dom | 7 | Client-side routing |
| @tanstack/react-query | — | Server state management, data fetching |
| zustand | — | Client-side state management |
| tailwindcss | 3 | Utility-first CSS framework |
| @radix-ui/* | — | Accessible headless UI components |
| recharts | — | Charting library for analytics dashboard |
| @tiptap/* | — | Rich text editor for native documents |
| lucide-react | — | Icon library |
| vite | 6 | Build tool and dev server |
