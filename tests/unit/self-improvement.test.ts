import { describe, it, expect } from 'vitest';
import { detectCritique, formatDiffForSlack } from '../../src/modules/self-improvement';

describe('Critique Detection', () => {
  it('should detect "why did you" critique', () => {
    expect(detectCritique('Why did you use that approach?')).toBe(true);
  });

  it('should detect "that\'s wrong"', () => {
    expect(detectCritique("That's wrong, the answer should be 42")).toBe(true);
  });

  it('should detect "fix your"', () => {
    expect(detectCritique('Fix your approach to error handling')).toBe(true);
  });

  it('should detect "you should"', () => {
    expect(detectCritique('You should be more concise')).toBe(true);
  });

  it('should not detect normal messages', () => {
    expect(detectCritique('Can you analyze this data?')).toBe(false);
    expect(detectCritique('What is the weather today?')).toBe(false);
  });
});

describe('Diff Formatting', () => {
  it('should show diff between original and proposed', () => {
    const original = 'Line 1\nLine 2\nLine 3';
    const proposed = 'Line 1\nModified Line 2\nLine 3';
    const diff = formatDiffForSlack(original, proposed);

    expect(diff).toContain('```diff');
    expect(diff).toContain('- Line 2');
    expect(diff).toContain('+ Modified Line 2');
  });

  it('should show no changes when identical', () => {
    const text = 'Same text';
    expect(formatDiffForSlack(text, text)).toBe('_No changes detected_');
  });
});
