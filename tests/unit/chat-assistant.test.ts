import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockGetAgent = vi.fn();
const mockListAgents = vi.fn();

vi.mock('../../src/modules/agents', () => ({
  getAgent: (...args: any[]) => mockGetAgent(...args),
  listAgents: (...args: any[]) => mockListAgents(...args),
}));

const mockGetRunRecord = vi.fn();
const mockGetRunsByAgent = vi.fn();
const mockGetRunToolCalls = vi.fn();
const mockGetRunTrace = vi.fn();

vi.mock('../../src/modules/execution', () => ({
  getRunRecord: (...args: any[]) => mockGetRunRecord(...args),
  getRunsByAgent: (...args: any[]) => mockGetRunsByAgent(...args),
  getRunToolCalls: (...args: any[]) => mockGetRunToolCalls(...args),
  getRunTrace: (...args: any[]) => mockGetRunTrace(...args),
}));

const mockGetAgentMemories = vi.fn();

vi.mock('../../src/modules/sources/memory', () => ({
  getAgentMemories: (...args: any[]) => mockGetAgentMemories(...args),
}));

const mockGetAgentErrorRates = vi.fn();

vi.mock('../../src/modules/observability', () => ({
  getAgentErrorRates: (...args: any[]) => mockGetAgentErrorRates(...args),
}));

const mockGetAuditLog = vi.fn();

vi.mock('../../src/modules/audit', () => ({
  getAuditLog: (...args: any[]) => mockGetAuditLog(...args),
}));

const mockGetAgentTriggers = vi.fn();

vi.mock('../../src/modules/triggers', () => ({
  getAgentTriggers: (...args: any[]) => mockGetAgentTriggers(...args),
}));

const mockGetCustomTool = vi.fn();

vi.mock('../../src/modules/tools', () => ({
  getCustomTool: (...args: any[]) => mockGetCustomTool(...args),
}));

const mockGetToolAnalytics = vi.fn();

vi.mock('../../src/modules/self-authoring', () => ({
  getToolAnalytics: (...args: any[]) => mockGetToolAnalytics(...args),
}));

vi.mock('../../src/modules/tools/integrations', () => ({
  getIntegration: () => undefined,
  getIntegrations: () => [],
}));

