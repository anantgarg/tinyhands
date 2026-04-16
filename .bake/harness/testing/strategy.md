# Testing Strategy

## Framework

**Vitest 2.1** with V8 coverage provider.

## Test Types

### Unit Tests

- **Location**: `tests/unit/`
- **Config**: `vitest.config.ts`
- **Command**: `npm test`
- **Coverage**: 80+ test files covering all modules
- **Mocking**: Database (`src/db`), Slack (`@slack/bolt`, `@slack/web-api`), logger, external APIs
- **Pattern**: `vi.mock()` at top of file, `vi.fn()` for individual function mocks

### Integration Tests

- **Location**: `tests/integration/`
- **Config**: `vitest.integration.config.ts`
- **Command**: `npm run test:integration`
- **Timeout**: 30 seconds per test
- **Infrastructure**: Testcontainers (real PostgreSQL 16 + Redis 7 containers)
- **Purpose**: Verify database migrations, query correctness, transaction behavior

## Test Patterns

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies at module level
vi.mock('../../src/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

describe('ModuleName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do the expected thing', async () => {
    // Arrange
    const mockQuery = vi.mocked(query);
    mockQuery.mockResolvedValueOnce([{ id: '123', name: 'test' }]);

    // Act
    const result = await myFunction('123');

    // Assert
    expect(result).toBeDefined();
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT'), ['123']);
  });
});
```

## Rules

- Every code change MUST include corresponding test updates
- Add tests for new functionality
- Update existing tests for modified behavior
- Remove tests for deleted code
- All tests must pass with full coverage before committing
- No skipped or failing tests allowed

## Running Tests

```bash
npm test                  # All unit tests
npm run test:watch        # Watch mode (re-run on changes)
npm run test:integration  # Integration tests (requires Docker)
```
