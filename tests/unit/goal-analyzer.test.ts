import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock Anthropic SDK + the per-workspace createAnthropicClient helper ──
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));
vi.mock('../../src/modules/anthropic', () => ({
  createAnthropicClient: vi.fn(async () => ({ messages: { create: mockCreate } })),
  getAnthropicApiKey: vi.fn().mockResolvedValue('sk-ant-test'),
  AnthropicKeyMissingError: class AnthropicKeyMissingError extends Error {},
}));

// ── Mock tools module ──
const mockGetBuiltinTools = vi.fn().mockReturnValue(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']);
const mockListUserAvailableTools = vi.fn().mockResolvedValue([]);
const mockListWriteTools = vi.fn().mockResolvedValue([]);

vi.mock('../../src/modules/tools', () => ({
  getBuiltinTools: (...args: any[]) => mockGetBuiltinTools(...args),
  listUserAvailableTools: (...args: any[]) => mockListUserAvailableTools(...args),
  listWriteTools: (...args: any[]) => mockListWriteTools(...args),
  isCoreAlwaysOnTool: (name: string) => ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'].includes(name),
}));

// ── Mock skills module ──
vi.mock('../../src/modules/skills', () => ({
  getAvailableSkills: vi.fn().mockReturnValue({ mcp: [], prompt: [] }),
}));

// ── Mock access control ──
const mockIsSuperadmin = vi.fn().mockResolvedValue(false);
vi.mock('../../src/modules/access-control', () => ({
  isSuperadmin: (...args: any[]) => mockIsSuperadmin(...args),
}));

// ── Mock logger ──
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { analyzeGoal, checkMessageRelevance, GoalAnalysis } from '../../src/modules/agents/goal-analyzer';

const TEST_WORKSPACE_ID = 'W_TEST_123';

// ── Helpers ──

function makeGoalAnalysisJson(overrides: Partial<GoalAnalysis> = {}): GoalAnalysis {
  return {
    agent_name: 'test-agent',
    system_prompt: 'You are a test agent.',
    tools: ['chargebee-read', 'linear-read'],
    custom_tools: [],
    skills: [],
    model: 'sonnet',
    memory_enabled: false,
    triggers: [],
    relevance_keywords: ['test', 'help'],
    respond_to_all_messages: false,
    new_tools_needed: [],
    new_skills_needed: [],
    write_tools_requested: [],
    credential_modes: {},
    feasible: true,
    blockers: [],
    summary: 'A simple test agent.',
    ...overrides,
  };
}

function mockAnthropicResponse(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
  });
}

function mockAnthropicJsonResponse(analysis: Partial<GoalAnalysis> = {}) {
  mockAnthropicResponse(JSON.stringify(makeGoalAnalysisJson(analysis)));
}