vi.mock('../../src/modules/access-control', () => ({
  canModifyAgent: () => true,
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { executeToolCall, DIAGNOSTIC_TOOLS, TOOL_CALL_LABELS } from '../../src/modules/chat-assistant/tools';
import { buildSystemPrompt, buildAgentContext } from '../../src/modules/chat-assistant/prompts';

// ── Tests ──

describe('Chat Assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tool Definitions', () => {
    it('defines 13 diagnostic tools', () => {
      expect(DIAGNOSTIC_TOOLS).toHaveLength(13);
    });

    it('all tools have names, descriptions, and input schemas', () => {
      for (const tool of DIAGNOSTIC_TOOLS) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.input_schema).toBeDefined();
        expect(tool.input_schema.type).toBe('object');
      }
    });

    it('has friendly labels for all tools', () => {
      for (const tool of DIAGNOSTIC_TOOLS) {
        expect(TOOL_CALL_LABELS[tool.name]).toBeDefined();
      }
    });
  });

  describe('Tool Execution', () => {
    it('get_agent_config returns friendly summary', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'a1',
        name: 'Support Bot',
        model: 'sonnet',
        tools: ['hubspot-read', 'hubspot-write'],
        memory_enabled: true,
        mentions_only: false,
        respond_to_all_messages: false,
        max_turns: 25,
        write_policy: 'confirm',
        system_prompt: 'You help customers.',
        status: 'active',
      });

      const result = await executeToolCall('get_agent_config', { agent_id: 'a1' }, 'W1');

      const parsed = JSON.parse(result.content);
      expect(parsed.name).toBe('Support Bot');
      expect(parsed.model).toBe('Sonnet');
      expect(parsed.tools).toContain('HubSpot');
      expect(parsed.memoryEnabled).toBe('Yes');
      expect(parsed.writePolicy).toBe('Asks user first');
      expect(result.is_error).toBeUndefined();
    });

    it('get_agent_config returns error for missing agent', async () => {
      mockGetAgent.mockResolvedValueOnce(null);

      const result = await executeToolCall('get_agent_config', { agent_id: 'missing' }, 'W1');

      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Agent not found.');
    });

    it('get_recent_runs returns formatted run summaries', async () => {
      mockGetRunsByAgent.mockResolvedValueOnce([
        {
          id: 'r1', status: 'completed', model: 'sonnet', duration_ms: 2500,
          estimated_cost_usd: 0.03, tool_calls_count: 2, input: 'Hello',
          output: 'Hi there!', created_at: '2026-03-29T10:00:00Z',
        },
        {
          id: 'r2', status: 'failed', model: 'opus', duration_ms: 15000,
          estimated_cost_usd: 0.15, tool_calls_count: 5, input: 'Search data',
          output: 'Error: connection refused', created_at: '2026-03-29T09:00:00Z',
        },
      ]);

      const result = await executeToolCall('get_recent_runs', { agent_id: 'a1' }, 'W1');

      const parsed = JSON.parse(result.content);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].status).toBe('Completed');
      expect(parsed[0].model).toBe('Sonnet');
      expect(parsed[0].duration).toBe('2.5s');
      expect(parsed[1].status).toBe('Failed');
      expect(parsed[1].model).toBe('Opus');
    });

    it('get_recent_runs filters by status', async () => {
      mockGetRunsByAgent.mockResolvedValueOnce([
        { id: 'r1', status: 'completed', model: 'sonnet', duration_ms: 1000, estimated_cost_usd: 0.01, tool_calls_count: 0, input: 'Hi', output: 'Hello', created_at: '2026-03-29T10:00:00Z' },
        { id: 'r2', status: 'failed', model: 'sonnet', duration_ms: 2000, estimated_cost_usd: 0.02, tool_calls_count: 1, input: 'Search', output: 'Error', created_at: '2026-03-29T09:00:00Z' },
      ]);

      const result = await executeToolCall('get_recent_runs', { agent_id: 'a1', status_filter: 'failed' }, 'W1');

      const parsed = JSON.parse(result.content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].status).toBe('Failed');
    });

    it('get_run_tool_calls returns friendly tool call summaries', async () => {
      mockGetRunToolCalls.mockResolvedValueOnce([
        { tool_name: 'hubspot-read', tool_input: { query: 'test' }, tool_output: '{"results": []}', error: null, sequence_number: 0 },
        { tool_name: 'hubspot-write', tool_input: { name: 'New Contact' }, tool_output: null, error: 'API rate limited', sequence_number: 1 },
      ]);

      const result = await executeToolCall('get_run_tool_calls', { run_id: 'r1' }, 'W1');

      const parsed = JSON.parse(result.content);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].tool).toBe('HubSpot');
      expect(parsed[0].error).toBeNull();
      expect(parsed[1].error).toBe('API rate limited');
    });

    it('get_agent_memories returns formatted memories', async () => {
      mockGetAgentMemories.mockResolvedValueOnce([
        { fact: 'Customer prefers email', category: 'preference', created_at: '2026-03-29T10:00:00Z' },
      ]);

      const result = await executeToolCall('get_agent_memories', { agent_id: 'a1' }, 'W1');

      const parsed = JSON.parse(result.content);
      expect(parsed[0].fact).toBe('Customer prefers email');
      expect(parsed[0].category).toBe('preference');
    });

    it('get_agent_triggers returns formatted triggers', async () => {
      mockGetAgentTriggers.mockResolvedValueOnce([
        { trigger_type: 'schedule', status: 'active', config_json: '{"cron":"0 9 * * *","timezone":"US/Pacific"}' },
        { trigger_type: 'linear', status: 'paused', config_json: '{}' },
      ]);

      const result = await executeToolCall('get_agent_triggers', { agent_id: 'a1' }, 'W1');

      const parsed = JSON.parse(result.content);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].type).toBe('Scheduled');
      expect(parsed[0].status).toBe('Active');
      expect(parsed[1].type).toBe('Linear');
      expect(parsed[1].status).toBe('Paused');
    });

    it('get_error_rates returns friendly error rates', async () => {
      mockGetAgentErrorRates.mockResolvedValueOnce([
        { agentId: 'a1', name: 'Support Bot', errorRate: 0.15, total: 20 },
        { agentId: 'a2', name: 'Data Agent', errorRate: 0, total: 50 },
      ]);

      const result = await executeToolCall('get_error_rates', {}, 'W1');

      const parsed = JSON.parse(result.content);
      expect(parsed[0].agent).toBe('Support Bot');
      expect(parsed[0].errorRate).toBe('15%');
      expect(parsed[1].errorRate).toBe('0%');
    });

    it('get_tool_analytics returns formatted analytics', async () => {
      mockGetToolAnalytics.mockResolvedValueOnce({
        totalRuns: 100,
        successRate: 0.95,
        avgDurationMs: 1200,
        lastUsed: '2026-03-29T10:00:00Z',
        lastError: null,
      });

      const result = await executeToolCall('get_tool_analytics', { tool_name: 'hubspot-read' }, 'W1');

      const parsed = JSON.parse(result.content);
      expect(parsed.tool).toBe('HubSpot');
      expect(parsed.successRate).toBe('95%');
      expect(parsed.avgDuration).toBe('1.2s');
      expect(parsed.lastError).toBe('None');
    });

    it('get_tool_code returns error for unknown tool', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);

      const result = await executeToolCall('get_tool_code', { tool_name: 'unknown-tool' }, 'W1');

      expect(result.is_error).toBe(true);
      expect(result.content).toContain('not found');
    });

    it('propose_agent_changes builds diff structure', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'a1',
        name: 'Support Bot',
        model: 'sonnet',
        tools: ['hubspot-read'],
        memory_enabled: false,
        system_prompt: 'Old prompt',
        respond_to_all_messages: false,
        mentions_only: false,
        max_turns: 25,
        write_policy: 'auto',
      });

      const result = await executeToolCall('propose_agent_changes', {
        agent_id: 'a1',
        changes: { model: 'opus', memoryEnabled: true },
      }, 'W1');

      const parsed = JSON.parse(result.content);
      expect(parsed.proposedChanges.model).toEqual({ from: 'sonnet', to: 'opus' });
      expect(parsed.proposedChanges.memoryEnabled).toEqual({ from: false, to: true });
    });

    it('propose_agent_changes returns no changes when identical', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'a1', name: 'Bot', model: 'sonnet', tools: [], memory_enabled: false,
        system_prompt: '', respond_to_all_messages: false, mentions_only: false,
        max_turns: 25, write_policy: 'auto',
      });

      const result = await executeToolCall('propose_agent_changes', {
        agent_id: 'a1',
        changes: { model: 'sonnet' },
      }, 'W1');

      const parsed = JSON.parse(result.content);
      expect(parsed.proposedChanges).toBeNull();
    });

    it('list_agents returns agent summaries', async () => {
      mockListAgents.mockResolvedValueOnce([
        { id: 'a1', name: 'Bot 1', status: 'active', model: 'sonnet', tools: ['hubspot-read'] },
        { id: 'a2', name: 'Bot 2', status: 'paused', model: 'opus', tools: [] },
      ]);

      const result = await executeToolCall('list_agents', {}, 'W1');

      const parsed = JSON.parse(result.content);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('Bot 1');
      expect(parsed[0].model).toBe('Sonnet');
      expect(parsed[1].model).toBe('Opus');
    });

    it('handles unknown tool name', async () => {
      const result = await executeToolCall('nonexistent_tool', {}, 'W1');
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Unknown tool');
    });
  });

  describe('System Prompt Builder', () => {
    it('builds prompt with workspace context', () => {
      const prompt = buildSystemPrompt({
        workspaceAgentCount: 3,
        workspaceAgentNames: ['Bot 1', 'Bot 2', 'Bot 3'],
        currentPage: 'dashboard',
      });

      expect(prompt).toContain('TinyHands assistant');
      expect(prompt).toContain('3 agents');
      expect(prompt).toContain('Bot 1, Bot 2, Bot 3');
      expect(prompt).toContain('dashboard page');
    });

    it('includes selected agent context', () => {
      const prompt = buildSystemPrompt({
        workspaceAgentCount: 1,
        workspaceAgentNames: ['Support Bot'],
        currentPage: 'agent',
        selectedAgent: {
          id: 'a1',
          name: 'Support Bot',
          model: 'sonnet',
          tools: ['hubspot-read', 'hubspot-write'],
          memoryEnabled: true,
          errorRate: 0.15,
          promptSummary: 'You help customers.',
        },
      });

      expect(prompt).toContain('Support Bot');
      expect(prompt).toContain('Sonnet');
      expect(prompt).toContain('HubSpot');
      expect(prompt).toContain('Enabled');
      expect(prompt).toContain('15%');
    });

    it('includes diagnostic methodology', () => {
      const prompt = buildSystemPrompt({
        workspaceAgentCount: 0,
        workspaceAgentNames: [],
        currentPage: 'general',
      });

      expect(prompt).toContain('Diagnostic methodology');
      expect(prompt).toContain('Common failure patterns');
      expect(prompt).toContain('Tool connection expired');
    });

    it('never includes technical jargon instructions', () => {
      const prompt = buildSystemPrompt({
        workspaceAgentCount: 0,
        workspaceAgentNames: [],
        currentPage: 'general',
      });

      expect(prompt).toContain('NEVER show raw IDs');
      expect(prompt).toContain('NEVER use technical jargon');
    });
  });

  describe('buildAgentContext', () => {
    it('builds context from agent record', () => {
      const ctx = buildAgentContext({
        id: 'a1', name: 'Bot', model: 'opus', tools: ['linear-read'],
        memory_enabled: true, system_prompt: 'A'.repeat(500),
      } as any, 0.1);

      expect(ctx.name).toBe('Bot');
      expect(ctx.model).toBe('opus');
      expect(ctx.memoryEnabled).toBe(true);
      expect(ctx.errorRate).toBe(0.1);
      expect(ctx.promptSummary.length).toBeLessThanOrEqual(303); // 300 + '...'
    });
  });
});
