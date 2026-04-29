import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

// Regression guard for the "require is not defined" crash on the agent edit
// page. The dashboard is a Vite/React SPA running in the browser — there is
// no CommonJS `require` at runtime. Any top-level `require(...)` in
// RichTextEditor (or any component it pulls in) will throw a ReferenceError
// the first time that code path mounts, and React's error boundary will
// replace the agent prompt editor with a "Something went wrong" card.
//
// This test reads the editor source as text and fails if `require(` ever
// re-appears. We intentionally use a static check rather than mounting the
// component under jsdom because the dashboard has no React testing infra
// today, and adding one for a single regression test would be overkill.

const editorPath = join(__dirname, '..', '..', '..', 'web', 'src', 'components', 'RichTextEditor.tsx');

describe('RichTextEditor (browser-safety)', () => {
  it('does not call CommonJS require() — that throws in the browser', () => {
    const source = readFileSync(editorPath, 'utf8');
    const offendingLines = source
      .split('\n')
      .map((line, idx) => ({ line, lineNumber: idx + 1 }))
      .filter(({ line }) => /\brequire\s*\(/.test(line));

    expect(
      offendingLines,
      `RichTextEditor must use ES imports only. Found require() at:\n` +
        offendingLines.map((l) => `  line ${l.lineNumber}: ${l.line.trim()}`).join('\n'),
    ).toEqual([]);
  });

  it('imports useDatabaseTables via a top-of-file ES import', () => {
    const source = readFileSync(editorPath, 'utf8');
    expect(source).toMatch(/^import\s*\{\s*useDatabaseTables\s*\}\s*from\s*['"]@\/api\/database['"];?\s*$/m);
  });
});
