# Code Conventions

## Language & Compilation

- **TypeScript** with `strict: true` — no `any` types without justification
- Target: **ES2022**, module system: **CommonJS**
- Path aliases: `@/*` maps to `src/*` (configured in tsconfig)

## Formatting

- **2 spaces** for indentation (no tabs)
- **Semicolons** required on all statements
- **Single quotes** for strings
- Lines should not exceed ~120 characters

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Variables, functions | camelCase | `getAgent`, `runHistory` |
| Types, interfaces | PascalCase | `Agent`, `RunRecord`, `ToolManifest` |
| Files, directories | kebab-case | `knowledge-base/`, `self-evolution/` |
| Database columns | snake_case | `workspace_id`, `created_at` |
| Constants | camelCase or UPPER_SNAKE | `defaultModel`, `MAX_RETRIES` |
| Env vars | UPPER_SNAKE_CASE | `SLACK_BOT_TOKEN`, `DATABASE_URL` |

## Imports

- Named imports preferred over default imports
- Relative paths for local modules (`../../db`, `./helpers`)
- Group order: Node builtins → external packages → internal modules → relative imports
- No barrel exports — import directly from the file that defines the symbol

## Exports

- Named exports preferred (`export function`, `export const`)
- Default exports used sparingly (mainly config objects)
- Types/interfaces always use named exports

## Module Structure

- Each module in `src/modules/` has an `index.ts` that exports its public API
- Internal helpers stay private to the module
- No circular dependencies between modules

## Async Patterns

- **async/await** everywhere — no raw `.then()` chains or callbacks
- All database operations are async
- Use `Promise.all()` for independent concurrent operations
- Wrap in try/catch for error handling

## Database

- Use `query()`, `queryOne()`, `execute()` helpers from `src/db/index.ts`
- Parameterized queries with `$1, $2...` — never interpolate values into SQL
- Use `withTransaction()` for multi-statement atomic operations
- snake_case for all column and table names

## Error Handling

- Try/catch blocks with descriptive error logging via `logger`
- Use `logger.error()` with structured metadata (not `console.error`)
- Let errors propagate to callers when the caller can handle them better
- No silent catches — always log or re-throw

## Logging

- Use `winston` logger from `src/utils/logger.ts`
- Levels: `debug`, `info`, `warn`, `error`
- Include structured metadata: `logger.info('message', { agentId, workspaceId })`
- No `console.log` in production code

## Testing

- **Vitest** for all tests (`describe`/`it` syntax)
- Unit tests in `tests/unit/` — mock DB, Slack, and external services
- Integration tests in `tests/integration/` — use testcontainers for real PostgreSQL + Redis
- Every code change must include corresponding test updates
- Mock pattern: `vi.mock('../../src/db', () => ({ query: vi.fn(), ... }))`

## Comments

- Section dividers: `// ── Section Name ──`
- Inline comments only for non-obvious logic
- No JSDoc on every function — code should be self-documenting
- TODO comments include context: `// TODO: <description> (<reason>)`
