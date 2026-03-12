import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock Slack Bolt ──
vi.mock('@slack/bolt', () => ({
  App: vi.fn(),
}));

// ── Mock uuid ──
const mockUuidV4 = vi.fn(() => 'mock-uuid-1234');
vi.mock('uuid', () => ({
  v4: (...args: any[]) => mockUuidV4(...args),
}));

// ── Mock all module dependencies ──

const mockGetAgentByChannel = vi.fn();
const mockGetAgentsByChannel = vi.fn();
vi.mock('../../src/modules/agents', () => ({
  getAgentByChannel: (...args: any[]) => mockGetAgentByChannel(...args),
  getAgentsByChannel: (...args: any[]) => mockGetAgentsByChannel(...args),
}));

const mockEnqueueRun = vi.fn();
vi.mock('../../src/queue', () => ({
  enqueueRun: (...args: any[]) => mockEnqueueRun(...args),
}));

const mockHandleWizardMessage = vi.fn();
const mockIsInWizard = vi.fn();
const mockHandleConversationReply = vi.fn();
vi.mock('../../src/slack/commands', () => ({
  handleWizardMessage: (...args: any[]) => mockHandleWizardMessage(...args),
  isInWizard: (...args: any[]) => mockIsInWizard(...args),
  handleConversationReply: (...args: any[]) => mockHandleConversationReply(...args),
}));

const mockPostMessage = vi.fn();
const mockPostBlocks = vi.fn();
const mockPublishHomeTab = vi.fn();
const mockUpdateMessage = vi.fn();
const mockGetSlackApp = vi.fn();
const mockGetThreadHistory = vi.fn();
vi.mock('../../src/slack/index', () => ({
  postMessage: (...args: any[]) => mockPostMessage(...args),
  postBlocks: (...args: any[]) => mockPostBlocks(...args),
  publishHomeTab: (...args: any[]) => mockPublishHomeTab(...args),
  updateMessage: (...args: any[]) => mockUpdateMessage(...args),
  getSlackApp: () => mockGetSlackApp(),
  getThreadHistory: (...args: any[]) => mockGetThreadHistory(...args),
}));

const mockDetectCritique = vi.fn();
const mockGeneratePromptDiff = vi.fn().mockResolvedValue({ original: 'old', proposed: 'new' });
const mockApplyPromptDiff = vi.fn();
const mockFormatDiffForSlack = vi.fn().mockReturnValue('diff text');
vi.mock('../../src/modules/self-improvement', () => ({
  detectCritique: (...args: any[]) => mockDetectCritique(...args),
  generatePromptDiff: (...args: any[]) => mockGeneratePromptDiff(...args),
  applyPromptDiff: (...args: any[]) => mockApplyPromptDiff(...args),
  formatDiffForSlack: (...args: any[]) => mockFormatDiffForSlack(...args),
}));

const mockParseModelOverride = vi.fn();
const mockStripModelOverride = vi.fn();
vi.mock('../../src/modules/model-selection', () => ({
  parseModelOverride: (...args: any[]) => mockParseModelOverride(...args),
  stripModelOverride: (...args: any[]) => mockStripModelOverride(...args),
}));

const mockCheckMessageRelevance = vi.fn();
vi.mock('../../src/modules/agents/goal-analyzer', () => ({
  checkMessageRelevance: (...args: any[]) => mockCheckMessageRelevance(...args),
}));

const mockFindSlackChannelTriggers = vi.fn();
const mockFireTrigger = vi.fn();
vi.mock('../../src/modules/triggers', () => ({
  findSlackChannelTriggers: (...args: any[]) => mockFindSlackChannelTriggers(...args),
  fireTrigger: (...args: any[]) => mockFireTrigger(...args),
  createTrigger: (...args: any[]) => mockCreateTrigger(...args),
}));

const mockBuildDashboardBlocks = vi.fn();
vi.mock('../../src/modules/dashboard', () => ({
  buildDashboardBlocks: (...args: any[]) => mockBuildDashboardBlocks(...args),
}));

const mockInitSuperadmin = vi.fn();
const mockAddSuperadmin = vi.fn();
const mockAddAgentAdmin = vi.fn();
vi.mock('../../src/modules/access-control', () => ({
  initSuperadmin: (...args: any[]) => mockInitSuperadmin(...args),
  addSuperadmin: (...args: any[]) => mockAddSuperadmin(...args),
  addAgentAdmin: (...args: any[]) => mockAddAgentAdmin(...args),
}));

// ── Mock dynamic imports for handleAgentChannelCommand ──
const mockConnectSource = vi.fn();
const mockDetectSourceType = vi.fn();
vi.mock('../../src/modules/sources', () => ({
  connectSource: (...args: any[]) => mockConnectSource(...args),
  detectSourceType: (...args: any[]) => mockDetectSourceType(...args),
}));

const mockCloneRepo = vi.fn();
const mockParseGitHubUri = vi.fn();
vi.mock('../../src/modules/sources/github', () => ({
  cloneRepo: (...args: any[]) => mockCloneRepo(...args),
  parseGitHubUri: (...args: any[]) => mockParseGitHubUri(...args),
}));

const mockParseDriveUri = vi.fn();
vi.mock('../../src/modules/sources/google-drive', () => ({
  parseDriveUri: (...args: any[]) => mockParseDriveUri(...args),
}));

const mockCreateTrigger = vi.fn();

const mockAttachSkillToAgent = vi.fn();
vi.mock('../../src/modules/skills', () => ({
  attachSkillToAgent: (...args: any[]) => mockAttachSkillToAgent(...args),
}));

const mockForgetMemory = vi.fn();
vi.mock('../../src/modules/sources/memory', () => ({
  forgetMemory: (...args: any[]) => mockForgetMemory(...args),
}));

