import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockGetAgent = vi.fn();
const mockUpdateAgent = vi.fn();
const mockGetAgentVersions = vi.fn();
const mockRevertAgent = vi.fn();
const mockAnthropicCreate = vi.fn();

vi.mock('../../src/modules/agents', () => ({
  getAgent: (...args: any[]) => mockGetAgent(...args),
  updateAgent: (...args: any[]) => mockUpdateAgent(...args),
  getAgentVersions: (...args: any[]) => mockGetAgentVersions(...args),
  revertAgent: (...args: any[]) => mockRevertAgent(...args),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: (...args: any[]) => mockAnthropicCreate(...args) },
  })),
}));

vi.mock('../../src/modules/anthropic', () => ({
  createAnthropicClient: vi.fn(async () => ({ messages: { create: (...args: any[]) => mockAnthropicCreate(...args) } })),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  detectCritique,
  formatDiffForSlack,
  generatePromptDiff,
  applyPromptDiff,
  revertToVersion,
  checkPromptSize,
} from '../../src/modules/self-improvement';

const TEST_WORKSPACE_ID = 'W_TEST_123';

// ══════════════════════════════════════════════════
//  detectCritique
// ══════════════════════════════════════════════════

describe('Critique Detection', () => {
  it('should detect "why did you" critique', () => {
    expect(detectCritique('Why did you use that approach?')).toBe(true);
  });

  it('should detect "that\'s wrong"', () => {
    expect(detectCritique("That's wrong, the answer should be 42")).toBe(true);
  });

  it('should detect "thats wrong" (without apostrophe)', () => {
    expect(detectCritique('thats wrong')).toBe(true);
  });

  it('should detect "fix your"', () => {
    expect(detectCritique('Fix your approach to error handling')).toBe(true);
  });

  it('should detect "you should"', () => {
    expect(detectCritique('You should be more concise')).toBe(true);
  });

  it('should detect "don\'t do that"', () => {
    expect(detectCritique("Don't do that again")).toBe(true);
  });

  it('should detect "dont do that"', () => {
    expect(detectCritique('dont do that')).toBe(true);
  });

  it('should detect "instead of"', () => {
    expect(detectCritique('Instead of summarizing, give full details')).toBe(true);
  });

  it('should detect "that was incorrect"', () => {
    expect(detectCritique('That was incorrect, please re-check')).toBe(true);
  });

  it('should detect "please change"', () => {
    expect(detectCritique('Please change your tone')).toBe(true);
  });

  it('should detect "improve your"', () => {
    expect(detectCritique('Improve your response formatting')).toBe(true);
  });

  it('should detect "stop doing"', () => {
    expect(detectCritique('Stop doing that thing')).toBe(true);
  });

  it('should detect "next time"', () => {
    expect(detectCritique('Next time, be more careful')).toBe(true);
  });

  it('should detect "you need to"', () => {
    expect(detectCritique('You need to fix this')).toBe(true);
  });

  it('should not detect normal messages', () => {
    expect(detectCritique('Can you analyze this data?')).toBe(false);
    expect(detectCritique('What is the weather today?')).toBe(false);
    expect(detectCritique('Hello there')).toBe(false);
    expect(detectCritique('Run the report for Q4')).toBe(false);
  });

  it('should be case insensitive', () => {
    expect(detectCritique('WHY DID YOU do that?')).toBe(true);
    expect(detectCritique('FIX YOUR formatting')).toBe(true);
  });

  it('should return false for empty string', () => {
    expect(detectCritique('')).toBe(false);
  });
});

// ══════════════════════════════════════════════════
//  formatDiffForSlack
// ══════════════════════════════════════════════════

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

  it('should handle added lines', () => {
    const original = 'Line 1';
    const proposed = 'Line 1\nLine 2';
    const diff = formatDiffForSlack(original, proposed);

    expect(diff).toContain('+ Line 2');
  });

  it('should handle removed lines', () => {
    const original = 'Line 1\nLine 2';
    const proposed = 'Line 1';
    const diff = formatDiffForSlack(original, proposed);

    expect(diff).toContain('- Line 2');
  });

  it('should handle completely different content', () => {
    const original = 'Hello world';
    const proposed = 'Goodbye world';
    const diff = formatDiffForSlack(original, proposed);

    expect(diff).toContain('- Hello world');
    expect(diff).toContain('+ Goodbye world');
  });

  it('should handle multi-line diffs', () => {
    const original = 'A\nB\nC\nD';
    const proposed = 'A\nX\nC\nY';
    const diff = formatDiffForSlack(original, proposed);

    expect(diff).toContain('- B');
    expect(diff).toContain('+ X');
    expect(diff).toContain('- D');
    expect(diff).toContain('+ Y');
  });

  it('should handle empty original', () => {
    const diff = formatDiffForSlack('', 'New content');
    expect(diff).toContain('+ New content');
  });

  it('should handle empty proposed', () => {
    const diff = formatDiffForSlack('Old content', '');
    expect(diff).toContain('- Old content');
  });

  it('should handle both empty', () => {
    expect(formatDiffForSlack('', '')).toBe('_No changes detected_');
  });
});

// ══════════════════════════════════════════════════
//  generatePromptDiff
// ══════════════════════════════════════════════════

