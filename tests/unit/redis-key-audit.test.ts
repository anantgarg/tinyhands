import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// ── Redis key discipline audit ──
// Every Redis key that touches tenant data must be workspace-scoped. This test
// greps the source tree for Redis write patterns and asserts each hit either
// (a) already includes `workspaceId` in the key template, (b) goes through the
// `rkey()` helper, or (c) is in the allow-list below for legitimately global
// keys (session store, user-name cache keyed by team-unique slack id, etc).

const ROOT = join(__dirname, '..', '..', 'src');

// Paths that don't participate in tenant-data storage.
const ALLOWED_FILES = new Set<string>([
  'src/queue/index.ts',                  // defines rkey(); call sites verified by dedicated tests
  'src/server.ts',                       // session store via connect-redis + RedisStore (global by design)
  'src/api/helpers/user-resolver.ts',    // user:name cache — keyed by workspaceId via cacheKey()
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

describe('Redis key discipline (tenant isolation audit)', () => {
  it('every Redis write includes workspaceId in its key', () => {
    const files = walk(ROOT);
    const offenders: string[] = [];

    // Patterns that look like raw Redis string-key writes.
    const callPattern = /\.(set|get|del|hset|hget|incr|incrby|decr|decrby|expire|zadd|zrange)\(\s*`([^`]*)`/g;

    for (const file of files) {
      const rel = file.slice(file.indexOf('src/'));
      if (ALLOWED_FILES.has(rel)) continue;

      const src = readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      while ((match = callPattern.exec(src)) !== null) {
        const key = match[2];
        // Keys that include ${workspaceId}, go through rkey(), or use a
        // workspaceId-derived variable are fine. Anything else is suspect.
        const mentionsWorkspace = /workspaceId|workspace_id/.test(key);
        if (!mentionsWorkspace) {
          offenders.push(`${rel}: ${match[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