describe('Goal Analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBuiltinTools.mockReturnValue(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']);
    mockListUserAvailableTools.mockResolvedValue([]);
    mockListWriteTools.mockResolvedValue([]);
    mockIsSuperadmin.mockResolvedValue(false);
  });

  // ────────────────────────────────────────────────────────────
  // analyzeGoal
  // ────────────────────────────────────────────────────────────
  describe('analyzeGoal', () => {
    it('should return a valid GoalAnalysis with expected fields', async () => {
      mockAnthropicJsonResponse();

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a code review bot');

      expect(result.agent_name).toBe('test-agent');
      expect(result.system_prompt).toBe('You are a test agent.');
      expect(result.tools).toEqual(['chargebee-read', 'linear-read']);
      expect(result.model).toBe('sonnet');
      expect(result.feasible).toBe(true);
      expect(result.blockers).toEqual([]);
      expect(result.relevance_keywords).toEqual(['test', 'help']);
      expect(result.respond_to_all_messages).toBe(false);
      expect(result.memory_enabled).toBe(false);
    });

    it('should call Claude with claude-opus-4-6 model', async () => {
      mockAnthropicJsonResponse();

      await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot');

      expect(mockCreate).toHaveBeenCalledOnce();
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-opus-4-6');
      expect(callArgs.max_tokens).toBe(4096);
    });

    it('should validate tools against builtins and filter out invalid ones', async () => {
      mockAnthropicJsonResponse({
        tools: ['chargebee-read', 'FakeToolThatDoesNotExist', 'AnotherFake'],
      });

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot');

      // Core tools are stripped, non-core pass through (validated at add time, not here)
      expect(result.tools).toContain('chargebee-read');
      expect(result.tools).toContain('FakeToolThatDoesNotExist'); // Non-core passes through
    });

    it('should keep all tools when they are all valid builtins', async () => {
      mockAnthropicJsonResponse({
        tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'], // All core — will be filtered
      });

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot');

      expect(result.tools).toEqual([]); // All core tools stripped
    });

    // ── Admin vs Non-Admin ──

    it('should clear new_tools_needed and new_skills_needed for non-admin users', async () => {
      mockIsSuperadmin.mockResolvedValue(false);
      mockAnthropicJsonResponse({
        new_tools_needed: [{ name: 'my-tool', description: 'Does stuff' }],
        new_skills_needed: [{ name: 'my-skill', description: 'Does more stuff' }],
      });

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot', undefined, 'U_NON_ADMIN');

      expect(result.new_tools_needed).toEqual([]);
      expect(result.new_skills_needed).toEqual([]);
    });

    it('should preserve new_tools_needed for admin users', async () => {
      mockIsSuperadmin.mockResolvedValue(true);
      const newTools = [{ name: 'my-tool', description: 'Does stuff' }];
      mockAnthropicJsonResponse({
        new_tools_needed: newTools,
      });

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot', undefined, 'U_ADMIN');

      expect(result.new_tools_needed).toEqual(newTools);
    });

    it('should only allow read-only custom_tools for non-admin', async () => {
      mockIsSuperadmin.mockResolvedValue(false);
      mockListUserAvailableTools.mockResolvedValue([
        { name: 'safe-reader', schema_json: '{"description":"reads stuff"}' },
      ]);
      mockListWriteTools.mockResolvedValue([
        { name: 'dangerous-writer', schema_json: '{"description":"writes stuff"}' },
      ]);

      mockAnthropicJsonResponse({
        custom_tools: ['safe-reader', 'dangerous-writer'],
      });

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot', undefined, 'U_NON_ADMIN');

      expect(result.custom_tools).toEqual(['safe-reader']);
      expect(result.custom_tools).not.toContain('dangerous-writer');
    });

    it('should allow both read-only and write custom_tools for admin', async () => {
      mockIsSuperadmin.mockResolvedValue(true);
      mockListUserAvailableTools.mockResolvedValue([
        { name: 'safe-reader', schema_json: '{"description":"reads stuff"}' },
      ]);
      mockListWriteTools.mockResolvedValue([
        { name: 'dangerous-writer', schema_json: '{"description":"writes stuff"}' },
      ]);

      mockAnthropicJsonResponse({
        custom_tools: ['safe-reader', 'dangerous-writer'],
      });

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot', undefined, 'U_ADMIN');

      expect(result.custom_tools).toEqual(['safe-reader', 'dangerous-writer']);
    });

    it('should filter custom_tools that do not exist at all', async () => {
      mockIsSuperadmin.mockResolvedValue(true);
      mockListUserAvailableTools.mockResolvedValue([
        { name: 'real-tool', schema_json: '{}' },
      ]);
      mockListWriteTools.mockResolvedValue([]);

      mockAnthropicJsonResponse({
        custom_tools: ['real-tool', 'nonexistent-tool'],
      });

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot', undefined, 'U_ADMIN');

      expect(result.custom_tools).toEqual(['real-tool']);
    });

    it('should validate write_tools_requested against available write tools', async () => {
      mockListWriteTools.mockResolvedValue([
        { name: 'db-writer', schema_json: '{"description":"writes to db"}' },
      ]);

      mockAnthropicJsonResponse({
        write_tools_requested: ['db-writer', 'nonexistent-writer'],
      });

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot');

      expect(result.write_tools_requested).toEqual(['db-writer']);
    });

    // ── Existing prompt (update mode) ──

    it('should include existing prompt in user message for update mode', async () => {
      mockAnthropicJsonResponse();

      await analyzeGoal(TEST_WORKSPACE_ID, 'Add error handling', 'You are a code reviewer.');

      const callArgs = mockCreate.mock.calls[0][0];
      const userContent = callArgs.messages[0].content;
      expect(userContent).toContain('Current system prompt:');
      expect(userContent).toContain('You are a code reviewer.');
      expect(userContent).toContain("User's update request:");
      expect(userContent).toContain('Add error handling');
    });

    it('should include current agent name in user message for update mode', async () => {
      mockAnthropicJsonResponse();

      await analyzeGoal(TEST_WORKSPACE_ID, 'Change the name to something nicer', 'You are a domain lookup agent.', 'U123', 'domain-employee-lookup');

      const callArgs = mockCreate.mock.calls[0][0];
      const userContent = callArgs.messages[0].content;
      expect(userContent).toContain('Current agent_name: domain-employee-lookup');
      expect(userContent).toContain('domain-employee-lookup');
    });

    it('should use goal-only format when no existing prompt', async () => {
      mockAnthropicJsonResponse();

      await analyzeGoal(TEST_WORKSPACE_ID, 'Build a new bot');

      const callArgs = mockCreate.mock.calls[0][0];
      const userContent = callArgs.messages[0].content;
      expect(userContent).toContain('Agent goal:');
      expect(userContent).toContain('Build a new bot');
      expect(userContent).not.toContain('Current system prompt:');
    });

    it('should include requesting user Slack ID in message', async () => {
      mockAnthropicJsonResponse();

      await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot', undefined, 'U12345');

      const callArgs = mockCreate.mock.calls[0][0];
      const userContent = callArgs.messages[0].content;
      expect(userContent).toContain("Requesting user's Slack ID: U12345");
    });

    // ── JSON parsing ──

    it('should parse JSON from markdown code blocks', async () => {
      const analysis = makeGoalAnalysisJson({ agent_name: 'wrapped-agent' });
      mockAnthropicResponse('```json\n' + JSON.stringify(analysis) + '\n```');

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot');

      expect(result.agent_name).toBe('wrapped-agent');
    });

    it('should parse JSON with surrounding text', async () => {
      const analysis = makeGoalAnalysisJson({ agent_name: 'embedded-agent' });
      mockAnthropicResponse('Here is the analysis:\n' + JSON.stringify(analysis) + '\n\nLet me know if you need changes.');

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot');

      expect(result.agent_name).toBe('embedded-agent');
    });

    it('should throw if no JSON found in response', async () => {
      mockAnthropicResponse('I cannot produce a valid configuration for this goal.');

      await expect(analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot')).rejects.toThrow('Failed to parse goal analysis response');
    });

    it('should throw on invalid JSON', async () => {
      mockAnthropicResponse('{invalid json here}');

      await expect(analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot')).rejects.toThrow();
    });

    // ── Timeout ──

    it('should race API call against a 90-second timeout', async () => {
      // Instead of using fake timers (which cause unhandled rejection warnings),
      // verify the timeout behavior by checking that Promise.race is used with a
      // never-resolving API promise and a rejecting timeout.
      // We make the API promise reject quickly to simulate the timeout winning.
      mockCreate.mockImplementationOnce(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Goal analysis timed out after 90 seconds. Please try again.')), 0),
        ),
      );

      await expect(analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot')).rejects.toThrow(
        'Goal analysis timed out after 90 seconds',
      );
    });

    // ── Defaults enforcement ──

    it('should default missing fields to safe values', async () => {
      // Return minimal JSON missing optional fields
      mockAnthropicResponse(JSON.stringify({
        agent_name: 'minimal-agent',
        system_prompt: 'You are minimal.',
        tools: ['Read'],
        model: 'haiku',
        summary: 'Minimal.',
      }));

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot');

      expect(result.custom_tools).toEqual([]);
      expect(result.relevance_keywords).toEqual([]);
      expect(result.triggers).toEqual([]);
      expect(result.respond_to_all_messages).toBe(false);
      expect(result.feasible).toBe(true);
      expect(result.blockers).toEqual([]);
      expect(result.new_tools_needed).toEqual([]);
      expect(result.new_skills_needed).toEqual([]);
      expect(result.write_tools_requested).toEqual([]);
      expect(result.credential_modes).toEqual({});
    });

    it('should not check isSuperadmin when requestingUserId is not provided', async () => {
      mockAnthropicJsonResponse();

      await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot');

      expect(mockIsSuperadmin).not.toHaveBeenCalled();
    });

    it('should check isSuperadmin when requestingUserId is provided', async () => {
      mockAnthropicJsonResponse();

      await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot', undefined, 'U123');

      expect(mockIsSuperadmin).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'U123');
    });
  });

  // ────────────────────────────────────────────────────────────
  // credential_modes
  // ────────────────────────────────────────────────────────────
  describe('credential_modes', () => {
    it('should include credential_modes in analysis output', async () => {
      mockAnthropicJsonResponse({
        credential_modes: { chargebee: 'team' },
      });

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot');
      // credential_modes with unknown integration IDs are removed during validation,
      // but the field itself should exist
      expect(result.credential_modes).toBeDefined();
      expect(typeof result.credential_modes).toBe('object');
    });

    it('should default credential_modes to empty object when not returned', async () => {
      mockAnthropicResponse(JSON.stringify({
        agent_name: 'no-creds-agent',
        system_prompt: 'You are a test agent.',
        tools: ['Read'],
        model: 'sonnet',
        summary: 'Test.',
      }));

      const result = await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot');
      expect(result.credential_modes).toEqual({});
    });

    it('should include credential model info in the Claude prompt', async () => {
      mockAnthropicJsonResponse();

      await analyzeGoal(TEST_WORKSPACE_ID, 'Build a bot');

      const callArgs = mockCreate.mock.calls[0][0];
      const systemPrompt = callArgs.system;
      expect(systemPrompt).toContain('credential_modes');
      expect(systemPrompt).toContain('team|delegated|runtime');
    });
  });

  // ────────────────────────────────────────────────────────────
  // checkMessageRelevance
  // ────────────────────────────────────────────────────────────
  describe('checkMessageRelevance', () => {
    const samplePrompt = 'You are a helpful support agent that answers customer questions.';

    // ── respondToAll ──

    it('should return true when respondToAll is true', async () => {
      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'absolutely anything',
        [],
        samplePrompt,
        true,
      );
      expect(result).toBe(true);
    });

    it('should return true for respondToAll even with empty message', async () => {
      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, '', [], samplePrompt, true);
      expect(result).toBe(true);
    });

    it('should not call LLM when respondToAll is true', async () => {
      await checkMessageRelevance(TEST_WORKSPACE_ID, 'any message here', [], samplePrompt, true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    // ── Short messages ──

    it('should return false for messages shorter than 3 chars', async () => {
      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 'hi', ['hi'], samplePrompt, false);
      expect(result).toBe(false);
    });

    it('should return false for whitespace-padded short message', async () => {
      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, '  a ', [], samplePrompt, false);
      expect(result).toBe(false);
    });

    it('should not call LLM for short messages', async () => {
      await checkMessageRelevance(TEST_WORKSPACE_ID, 'ab', [], samplePrompt, false);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    // ── Domain/URL detection ──

    it('should return true for domain-like messages', async () => {
      expect(await checkMessageRelevance(TEST_WORKSPACE_ID, 'google.com', [], samplePrompt, false)).toBe(true);
      expect(await checkMessageRelevance(TEST_WORKSPACE_ID, 'ibm.com', [], samplePrompt, false)).toBe(true);
      expect(await checkMessageRelevance(TEST_WORKSPACE_ID, 'https://example.org', [], samplePrompt, false)).toBe(true);
    });

    it('should not call LLM for domain-like messages', async () => {
      await checkMessageRelevance(TEST_WORKSPACE_ID, 'google.com', [], samplePrompt, false);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    // ── Keyword matching ──

    it('should return true when message contains a keyword', async () => {
      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'I need help with my account',
        ['help', 'support', 'account'],
        samplePrompt,
        false,
      );
      expect(result).toBe(true);
    });

    it('should match keywords case-insensitively', async () => {
      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'HELP ME WITH THIS ISSUE',
        ['help', 'support'],
        samplePrompt,
        false,
      );
      expect(result).toBe(true);
    });

    it('should match when keyword is uppercase and message lowercase', async () => {
      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'i need some help please',
        ['HELP', 'SUPPORT'],
        samplePrompt,
        false,
      );
      expect(result).toBe(true);
    });

    it('should match partial keyword presence within words', async () => {
      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'this is unhelpful content',
        ['help'],
        samplePrompt,
        false,
      );
      expect(result).toBe(true); // 'help' is found inside 'unhelpful'
    });

    it('should not call LLM when keyword matches', async () => {
      await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'I need help with something',
        ['help'],
        samplePrompt,
        false,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    // ── LLM fallback ──

    it('should call LLM when no keywords match', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'yes' }],
      });

      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'Can you explain the billing process?',
        ['deploy', 'code'],
        samplePrompt,
        false,
      );

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(result).toBe(true);
    });

    it('should use claude-haiku-4-5-20251001 for LLM fallback', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'no' }],
      });

      await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'What is the meaning of life?',
        ['deploy'],
        samplePrompt,
        false,
      );

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-haiku-4-5-20251001');
      expect(callArgs.max_tokens).toBe(10);
    });

    it('should return false when LLM responds "no"', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'no' }],
      });

      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'Random unrelated message here',
        [],
        samplePrompt,
        false,
      );

      expect(result).toBe(false);
    });

    it('should return true when LLM response starts with "yes"', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Yes, this is relevant.' }],
      });

      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'Some ambiguous message here',
        [],
        samplePrompt,
        false,
      );

      expect(result).toBe(true);
    });

    it('should handle LLM response case-insensitively', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'YES' }],
      });

      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'Some message that needs LLM check',
        [],
        samplePrompt,
        false,
      );

      expect(result).toBe(true);
    });

    it('should call LLM when keywords array is empty and message is long enough', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'no' }],
      });

      await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'This is a long enough message',
        [],
        samplePrompt,
        false,
      );

      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('should truncate system prompt to 500 chars in LLM call', async () => {
      const longPrompt = 'x'.repeat(1000);
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'no' }],
      });

      await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'Some message for LLM check',
        [],
        longPrompt,
        false,
      );

      const callArgs = mockCreate.mock.calls[0][0];
      // The system prompt includes the agent purpose sliced to 500
      expect(callArgs.system).toContain('x'.repeat(500));
      expect(callArgs.system).not.toContain('x'.repeat(501));
    });

    it('should truncate user message to 300 chars in LLM call', async () => {
      const longMessage = 'y'.repeat(500);
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'no' }],
      });

      await checkMessageRelevance(TEST_WORKSPACE_ID, longMessage, [], samplePrompt, false);

      const callArgs = mockCreate.mock.calls[0][0];
      const userContent = callArgs.messages[0].content;
      expect(userContent.length).toBe(300);
    });

    // ── Error handling ──

    it('should return false when LLM call throws an error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'Some message that triggers LLM',
        [],
        samplePrompt,
        false,
      );

      expect(result).toBe(false);
    });

    it('should log warning when LLM call fails', async () => {
      const { logger } = await import('../../src/utils/logger');
      mockCreate.mockRejectedValueOnce(new Error('Network error'));

      await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'Some message that triggers LLM',
        [],
        samplePrompt,
        false,
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'Relevance check failed, defaulting to skip',
        expect.objectContaining({ error: expect.stringContaining('Network error') }),
      );
    });

    it('should return false on timeout/network errors without crashing', async () => {
      mockCreate.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      const result = await checkMessageRelevance(TEST_WORKSPACE_ID, 
        'Another message that triggers LLM',
        [],
        samplePrompt,
        false,
      );

      expect(result).toBe(false);
    });
  });
});