describe('generatePromptDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate a prompt diff with AI-proposed changes', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'You are an improved agent. Be concise and accurate.' }],
    });

    const result = await generatePromptDiff(TEST_WORKSPACE_ID,
      'You are a helpful agent.',
      'You should be more concise.',
      'Some verbose output...'
    );

    expect(result.original).toBe('You are a helpful agent.');
    expect(result.proposed).toBeTruthy();
    expect(result.changeNote).toContain('Self-improvement');
    expect(result.changeNote).toContain('You should be more concise');
  });

  it('should truncate long critique in changeNote', async () => {
    const longCritique = 'x'.repeat(200);
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Improved prompt.' }],
    });

    const result = await generatePromptDiff(TEST_WORKSPACE_ID, 'Original', longCritique, 'Output');
    expect(result.changeNote.length).toBeLessThan(200);
  });

  it('should return original prompt unchanged when AI call fails', async () => {
    mockAnthropicCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

    const result = await generatePromptDiff(TEST_WORKSPACE_ID,
      'Original prompt here.',
      'Fix your tone.',
      'Output text'
    );

    expect(result.original).toBe('Original prompt here.');
    expect(result.proposed).toBe('Original prompt here.');
    expect(result.changeNote).toContain('AI generation failed');
    expect(result.changeNote).toContain('API rate limit exceeded');
  });

  it('should use original prompt when AI returns empty response', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '' }],
    });

    const result = await generatePromptDiff(TEST_WORKSPACE_ID, 'My prompt.', 'Improve it.', 'Output');
    expect(result.proposed).toBe('My prompt.');
  });
});

// ══════════════════════════════════════════════════
//  applyPromptDiff
// ══════════════════════════════════════════════════

describe('applyPromptDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update agent with new prompt and return version', async () => {
    const updatedAgent = { id: 'agent-1', system_prompt: 'New prompt' };
    mockUpdateAgent.mockResolvedValueOnce(updatedAgent);
    mockGetAgentVersions.mockResolvedValueOnce([
      { version: 3, changed_by: 'user-1', created_at: '2025-01-03' },
      { version: 2, changed_by: 'user-1', created_at: '2025-01-02' },
    ]);

    const result = await applyPromptDiff(TEST_WORKSPACE_ID, 'agent-1', 'New prompt', 'Bug fix', 'user-1');

    expect(result.agent).toEqual(updatedAgent);
    expect(result.version).toBe(3);
    expect(mockUpdateAgent).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'agent-1', { system_prompt: 'New prompt' }, 'user-1');
  });

  it('should default to version 1 when no versions exist', async () => {
    mockUpdateAgent.mockResolvedValueOnce({ id: 'agent-1' });
    mockGetAgentVersions.mockResolvedValueOnce([]);

    const result = await applyPromptDiff(TEST_WORKSPACE_ID, 'agent-1', 'Prompt', 'Initial', 'user-1');

    expect(result.version).toBe(1);
  });

  it('should propagate updateAgent errors', async () => {
    mockUpdateAgent.mockRejectedValueOnce(new Error('DB error'));

    await expect(applyPromptDiff(TEST_WORKSPACE_ID, 'agent-1', 'New prompt', 'note', 'user-1'))
      .rejects.toThrow('DB error');
  });
});

// ══════════════════════════════════════════════════
//  revertToVersion
// ══════════════════════════════════════════════════

describe('revertToVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call revertAgent and return the result', async () => {
    const revertedAgent = { id: 'agent-1', system_prompt: 'Old prompt v2' };
    mockRevertAgent.mockResolvedValueOnce(revertedAgent);

    const result = await revertToVersion(TEST_WORKSPACE_ID, 'agent-1', 2, 'user-1');

    expect(result).toEqual(revertedAgent);
    expect(mockRevertAgent).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'agent-1', 2, 'user-1');
  });

  it('should propagate errors from revertAgent', async () => {
    mockRevertAgent.mockRejectedValueOnce(new Error('Version not found'));

    await expect(revertToVersion(TEST_WORKSPACE_ID, 'agent-1', 99, 'user-1'))
      .rejects.toThrow('Version not found');
  });
});

// ══════════════════════════════════════════════════
//  checkPromptSize
// ══════════════════════════════════════════════════

describe('checkPromptSize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return token count and no warning for small prompts', async () => {
    mockGetAgent.mockResolvedValueOnce({
      id: 'agent-1',
      system_prompt: 'Short prompt',
    });

    const result = await checkPromptSize(TEST_WORKSPACE_ID, 'agent-1');

    expect(result.tokenCount).toBe(Math.ceil('Short prompt'.length / 4));
    expect(result.warning).toBe(false);
  });

  it('should return warning=true for prompts over 4000 tokens', async () => {
    // 4001 tokens = 16004 characters
    const longPrompt = 'x'.repeat(16004);
    mockGetAgent.mockResolvedValueOnce({
      id: 'agent-1',
      system_prompt: longPrompt,
    });

    const result = await checkPromptSize(TEST_WORKSPACE_ID, 'agent-1');

    expect(result.tokenCount).toBe(Math.ceil(longPrompt.length / 4));
    expect(result.warning).toBe(true);
  });

  it('should return warning=false for prompts at exactly 4000 tokens', async () => {
    // 4000 tokens = 16000 characters
    const prompt = 'x'.repeat(16000);
    mockGetAgent.mockResolvedValueOnce({
      id: 'agent-1',
      system_prompt: prompt,
    });

    const result = await checkPromptSize(TEST_WORKSPACE_ID, 'agent-1');

    expect(result.tokenCount).toBe(4000);
    expect(result.warning).toBe(false);
  });

  it('should throw if agent not found', async () => {
    mockGetAgent.mockResolvedValueOnce(null);

    await expect(checkPromptSize(TEST_WORKSPACE_ID, 'nonexistent'))
      .rejects.toThrow('Agent nonexistent not found');
  });

  it('should propagate getAgent errors', async () => {
    mockGetAgent.mockRejectedValueOnce(new Error('DB unavailable'));

    await expect(checkPromptSize(TEST_WORKSPACE_ID, 'agent-1'))
      .rejects.toThrow('DB unavailable');
  });
});
