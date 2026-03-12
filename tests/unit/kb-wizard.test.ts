import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockCreateKBEntry = vi.fn();
const mockApproveKBEntry = vi.fn();

vi.mock('../../src/modules/knowledge-base', () => ({
  createKBEntry: (...args: any[]) => mockCreateKBEntry(...args),
  approveKBEntry: (...args: any[]) => mockApproveKBEntry(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createWizardState,
  generateSuggestionsHeuristic,
  generateSuggestions,
  advanceWizard,
  completeWizard,
  createAgentContribution,
  approveContribution,
  type WizardState,
  type WizardSuggestions,
} from '../../src/modules/kb-wizard';

// ── Helpers ──

function makeWizardState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    step: 'content',
    content: 'Some test content for the knowledge base entry.',
    suggestions: null,
    overrides: {},
    sourceType: 'manual',
    contributedBy: null,
    ...overrides,
  };
}

function makeSuggestions(overrides: Partial<WizardSuggestions> = {}): WizardSuggestions {
  return {
    title: 'Test Title',
    summary: 'Test summary.',
    category: 'General',
    tags: ['test', 'knowledge'],
    ...overrides,
  };
}

function makeKBEntry(overrides: Record<string, any> = {}) {
  return {
    id: 'entry-1',
    title: 'Test Title',
    summary: 'Test summary.',
    content: 'Some content',
    category: 'General',
    tags: ['test'],
    access_scope: 'all',
    source_type: 'manual',
    contributed_by: null,
    approved: true,
    kb_source_id: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ──

describe('KB Wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createWizardState ──

  describe('createWizardState', () => {
    it('should create state with initial step "content"', () => {
      const state = createWizardState('Hello world', 'manual');
      expect(state.step).toBe('content');
      expect(state.content).toBe('Hello world');
      expect(state.sourceType).toBe('manual');
      expect(state.suggestions).toBeNull();
      expect(state.overrides).toEqual({});
      expect(state.contributedBy).toBeNull();
    });

    it('should set contributedBy when provided', () => {
      const state = createWizardState('Content', 'agent', 'agent-123');
      expect(state.contributedBy).toBe('agent-123');
    });

    it('should default contributedBy to null when not provided', () => {
      const state = createWizardState('Content', 'manual');
      expect(state.contributedBy).toBeNull();
    });

    it('should accept different source types', () => {
      expect(createWizardState('c', 'github').sourceType).toBe('github');
      expect(createWizardState('c', 'google_drive').sourceType).toBe('google_drive');
      expect(createWizardState('c', 'agent').sourceType).toBe('agent');
    });
  });

  // ── generateSuggestionsHeuristic ──

  describe('generateSuggestionsHeuristic', () => {
    it('should extract title from first line', () => {
      const result = generateSuggestionsHeuristic('My Document Title\nSome body text.');
      expect(result.title).toBe('My Document Title');
    });

    it('should truncate title to 80 characters', () => {
      const longTitle = 'A'.repeat(120);
      const result = generateSuggestionsHeuristic(longTitle);
      expect(result.title.length).toBe(80);
    });

    it('should generate summary from first two sentences', () => {
      const content = 'First sentence here. Second sentence follows. Third is ignored.';
      const result = generateSuggestionsHeuristic(content);
      expect(result.summary).toContain('First sentence here');
      expect(result.summary).toContain('Second sentence follows');
    });

    it('should set category to General', () => {
      const result = generateSuggestionsHeuristic('Anything');
      expect(result.category).toBe('General');
    });

    it('should extract tags from word frequency (words > 4 chars)', () => {
      const content = 'deployment deployment deployment testing testing configuration';
      const result = generateSuggestionsHeuristic(content);
      expect(result.tags).toContain('deployment');
      expect(result.tags).toContain('testing');
      expect(result.tags).toContain('configuration');
    });

    it('should ignore short words for tags', () => {
      const content = 'the and for but deployment testing';
      const result = generateSuggestionsHeuristic(content);
      // 'the', 'and', 'for', 'but' all have <= 4 chars
      expect(result.tags).not.toContain('the');
      expect(result.tags).not.toContain('and');
    });

    it('should limit tags to 5', () => {
      const words = Array.from({ length: 20 }, (_, i) => `longword${i}`);
      const content = words.join(' ');
      const result = generateSuggestionsHeuristic(content);
      expect(result.tags.length).toBeLessThanOrEqual(5);
    });

    it('should sort tags by frequency (most frequent first)', () => {
      const content = 'alpha alpha alpha bravo bravo charlie';
      const result = generateSuggestionsHeuristic(content);
      expect(result.tags[0]).toBe('alpha');
      expect(result.tags[1]).toBe('bravo');
    });

    it('should handle empty content', () => {
      const result = generateSuggestionsHeuristic('');
      // Empty string is falsy, so the || 'Untitled' fallback kicks in
      expect(result.title).toBe('Untitled');
      expect(result.category).toBe('General');
      expect(result.tags).toEqual([]);
    });

    it('should handle single-line content with no sentences', () => {
      const result = generateSuggestionsHeuristic('No period here');
      expect(result.title).toBe('No period here');
    });

    it('should use "Untitled" when first line is empty', () => {
      const result = generateSuggestionsHeuristic('\nSome body');
      // first line is '', so falls through to 'Untitled' in the || chain
      expect(result.title).toBe('Untitled');
    });
  });

  // ── generateSuggestions (AI-powered with fallback) ──

  describe('generateSuggestions', () => {
    it('should fall back to heuristics when Anthropic import fails', async () => {
      // The Anthropic SDK is dynamically imported, and in test env won't be configured
      // so it will throw and fall back to heuristics
      const content = 'Fallback test content for heuristic generation.';
      const result = await generateSuggestions(content);
      expect(result.title).toBeTruthy();
      expect(result.category).toBe('General');
    });

    it('should return valid WizardSuggestions shape', async () => {
      const result = await generateSuggestions('Some content here.');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('tags');
      expect(Array.isArray(result.tags)).toBe(true);
    });
  });

  // ── advanceWizard ──

  describe('advanceWizard', () => {
    it('should move to "metadata" step on "suggest" action', async () => {
      const state = makeWizardState({ content: 'Meaningful content about software deployment.' });
      const next = await advanceWizard(state, 'suggest');
      expect(next.step).toBe('metadata');
      expect(next.suggestions).not.toBeNull();
    });

    it('should preserve content when advancing', async () => {
      const state = makeWizardState({ content: 'My precious content' });
      const next = await advanceWizard(state, 'suggest');
      expect(next.content).toBe('My precious content');
    });

    it('should merge overrides on "override" action', async () => {
      const state = makeWizardState({
        overrides: { title: 'Original' },
      });
      const next = await advanceWizard(state, 'override', { category: 'Engineering' });
      expect(next.overrides).toEqual({ title: 'Original', category: 'Engineering' });
    });

    it('should replace individual override fields', async () => {
      const state = makeWizardState({
        overrides: { title: 'Old Title' },
      });
      const next = await advanceWizard(state, 'override', { title: 'New Title' });
      expect(next.overrides.title).toBe('New Title');
    });

    it('should not change step on "override" action', async () => {
      const state = makeWizardState({ step: 'metadata' });
      const next = await advanceWizard(state, 'override', { title: 'Override' });
      expect(next.step).toBe('metadata');
    });

    it('should move to "confirm" step on "confirm" action', async () => {
      const suggestions = makeSuggestions();
      const state = makeWizardState({ step: 'metadata', suggestions });
      const next = await advanceWizard(state, 'confirm');
      expect(next.step).toBe('confirm');
    });

    it('should apply overrides on confirm', async () => {
      const suggestions = makeSuggestions({ title: 'Original' });
      const state = makeWizardState({
        step: 'metadata',
        suggestions,
        overrides: { title: 'Overridden Title' },
      });
      const next = await advanceWizard(state, 'confirm');
      expect(next.suggestions!.title).toBe('Overridden Title');
    });

    it('should generate suggestions on confirm if none exist', async () => {
      const state = makeWizardState({
        step: 'metadata',
        suggestions: null,
        content: 'Content without prior suggestions for generation.',
      });
      const next = await advanceWizard(state, 'confirm');
      expect(next.step).toBe('confirm');
      expect(next.suggestions).not.toBeNull();
    });

    it('should return state unchanged for unknown actions', async () => {
      const state = makeWizardState();
      const next = await advanceWizard(state, 'unknown' as any);
      expect(next).toEqual(state);
    });
  });

  // ── completeWizard ──

  describe('completeWizard', () => {
    it('should throw if no suggestions are set', async () => {
      const state = makeWizardState({ suggestions: null });
      await expect(completeWizard(state)).rejects.toThrow('Cannot complete wizard without suggestions');
    });

    it('should call createKBEntry with correct params', async () => {
      const suggestions = makeSuggestions({ title: 'Final Title', category: 'Engineering' });
      const state = makeWizardState({
        step: 'confirm',
        content: 'Full article content',
        suggestions,
        sourceType: 'manual',
        contributedBy: 'U001',
      });

      const entry = makeKBEntry({ title: 'Final Title' });
      mockCreateKBEntry.mockResolvedValue(entry);

      const result = await completeWizard(state);

      expect(mockCreateKBEntry).toHaveBeenCalledWith({
        title: 'Final Title',
        summary: 'Test summary.',
        content: 'Full article content',
        category: 'Engineering',
        tags: ['test', 'knowledge'],
        accessScope: 'all',
        sourceType: 'manual',
        contributedBy: 'U001',
        approved: true,
      });
      expect(result).toEqual(entry);
    });

    it('should use overrides over suggestions', async () => {
      const suggestions = makeSuggestions({ title: 'Suggested', category: 'General' });
      const state = makeWizardState({
        step: 'confirm',
        content: 'Content',
        suggestions,
        overrides: { title: 'Override Title', category: 'Engineering' },
        sourceType: 'manual',
      });

      mockCreateKBEntry.mockResolvedValue(makeKBEntry());
      await completeWizard(state);

      const call = mockCreateKBEntry.mock.calls[0][0];
      expect(call.title).toBe('Override Title');
      expect(call.category).toBe('Engineering');
    });

    it('should set approved=true for manual source type', async () => {
      const state = makeWizardState({
        suggestions: makeSuggestions(),
        sourceType: 'manual',
      });
      mockCreateKBEntry.mockResolvedValue(makeKBEntry());
      await completeWizard(state);
      expect(mockCreateKBEntry.mock.calls[0][0].approved).toBe(true);
    });

    it('should set approved=false for non-manual source types', async () => {
      const state = makeWizardState({
        suggestions: makeSuggestions(),
        sourceType: 'agent',
      });
      mockCreateKBEntry.mockResolvedValue(makeKBEntry({ approved: false }));
      await completeWizard(state);
      expect(mockCreateKBEntry.mock.calls[0][0].approved).toBe(false);
    });

    it('should pass contributedBy as undefined when null', async () => {
      const state = makeWizardState({
        suggestions: makeSuggestions(),
        contributedBy: null,
      });
      mockCreateKBEntry.mockResolvedValue(makeKBEntry());
      await completeWizard(state);
      expect(mockCreateKBEntry.mock.calls[0][0].contributedBy).toBeUndefined();
    });
  });

  // ── createAgentContribution ──

  describe('createAgentContribution', () => {
    it('should create a KB entry with agent source type', async () => {
      const suggestions = makeSuggestions({ title: 'Agent Insight' });
      const entry = makeKBEntry({ source_type: 'agent', approved: false });
      mockCreateKBEntry.mockResolvedValue(entry);

      const result = await createAgentContribution('agent-1', 'Agent content', suggestions);

      expect(mockCreateKBEntry).toHaveBeenCalledWith({
        title: 'Agent Insight',
        summary: 'Test summary.',
        content: 'Agent content',
        category: 'General',
        tags: ['test', 'knowledge'],
        accessScope: 'all',
        sourceType: 'agent',
        contributedBy: 'agent-1',
        approved: false,
      });
      expect(result).toEqual(entry);
    });

    it('should always set approved to false', async () => {
      mockCreateKBEntry.mockResolvedValue(makeKBEntry());
      await createAgentContribution('a1', 'content', makeSuggestions());
      expect(mockCreateKBEntry.mock.calls[0][0].approved).toBe(false);
    });
  });

  // ── approveContribution ──

  describe('approveContribution', () => {
    it('should call approveKBEntry with the entry ID', async () => {
      const entry = makeKBEntry({ approved: true });
      mockApproveKBEntry.mockResolvedValue(entry);

      const result = await approveContribution('entry-1');

      expect(mockApproveKBEntry).toHaveBeenCalledWith('entry-1');
      expect(result).toEqual(entry);
    });

    it('should propagate errors from approveKBEntry', async () => {
      mockApproveKBEntry.mockRejectedValue(new Error('Entry not found'));
      await expect(approveContribution('bad-id')).rejects.toThrow('Entry not found');
    });
  });
});