const mockApproveCustomTool = vi.fn();
const mockGetAgentToolSummary = vi.fn();
vi.mock('../../src/modules/tools', () => ({
  approveCustomTool: (...args: any[]) => mockApproveCustomTool(...args),
  getAgentToolSummary: (...args: any[]) => mockGetAgentToolSummary(...args),
}));

const mockGetAuthoredSkills = vi.fn().mockResolvedValue([]);
const mockGetMcpConfigs = vi.fn().mockResolvedValue([]);
const mockGetCodeArtifacts = vi.fn().mockResolvedValue([]);
const mockGetAllToolAnalytics = vi.fn().mockResolvedValue([]);
const mockGetToolVersions = vi.fn().mockResolvedValue([]);
const mockDiscoverTools = vi.fn().mockResolvedValue([]);
const mockShareToolWithAgent = vi.fn();
const mockRollbackTool = vi.fn();
vi.mock('../../src/modules/self-authoring', () => ({
  getAuthoredSkills: (...args: any[]) => mockGetAuthoredSkills(...args),
  getMcpConfigs: (...args: any[]) => mockGetMcpConfigs(...args),
  getCodeArtifacts: (...args: any[]) => mockGetCodeArtifacts(...args),
  getAllToolAnalytics: (...args: any[]) => mockGetAllToolAnalytics(...args),
  getToolVersions: (...args: any[]) => mockGetToolVersions(...args),
  discoverTools: (...args: any[]) => mockDiscoverTools(...args),
  shareToolWithAgent: (...args: any[]) => mockShareToolWithAgent(...args),
  rollbackTool: (...args: any[]) => mockRollbackTool(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerEvents } from '../../src/slack/events';

// ── Helpers ──

function createMockApp() {
  const handlers: Record<string, Function[]> = {};
  return {
    event: vi.fn((eventName: string, handler: Function) => {
      if (!handlers[eventName]) handlers[eventName] = [];
      handlers[eventName].push(handler);
    }),
    _handlers: handlers,
    _trigger: async (eventName: string, payload: any) => {
      const fns = handlers[eventName] || [];
      for (const fn of fns) {
        await fn(payload);
      }
    },
    _triggerNth: async (eventName: string, payload: any, n: number) => {
      const fns = handlers[eventName] || [];
      if (fns[n]) await fns[n](payload);
    },
  };
}

function makeMessageEvent(overrides: Record<string, any> = {}) {
  return {
    channel: 'C_AGENT',
    user: 'U_USER',
    text: 'hello agent',
    ts: '1700000000.000100',
    ...overrides,
  };
}

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-1',
    name: 'test-agent',
    channel_id: 'C_AGENT',
    channel_ids: ['C_AGENT'],
    system_prompt: 'You are a test agent',
    tools: ['Read'],
    avatar_emoji: ':robot_face:',
    status: 'active',
    model: 'sonnet',
    memory_enabled: false,
    respond_to_all_messages: false,
    relevance_keywords: [],
    ...overrides,
  };
}

describe('Slack Events -- registerEvents', () => {
  let mockApp: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockApp = createMockApp();

    // Default: bot identity lookup succeeds
    mockGetSlackApp.mockReturnValue({
      client: {
        auth: {
          test: vi.fn().mockResolvedValue({ user_id: 'U_BOT', bot_id: 'B_BOT' }),
        },
      },
    });

    // Defaults
    mockIsInWizard.mockReturnValue(false);
    mockHandleConversationReply.mockResolvedValue(false);
    mockGetAgentsByChannel.mockResolvedValue([]);
    mockGetAgentByChannel.mockResolvedValue(null);
    mockFindSlackChannelTriggers.mockResolvedValue([]);
    mockParseModelOverride.mockReturnValue(null);
    mockStripModelOverride.mockImplementation((t: string) => t);
    mockCheckMessageRelevance.mockResolvedValue(true);
    mockDetectCritique.mockReturnValue(false);
    mockPostBlocks.mockResolvedValue('status-ts-123');
    mockEnqueueRun.mockResolvedValue(undefined);
    mockGetThreadHistory.mockResolvedValue(null);
    mockPostMessage.mockResolvedValue(undefined);
    mockGeneratePromptDiff.mockResolvedValue({ original: 'old', proposed: 'new' });
    mockFormatDiffForSlack.mockReturnValue('diff text');

    // uuid default
    mockUuidV4.mockReturnValue('mock-uuid-1234');

    // handleAgentChannelCommand defaults
    mockGetAuthoredSkills.mockResolvedValue([]);
    mockGetMcpConfigs.mockResolvedValue([]);
    mockGetCodeArtifacts.mockResolvedValue([]);
    mockGetAllToolAnalytics.mockResolvedValue([]);
    mockGetToolVersions.mockResolvedValue([]);
    mockDiscoverTools.mockResolvedValue([]);
  });

  // ── Registration ──

  describe('registration', () => {
    it('should register message, file_shared, DM message, and app_home_opened events', () => {
      registerEvents(mockApp as any);

      const messageCalls = mockApp.event.mock.calls.filter(
        (c: any[]) => c[0] === 'message'
      );
      expect(messageCalls.length).toBe(2);
      expect(mockApp.event).toHaveBeenCalledWith('file_shared', expect.any(Function));
      expect(mockApp.event).toHaveBeenCalledWith('app_home_opened', expect.any(Function));
    });
  });

  // ── Message Event: Subtype Filtering ──

  describe('message event -- subtype filtering', () => {
    it('should skip message_changed subtypes', async () => {
      registerEvents(mockApp as any);
      const event = makeMessageEvent({ subtype: 'message_changed' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetAgentsByChannel).not.toHaveBeenCalled();
    });

    it('should skip message_deleted subtypes', async () => {
      registerEvents(mockApp as any);
      const event = makeMessageEvent({ subtype: 'message_deleted' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetAgentsByChannel).not.toHaveBeenCalled();
    });

    it('should skip channel_join subtypes', async () => {
      registerEvents(mockApp as any);
      const event = makeMessageEvent({ subtype: 'channel_join' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetAgentsByChannel).not.toHaveBeenCalled();
    });

    it('should skip channel_leave subtypes', async () => {
      registerEvents(mockApp as any);
      const event = makeMessageEvent({ subtype: 'channel_leave' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetAgentsByChannel).not.toHaveBeenCalled();
    });

    it('should allow bot_message subtype', async () => {
      registerEvents(mockApp as any);
      const event = makeMessageEvent({ subtype: 'bot_message', bot_id: 'B_OTHER' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetAgentsByChannel).toHaveBeenCalled();
    });

    it('should allow messages with no subtype', async () => {
      registerEvents(mockApp as any);
      const event = makeMessageEvent();
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetAgentsByChannel).toHaveBeenCalled();
    });
  });

  // ── Own Bot Message Filtering ──

  describe('message event -- own bot filtering', () => {
    it('should skip messages from own bot_id', async () => {
      registerEvents(mockApp as any);
      const event = makeMessageEvent({ bot_id: 'B_BOT', user: 'U_OTHER' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetAgentsByChannel).not.toHaveBeenCalled();
    });

    it('should skip messages from own bot user_id', async () => {
      registerEvents(mockApp as any);
      const event = makeMessageEvent({ bot_id: 'B_SOMETHING', user: 'U_BOT' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetAgentsByChannel).not.toHaveBeenCalled();
    });

    it('should allow messages from other bots', async () => {
      registerEvents(mockApp as any);
      const event = makeMessageEvent({ bot_id: 'B_OTHER', user: 'U_OTHER', subtype: 'bot_message' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetAgentsByChannel).toHaveBeenCalled();
    });

    it('should handle auth.test failure gracefully (retry next message)', async () => {
      mockGetSlackApp.mockReturnValue({
        client: {
          auth: {
            test: vi.fn().mockRejectedValue(new Error('auth failed')),
          },
        },
      });

      registerEvents(mockApp as any);
      const event = makeMessageEvent();
      // Should not throw
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetAgentsByChannel).toHaveBeenCalled();
    });

    it('should use bot_id from message when user field is missing', async () => {
      registerEvents(mockApp as any);
      const event = makeMessageEvent({ user: undefined, bot_id: 'B_EXTERNAL', subtype: 'bot_message' });
      await mockApp._trigger('message', { event, client: {} });

      // bot_id is B_EXTERNAL, not our bot, so should proceed
      expect(mockGetAgentsByChannel).toHaveBeenCalled();
    });
  });

  // ── Wizard Handling ──

  describe('message event -- wizard handling', () => {
    it('should route to wizard when user is in wizard', async () => {
      mockIsInWizard.mockReturnValue(true);
      mockHandleWizardMessage.mockResolvedValue('Wizard response');

      registerEvents(mockApp as any);
      const event = makeMessageEvent();
      await mockApp._trigger('message', { event, client: {} });

      expect(mockHandleWizardMessage).toHaveBeenCalledWith('U_USER', 'C_AGENT', 'hello agent');
      expect(mockPostMessage).toHaveBeenCalledWith('C_AGENT', 'Wizard response', event.ts);
      expect(mockGetAgentsByChannel).not.toHaveBeenCalled();
    });

    it('should not post message when wizard returns null', async () => {
      mockIsInWizard.mockReturnValue(true);
      mockHandleWizardMessage.mockResolvedValue(null);

      registerEvents(mockApp as any);
      await mockApp._trigger('message', { event: makeMessageEvent(), client: {} });

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should use thread_ts for wizard reply when message is in a thread', async () => {
      mockIsInWizard.mockReturnValue(true);
      mockHandleWizardMessage.mockResolvedValue('Wizard thread response');

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ thread_ts: '1700000000.000001' });
      await mockApp._trigger('message', { event, client: {} });

      // threadTs = msg.thread_ts || msg.ts, so should use thread_ts
      expect(mockPostMessage).toHaveBeenCalledWith('C_AGENT', 'Wizard thread response', '1700000000.000001');
    });
  });

  // ── Thread Reply -- Conversation Flow ──

  describe('message event -- thread reply conversation flow', () => {
    it('should handle conversation reply and stop processing', async () => {
      mockHandleConversationReply.mockResolvedValue(true);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ thread_ts: '1700000000.000001' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockHandleConversationReply).toHaveBeenCalledWith(
        'U_USER', 'C_AGENT', '1700000000.000001', 'hello agent'
      );
      expect(mockGetAgentsByChannel).not.toHaveBeenCalled();
    });

    it('should continue to agent check when conversation reply returns false', async () => {
      mockHandleConversationReply.mockResolvedValue(false);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ thread_ts: '1700000000.000001' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetAgentsByChannel).toHaveBeenCalled();
    });

    it('should post error message and return when handleConversationReply throws', async () => {
      mockHandleConversationReply.mockRejectedValue(new Error('db error'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ thread_ts: '1700000000.000001' });
      await mockApp._trigger('message', { event, client: {} });

      // Should NOT continue to agent check — instead post error and return
      expect(mockGetAgentsByChannel).not.toHaveBeenCalled();
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Something went wrong'),
        '1700000000.000001',
      );
    });

    it('should not call handleConversationReply for non-thread messages', async () => {
      registerEvents(mockApp as any);
      const event = makeMessageEvent(); // no thread_ts
      await mockApp._trigger('message', { event, client: {} });

      expect(mockHandleConversationReply).not.toHaveBeenCalled();
    });
  });

  // ── Agent Channel Routing ──

  describe('message event -- agent channel routing', () => {
    it('should enqueue a job when message is in an agent channel and relevant', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCheckMessageRelevance.mockResolvedValue(true);

      registerEvents(mockApp as any);
      const event = makeMessageEvent();
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          channelId: 'C_AGENT',
          input: 'hello agent',
          userId: 'U_USER',
          traceId: 'mock-uuid-1234',
        }),
        'high'
      );
    });

    it('should skip agent when message is not relevant', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCheckMessageRelevance.mockResolvedValue(false);

      registerEvents(mockApp as any);
      const event = makeMessageEvent();
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should pass relevance_keywords, system_prompt, respond_to_all to checkMessageRelevance', async () => {
      const agent = makeAgent({
        relevance_keywords: ['deploy', 'release'],
        system_prompt: 'You deploy things',
        respond_to_all_messages: false,
      });
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCheckMessageRelevance.mockResolvedValue(true);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'deploy to production' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockCheckMessageRelevance).toHaveBeenCalledWith(
        'deploy to production',
        ['deploy', 'release'],
        'You deploy things',
        false
      );
    });

    it('should skip relevance check for thread replies', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ thread_ts: '1700000000.000001' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockCheckMessageRelevance).not.toHaveBeenCalled();
      expect(mockEnqueueRun).toHaveBeenCalled();
    });

    it('should include thread history context for thread replies', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetThreadHistory.mockResolvedValue('User: previous message\nBot: previous reply');

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ thread_ts: '1700000000.000001' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.stringContaining('<conversation_history>'),
        }),
        'high'
      );
      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.stringContaining('<current_message>'),
        }),
        'high'
      );
    });

    it('should not wrap with context tags when thread history is null', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetThreadHistory.mockResolvedValue(null);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ thread_ts: '1700000000.000001', text: 'follow up' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({
          input: 'follow up',
        }),
        'high'
      );
    });

    it('should post a status message with agent identity before enqueue', async () => {
      const agent = makeAgent({ name: 'deploy-bot', avatar_emoji: ':rocket:' });
      mockGetAgentsByChannel.mockResolvedValue([agent]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent();
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostBlocks).toHaveBeenCalledWith(
        'C_AGENT',
        expect.arrayContaining([
          expect.objectContaining({ type: 'context' }),
        ]),
        'deploy-bot is adjusting its grip...',
        event.ts,
        'deploy-bot',
        ':rocket:',
      );
    });

    it('should pass statusMessageTs through job data', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockPostBlocks.mockResolvedValue('status-msg-ts');

      registerEvents(mockApp as any);
      await mockApp._trigger('message', { event: makeMessageEvent(), client: {} });

      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({ statusMessageTs: 'status-msg-ts' }),
        'high'
      );
    });

    it('should not include statusMessageTs when postBlocks returns null', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockPostBlocks.mockResolvedValue(null);

      registerEvents(mockApp as any);
      await mockApp._trigger('message', { event: makeMessageEvent(), client: {} });

      const jobData = mockEnqueueRun.mock.calls[0][0];
      expect(jobData.statusMessageTs).toBeUndefined();
    });

    it('should handle empty text messages', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCheckMessageRelevance.mockResolvedValue(true);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: undefined });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({ input: '' }),
        'high'
      );
    });

    it('should use msg.ts when no thread_ts is present for threadTs', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCheckMessageRelevance.mockResolvedValue(true);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ ts: '1700000000.999', thread_ts: undefined });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({
          threadTs: '1700000000.999',
        }),
        'high'
      );
    });
  });

  // ── Multiple Agents Per Channel ──

  describe('message event -- multiple agents per channel', () => {
    it('should process multiple agents in the same channel', async () => {
      const agent1 = makeAgent({ id: 'a1', name: 'agent-1' });
      const agent2 = makeAgent({ id: 'a2', name: 'agent-2' });
      mockGetAgentsByChannel.mockResolvedValue([agent1, agent2]);
      mockCheckMessageRelevance.mockResolvedValue(true);

      registerEvents(mockApp as any);
      await mockApp._trigger('message', { event: makeMessageEvent(), client: {} });

      expect(mockEnqueueRun).toHaveBeenCalledTimes(2);
      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1' }),
        'high'
      );
      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a2' }),
        'high'
      );
    });

    it('should skip individual agents that are not relevant while keeping relevant ones', async () => {
      const agent1 = makeAgent({ id: 'a1', name: 'relevant-agent', relevance_keywords: ['deploy'] });
      const agent2 = makeAgent({ id: 'a2', name: 'irrelevant-agent', relevance_keywords: ['billing'] });
      mockGetAgentsByChannel.mockResolvedValue([agent1, agent2]);
      mockCheckMessageRelevance
        .mockResolvedValueOnce(true)  // first agent relevant
        .mockResolvedValueOnce(false); // second agent not relevant

      registerEvents(mockApp as any);
      await mockApp._trigger('message', { event: makeMessageEvent(), client: {} });

      expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1' }),
        'high'
      );
    });

    it('should post status messages with correct agent identity for each agent', async () => {
      const agent1 = makeAgent({ id: 'a1', name: 'bot-alpha', avatar_emoji: ':a:' });
      const agent2 = makeAgent({ id: 'a2', name: 'bot-beta', avatar_emoji: ':b:' });
      mockGetAgentsByChannel.mockResolvedValue([agent1, agent2]);
      mockCheckMessageRelevance.mockResolvedValue(true);

      registerEvents(mockApp as any);
      await mockApp._trigger('message', { event: makeMessageEvent(), client: {} });

      expect(mockPostBlocks).toHaveBeenCalledTimes(2);
      expect(mockPostBlocks).toHaveBeenCalledWith(
        'C_AGENT', expect.any(Array), 'bot-alpha is adjusting its grip...', expect.any(String), 'bot-alpha', ':a:'
      );
      expect(mockPostBlocks).toHaveBeenCalledWith(
        'C_AGENT', expect.any(Array), 'bot-beta is adjusting its grip...', expect.any(String), 'bot-beta', ':b:'
      );
    });
  });

  // ── Model Override Detection ──

  describe('message event -- model override', () => {
    it('should detect and pass model override to job data', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockParseModelOverride.mockReturnValue('opus');
      mockStripModelOverride.mockReturnValue('do the thing');

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'do the thing [use opus]' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockParseModelOverride).toHaveBeenCalledWith('do the thing [use opus]');
      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({
          modelOverride: 'opus',
          input: 'do the thing',
        }),
        'high'
      );
    });

    it('should not set modelOverride when no override detected', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockParseModelOverride.mockReturnValue(null);

      registerEvents(mockApp as any);
      await mockApp._trigger('message', { event: makeMessageEvent(), client: {} });

      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({ modelOverride: undefined }),
        'high'
      );
    });

    it('should use cleaned input for relevance check when model override exists', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockParseModelOverride.mockReturnValue('opus');
      mockStripModelOverride.mockReturnValue('help me with billing');
      mockCheckMessageRelevance.mockResolvedValue(true);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'help me with billing [use opus]' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockCheckMessageRelevance).toHaveBeenCalledWith(
        'help me with billing',
        expect.any(Array),
        expect.any(String),
        expect.any(Boolean),
      );
    });
  });

  // ── Critique Detection (Self-Improvement) ──

  describe('message event -- critique detection', () => {
    it('should detect critique in thread replies and respond with diff', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockDetectCritique.mockReturnValue(true);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({
        thread_ts: '1700000000.000001',
        text: 'You should be more concise',
      });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Analyzing critique'),
        '1700000000.000001',
        agent.name,
        agent.avatar_emoji,
      );
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should call generatePromptDiff with agent system_prompt and critique text', async () => {
      const agent = makeAgent({ system_prompt: 'Be a good helper' });
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockDetectCritique.mockReturnValue(true);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({
        thread_ts: '1700000000.000001',
        text: 'Be more concise',
      });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGeneratePromptDiff).toHaveBeenCalledWith('Be a good helper', 'Be more concise', '');
      expect(mockFormatDiffForSlack).toHaveBeenCalled();
    });

    it('should not treat critique in non-thread messages', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockDetectCritique.mockReturnValue(true);
      mockCheckMessageRelevance.mockResolvedValue(true);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'You should be more concise' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).toHaveBeenCalled();
    });

    it('should not enqueue when critique is detected (continue to next agent instead)', async () => {
      const agent1 = makeAgent({ id: 'a1' });
      const agent2 = makeAgent({ id: 'a2' });
      mockGetAgentsByChannel.mockResolvedValue([agent1, agent2]);
      mockDetectCritique.mockReturnValue(true);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ thread_ts: '1700000000.000001', text: 'bad response' });
      await mockApp._trigger('message', { event, client: {} });

      // Both agents should get critique handling, none should get enqueued
      expect(mockEnqueueRun).not.toHaveBeenCalled();
      expect(mockPostMessage).toHaveBeenCalledTimes(2);
    });
  });

  // ── @mention Skips Relevance Check ──

  describe('message event -- @mention bypass relevance', () => {
    it('should skip relevance check when bot is @mentioned', async () => {
      const agent = makeAgent({ respond_to_all_messages: false });
      mockGetAgentsByChannel.mockResolvedValue([agent]);

      registerEvents(mockApp as any);

      const mentionEvent = makeMessageEvent({ text: 'hey <@U_BOT> help me' });
      await mockApp._trigger('message', { event: mentionEvent, client: {} });

      expect(mockCheckMessageRelevance).not.toHaveBeenCalled();
      expect(mockEnqueueRun).toHaveBeenCalled();
    });

    it('should still check relevance when a different user is @mentioned', async () => {
      const agent = makeAgent({ respond_to_all_messages: false });
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCheckMessageRelevance.mockResolvedValue(true);

      registerEvents(mockApp as any);

      const mentionEvent = makeMessageEvent({ text: 'hey <@U_OTHER_USER> check this' });
      await mockApp._trigger('message', { event: mentionEvent, client: {} });

      expect(mockCheckMessageRelevance).toHaveBeenCalled();
    });
  });

  // ── Slack Channel Triggers ──

  describe('message event -- slack channel triggers', () => {
    it('should fire triggers when no agent is assigned to the channel', async () => {
      mockGetAgentsByChannel.mockResolvedValue([]);
      mockFindSlackChannelTriggers.mockResolvedValue([
        { id: 'trig-1' },
        { id: 'trig-2' },
      ]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ channel: 'C_NO_AGENT' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockFireTrigger).toHaveBeenCalledTimes(2);
      expect(mockFireTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerId: 'trig-1',
          idempotencyKey: expect.stringContaining('slack:C_NO_AGENT:'),
          payload: expect.objectContaining({ text: 'hello agent', user: 'U_USER', channel: 'C_NO_AGENT' }),
        })
      );
    });

    it('should pass sourceChannel and sourceThreadTs to fireTrigger', async () => {
      mockGetAgentsByChannel.mockResolvedValue([]);
      mockFindSlackChannelTriggers.mockResolvedValue([{ id: 'trig-1' }]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ channel: 'C_TRIG', ts: '1700000000.500' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockFireTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceChannel: 'C_TRIG',
          sourceThreadTs: '1700000000.500',
        })
      );
    });

    it('should not check triggers when agents are present in channel', async () => {
      mockGetAgentsByChannel.mockResolvedValue([makeAgent()]);

      registerEvents(mockApp as any);
      await mockApp._trigger('message', { event: makeMessageEvent(), client: {} });

      expect(mockFindSlackChannelTriggers).not.toHaveBeenCalled();
    });

    it('should fire no triggers when no triggers are configured', async () => {
      mockGetAgentsByChannel.mockResolvedValue([]);
      mockFindSlackChannelTriggers.mockResolvedValue([]);

      registerEvents(mockApp as any);
      await mockApp._trigger('message', { event: makeMessageEvent(), client: {} });

      expect(mockFireTrigger).not.toHaveBeenCalled();
    });
  });

  // ── File Shared Event ──

  describe('file_shared event', () => {
    it('should post KB processing message when agent exists for channel', async () => {
      mockGetAgentByChannel.mockResolvedValue(makeAgent());

      registerEvents(mockApp as any);
      await mockApp._trigger('file_shared', { event: { channel_id: 'C_AGENT' } });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('File received'),
      );
    });

    it('should do nothing when no agent exists for channel', async () => {
      mockGetAgentByChannel.mockResolvedValue(null);

      registerEvents(mockApp as any);
      await mockApp._trigger('file_shared', { event: { channel_id: 'C_NONE' } });

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should handle file processing errors gracefully', async () => {
      mockGetAgentByChannel.mockResolvedValue(makeAgent());
      mockPostMessage.mockRejectedValueOnce(new Error('Slack API error'));

      registerEvents(mockApp as any);
      // Should not throw
      await expect(
        mockApp._trigger('file_shared', { event: { channel_id: 'C_AGENT' } })
      ).resolves.not.toThrow();
    });
  });

  // ── DM Events (Superadmin) ──

  describe('DM message event (second message handler)', () => {
    it('should initialize superadmin on DM', async () => {
      registerEvents(mockApp as any);

      // The second 'message' handler is the DM handler
      await mockApp._triggerNth('message', {
        event: {
          channel: 'D_DM_CHAN',
          channel_type: 'im',
          user: 'U_DM_USER',
          text: 'hello',
          ts: '1700000000.100',
        },
      }, 1);

      expect(mockInitSuperadmin).toHaveBeenCalledWith('U_DM_USER');
    });

    it('should skip DM handler for non-im channel types', async () => {
      registerEvents(mockApp as any);

      await mockApp._triggerNth('message', {
        event: {
          channel: 'C_PUBLIC',
          channel_type: 'channel',
          user: 'U_USER',
          text: 'hello',
        },
      }, 1);

      expect(mockInitSuperadmin).not.toHaveBeenCalled();
    });

    it('should skip DM handler for bot messages', async () => {
      registerEvents(mockApp as any);

      await mockApp._triggerNth('message', {
        event: {
          channel: 'D_DM',
          channel_type: 'im',
          user: 'U_USER',
          bot_id: 'B_BOT',
          text: 'hello',
        },
      }, 1);

      expect(mockInitSuperadmin).not.toHaveBeenCalled();
    });

    it('should handle "add @user as superadmin" command in DMs', async () => {
      registerEvents(mockApp as any);

      await mockApp._triggerNth('message', {
        event: {
          channel: 'D_DM_CHAN',
          channel_type: 'im',
          user: 'U_ADMIN',
          text: 'add <@U_NEW_ADMIN> as superadmin',
        },
      }, 1);

      expect(mockInitSuperadmin).toHaveBeenCalledWith('U_ADMIN');
      // text is lowercased before regex match, so the extracted user ID is lowercase
      expect(mockAddSuperadmin).toHaveBeenCalledWith('u_new_admin', 'U_ADMIN');
    });

    it('should handle superadmin add errors gracefully', async () => {
      mockAddSuperadmin.mockRejectedValue(new Error('Not authorized'));

      registerEvents(mockApp as any);

      await mockApp._triggerNth('message', {
        event: {
          channel: 'D_DM_CHAN',
          channel_type: 'im',
          user: 'U_USER',
          text: 'add <@U_SOMEONE> as superadmin',
        },
      }, 1);

      expect(mockPostMessage).toHaveBeenCalledWith('D_DM_CHAN', expect.stringContaining('Not authorized'));
    });

    it('should ignore DM text that does not match superadmin pattern', async () => {
      registerEvents(mockApp as any);

      await mockApp._triggerNth('message', {
        event: {
          channel: 'D_DM_CHAN',
          channel_type: 'im',
          user: 'U_USER',
          text: 'just a normal DM',
        },
      }, 1);

      expect(mockInitSuperadmin).toHaveBeenCalled();
      expect(mockAddSuperadmin).not.toHaveBeenCalled();
    });
  });

  // ── App Home Opened ──

  describe('app_home_opened event', () => {
    it('should build and publish dashboard blocks', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Dashboard' } }];
      mockBuildDashboardBlocks.mockResolvedValue(blocks);

      registerEvents(mockApp as any);
      await mockApp._trigger('app_home_opened', { event: { user: 'U_HOME' } });

      expect(mockBuildDashboardBlocks).toHaveBeenCalled();
      expect(mockPublishHomeTab).toHaveBeenCalledWith('U_HOME', blocks);
    });

    it('should handle dashboard build errors', async () => {
      mockBuildDashboardBlocks.mockRejectedValue(new Error('DB down'));

      registerEvents(mockApp as any);
      // Should not crash
      await expect(
        mockApp._trigger('app_home_opened', { event: { user: 'U_HOME' } })
      ).rejects.toThrow('DB down');
    });
  });

  // ── Error Handling ──

  describe('message event -- error handling', () => {
    it('should catch and log errors without crashing', async () => {
      mockGetAgentsByChannel.mockRejectedValue(new Error('DB connection lost'));

      registerEvents(mockApp as any);
      await expect(
        mockApp._trigger('message', { event: makeMessageEvent(), client: {} })
      ).resolves.not.toThrow();
    });

    it('should handle errors during enqueueRun gracefully', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCheckMessageRelevance.mockResolvedValue(true);
      mockEnqueueRun.mockRejectedValue(new Error('Queue full'));

      registerEvents(mockApp as any);
      // The error is inside the try-catch in the handler, so it should not propagate
      await expect(
        mockApp._trigger('message', { event: makeMessageEvent(), client: {} })
      ).resolves.not.toThrow();
    });
  });

  // ── Interactive Agent Channel Commands ──

  describe('message event -- interactive agent channel commands', () => {
    it('should handle "add to kb" command', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'add to kb' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('knowledge base'),
        expect.any(String),
      );
      // Should return early, not enqueue
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "add to knowledge base" command', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'add to knowledge base' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('knowledge base'),
        expect.any(String),
      );
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "create a tool that..." redirect message', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'create a tool that sends emails' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('admin-only'),
        expect.any(String),
        agent.name,
        agent.avatar_emoji,
      );
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "show tools" / "list tools" / "my tools" command', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetAgentToolSummary.mockResolvedValue({ builtin: ['Read'], custom: [], mcp: [] });

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'show tools' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).not.toHaveBeenCalled();
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Capabilities'),
        expect.any(String),
      );
    });

    it('should handle "tool stats" command with analytics', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetAllToolAnalytics.mockResolvedValue([
        { toolName: 'web-search', totalRuns: 42, successRate: 0.95, avgDurationMs: 120, lastError: null },
      ]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'tool stats' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).not.toHaveBeenCalled();
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Tool Analytics'),
        expect.any(String),
      );
    });

    it('should handle "tool stats" with empty analytics', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetAllToolAnalytics.mockResolvedValue([]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'tool stats' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('No tool usage data'),
        expect.any(String),
      );
    });

    it('should handle "connect to owner/repo" for GitHub', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockParseGitHubUri.mockReturnValue({ owner: 'acme', repo: 'api', branch: 'main' });
      mockConnectSource.mockResolvedValue({ id: 'source-id-12345678' });

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'connect to acme/api' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).not.toHaveBeenCalled();
      expect(mockConnectSource).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'agent-1',
        sourceType: 'github',
      }));
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Connected to GitHub'),
        expect.any(String),
      );
    });

    it('should handle invalid GitHub URI', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockParseGitHubUri.mockReturnValue(null);

      registerEvents(mockApp as any);
      // Text must match the GitHub regex (owner/repo format) for the handler to fire
      const event = makeMessageEvent({ text: 'connect to some/invalid-repo' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Invalid GitHub URL'),
        expect.any(String),
      );
    });

    it('should handle GitHub connect failure', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockParseGitHubUri.mockReturnValue({ owner: 'acme', repo: 'api', branch: 'main' });
      mockConnectSource.mockRejectedValue(new Error('Auth failed'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'connect to acme/api' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Failed to connect'),
        expect.any(String),
      );
    });

    it('should handle "approve tool <name>" failure', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockApproveCustomTool.mockRejectedValue(new Error('Not authorized'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'approve tool my-tool' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Not authorized'),
        expect.any(String),
      );
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "add skill" failure', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockAttachSkillToAgent.mockRejectedValue(new Error('Skill not found'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'add nonexistent skill' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Skill not found'),
        expect.any(String),
      );
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "trigger this agent when" command', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCreateTrigger.mockResolvedValue({ id: 'trigger-id-12345678' });

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'trigger this agent when a new message arrives' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).not.toHaveBeenCalled();
      expect(mockCreateTrigger).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'agent-1',
        triggerType: 'slack_channel',
      }));
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Trigger created'),
        expect.any(String),
      );
    });

    it('should detect linear trigger type from description', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCreateTrigger.mockResolvedValue({ id: 'trig-1234' });

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'trigger when a new linear issue is created' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockCreateTrigger).toHaveBeenCalledWith(expect.objectContaining({
        triggerType: 'linear',
      }));
    });

    it('should detect zendesk trigger type from description', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCreateTrigger.mockResolvedValue({ id: 'trig-1234' });

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'trigger when a new ticket is created' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockCreateTrigger).toHaveBeenCalledWith(expect.objectContaining({
        triggerType: 'zendesk',
      }));
    });

    it('should handle "add <skill> skill" command', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockAttachSkillToAgent.mockResolvedValue({});

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'add linear skill' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).not.toHaveBeenCalled();
      expect(mockAttachSkillToAgent).toHaveBeenCalledWith('agent-1', 'linear', 'read', 'U_USER');
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('linear'),
        expect.any(String),
      );
    });

    it('should handle "add <skill> skill with write" permission', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockAttachSkillToAgent.mockResolvedValue({});

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'add zendesk skill with write' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockAttachSkillToAgent).toHaveBeenCalledWith('agent-1', 'zendesk', 'write', 'U_USER');
    });

    it('should handle "add @user as admin" command', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockAddAgentAdmin.mockResolvedValue(undefined);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'add <@U_NEW_ADMIN> as admin' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).not.toHaveBeenCalled();
      expect(mockAddAgentAdmin).toHaveBeenCalledWith('agent-1', 'U_NEW_ADMIN', 'admin', 'U_USER');
    });

    it('should handle "forget about X" command when memory is enabled', async () => {
      const agent = makeAgent({ memory_enabled: true });
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockForgetMemory.mockResolvedValue(3);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'forget about old deployments' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockEnqueueRun).not.toHaveBeenCalled();
      expect(mockForgetMemory).toHaveBeenCalledWith('agent-1', 'old deployments');
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Forgot 3'),
        expect.any(String),
      );
    });

    it('should handle "forget about X" with no matches', async () => {
      const agent = makeAgent({ memory_enabled: true });
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockForgetMemory.mockResolvedValue(0);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'forget about unicorns' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('No memories found'),
        expect.any(String),
      );
    });

    it('should not handle "forget" when memory is disabled', async () => {
      const agent = makeAgent({ memory_enabled: false });
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCheckMessageRelevance.mockResolvedValue(true);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'forget about old data' });
      await mockApp._trigger('message', { event, client: {} });

      // Should not call forgetMemory, should proceed to normal enqueue
      expect(mockForgetMemory).not.toHaveBeenCalled();
      expect(mockEnqueueRun).toHaveBeenCalled();
    });

    it('should handle "create a skill that..." redirect', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'create a skill that does something' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('admin-only'),
        expect.any(String),
        agent.name,
        agent.avatar_emoji,
      );
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "approve tool <name>" command', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockApproveCustomTool.mockResolvedValue(undefined);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'approve tool my-tool' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockApproveCustomTool).toHaveBeenCalledWith('my-tool', 'U_USER');
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "tool versions <name>" command', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetToolVersions.mockResolvedValue([
        { version: 1, created_at: '2024-01-01', changed_by: 'U1' },
        { version: 2, created_at: '2024-01-02', changed_by: 'U2' },
      ]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'tool versions my-tool' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockGetToolVersions).toHaveBeenCalledWith('my-tool');
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Versions'),
        expect.any(String),
      );
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "find tool <query>" command', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockDiscoverTools.mockResolvedValue([
        { name: 'web-search', language: 'docker', approved: true, registered_by: 'user-1234' },
      ]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'find tool web' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockDiscoverTools).toHaveBeenCalledWith('web');
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('web-search'),
        expect.any(String),
      );
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "find tool" with no results', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockDiscoverTools.mockResolvedValue([]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'find tool unicorn' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('No tools found'),
        expect.any(String),
      );
    });

    it('should handle "share tool <name> with <agent>" command', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockShareToolWithAgent.mockResolvedValue(undefined);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'share tool web-search with other-bot' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockShareToolWithAgent).toHaveBeenCalledWith('web-search', 'agent-1', 'other-bot');
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "rollback tool <name> to version <n>" command', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockRollbackTool.mockResolvedValue(undefined);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'rollback tool my-tool to version 2' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockRollbackTool).toHaveBeenCalledWith('my-tool', 2, 'U_USER');
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "rollback tool" failure', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockRollbackTool.mockRejectedValue(new Error('Version not found'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'rollback tool my-tool to version 99' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Version not found'),
        expect.any(String),
      );
    });

    it('should handle "share tool" failure', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockShareToolWithAgent.mockRejectedValue(new Error('Tool not found'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'share tool my-tool with other-agent' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Tool not found'),
        expect.any(String),
      );
    });

    it('should handle "add @user as admin" failure', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockAddAgentAdmin.mockRejectedValue(new Error('Permission denied'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'add <@U_SOMEONE> as admin' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Permission denied'),
        expect.any(String),
      );
    });

    it('should handle trigger creation failure', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCreateTrigger.mockRejectedValue(new Error('Invalid trigger config'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'trigger this agent when something happens' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Failed to create trigger'),
        expect.any(String),
      );
    });

    it('should detect intercom trigger type from description', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCreateTrigger.mockResolvedValue({ id: 'trig-i' });

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'trigger when a new conversation is started' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockCreateTrigger).toHaveBeenCalledWith(expect.objectContaining({
        triggerType: 'intercom',
      }));
    });

    it('should default to webhook trigger type for generic descriptions', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockCreateTrigger.mockResolvedValue({ id: 'trig-w' });

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'trigger when a deployment finishes' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockCreateTrigger).toHaveBeenCalledWith(expect.objectContaining({
        triggerType: 'webhook',
      }));
    });

    it('should handle "forget" memory error gracefully', async () => {
      const agent = makeAgent({ memory_enabled: true });
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockForgetMemory.mockRejectedValue(new Error('Memory DB error'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'forget about old stuff' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Memory DB error'),
        expect.any(String),
      );
    });

    it('should handle "tool versions" with empty history', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetToolVersions.mockResolvedValue([]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'tool versions my-tool' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('No version history'),
        expect.any(String),
      );
    });

    it('should handle "show tools" with authored skills and MCP configs', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetAgentToolSummary.mockResolvedValue({ builtin: ['Read'], custom: ['my-tool'], mcp: ['slack-mcp'] });
      mockGetAuthoredSkills.mockResolvedValue([{ name: 'custom-skill', approved: true }]);
      mockGetMcpConfigs.mockResolvedValue([{ name: 'slack-config', approved: false }]);
      mockGetCodeArtifacts.mockResolvedValue([{ version: 3 }]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'show tools' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('custom-skill'),
        expect.any(String),
      );
    });

    it('should handle "show tools" failure', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetAgentToolSummary.mockRejectedValue(new Error('DB error'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'show tools' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('DB error'),
        expect.any(String),
      );
    });

    it('should handle "tool stats" failure', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetAllToolAnalytics.mockRejectedValue(new Error('Analytics unavailable'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'tool stats' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Analytics unavailable'),
        expect.any(String),
      );
    });

    it('should handle "find tool" failure', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockDiscoverTools.mockRejectedValue(new Error('Search index unavailable'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'find tool something' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Search index unavailable'),
        expect.any(String),
      );
    });

    it('should handle "tool versions" failure', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetToolVersions.mockRejectedValue(new Error('Version DB error'));

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'tool versions my-tool' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Version DB error'),
        expect.any(String),
      );
    });

    it('should handle "add to knowledge base" synonym', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'add to knowledge base' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('knowledge base'),
        expect.any(String),
      );
      expect(mockEnqueueRun).not.toHaveBeenCalled();
    });

    it('should handle "my tools" synonym for show tools', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetAgentToolSummary.mockResolvedValue({ builtin: [], custom: [], mcp: [] });

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'my tools' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Capabilities'),
        expect.any(String),
      );
    });

    it('should handle "list tools" synonym for show tools', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetAgentToolSummary.mockResolvedValue({ builtin: [], custom: [], mcp: [] });

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'list tools' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('Capabilities'),
        expect.any(String),
      );
    });

    it('should handle "tool analytics" synonym for tool stats', async () => {
      const agent = makeAgent();
      mockGetAgentsByChannel.mockResolvedValue([agent]);
      mockGetAllToolAnalytics.mockResolvedValue([]);

      registerEvents(mockApp as any);
      const event = makeMessageEvent({ text: 'tool analytics' });
      await mockApp._trigger('message', { event, client: {} });

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C_AGENT',
        expect.stringContaining('No tool usage data'),
        expect.any(String),
      );
    });
  });
});
