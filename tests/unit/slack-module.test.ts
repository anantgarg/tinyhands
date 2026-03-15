import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockSlackClient = {
  chat: {
    postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '123.456' }),
    update: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
    postEphemeral: vi.fn().mockResolvedValue({ ok: true }),
  },
  conversations: {
    create: vi.fn().mockResolvedValue({ ok: true, channel: { id: 'C123' } }),
    join: vi.fn().mockResolvedValue({ ok: true }),
    replies: vi.fn().mockResolvedValue({ ok: true, messages: [] }),
    open: vi.fn().mockResolvedValue({ ok: true, channel: { id: 'D999' } }),
  },
  views: {
    open: vi.fn().mockResolvedValue({ ok: true }),
    push: vi.fn().mockResolvedValue({ ok: true }),
    update: vi.fn().mockResolvedValue({ ok: true }),
    publish: vi.fn().mockResolvedValue({ ok: true }),
  },
  auth: {
    test: vi.fn().mockResolvedValue({ ok: true, user_id: 'UBOT' }),
  },
};

const mockApp = {
  client: mockSlackClient,
  start: vi.fn(),
  message: vi.fn(),
  event: vi.fn(),
  action: vi.fn(),
  command: vi.fn(),
  view: vi.fn(),
  error: vi.fn(),
};

vi.mock('@slack/bolt', () => ({
  App: vi.fn().mockImplementation(() => mockApp),
  LogLevel: { INFO: 'info', DEBUG: 'debug' },
}));

vi.mock('../../src/config', () => ({
  config: {
    slack: {
      botToken: 'xoxb-test-token',
      appToken: 'xapp-test-token',
    },
  },
}));

vi.mock('../../src/slack/commands', () => ({
  registerCommands: vi.fn(),
  registerModalHandlers: vi.fn(),
  registerConfirmationActions: vi.fn(),
  registerInlineActions: vi.fn(),
  registerToolAndKBModals: vi.fn(),
}));

vi.mock('../../src/slack/events', () => ({
  registerEvents: vi.fn(),
}));

vi.mock('../../src/slack/actions', () => ({
  registerActions: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createSlackApp,
  initSlackClient,
  getSlackApp,
  postMessage,
  updateMessage,
  deleteMessage,
  createChannel,
  postBlocks,
  postEphemeral,
  openModal,
  pushModal,
  updateModal,
  publishHomeTab,
  sendDM,
  sendDMBlocks,
  ensureBotInChannels,
  getThreadHistory,
} from '../../src/slack/index';

import { registerCommands, registerModalHandlers, registerConfirmationActions, registerInlineActions, registerToolAndKBModals } from '../../src/slack/commands';
import { registerEvents } from '../../src/slack/events';
import { registerActions } from '../../src/slack/actions';

// ── Tests ──

describe('Slack module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createSlackApp ──

  describe('createSlackApp', () => {
    it('should create and return a Bolt App instance', () => {
      const app = createSlackApp();
      expect(app).toBeDefined();
      expect(app.client).toBe(mockSlackClient);
    });

    it('should register all handler groups', () => {
      createSlackApp();
      expect(registerCommands).toHaveBeenCalledWith(mockApp);
      expect(registerModalHandlers).toHaveBeenCalledWith(mockApp);
      expect(registerConfirmationActions).toHaveBeenCalledWith(mockApp);
      expect(registerInlineActions).toHaveBeenCalledWith(mockApp);
      expect(registerToolAndKBModals).toHaveBeenCalledWith(mockApp);
      expect(registerEvents).toHaveBeenCalledWith(mockApp);
      expect(registerActions).toHaveBeenCalledWith(mockApp);
    });

    it('should register a global error handler', () => {
      createSlackApp();
      expect(mockApp.error).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should log errors when global error handler is invoked', async () => {
      createSlackApp();
      const { logger } = await import('../../src/utils/logger');
      const errorHandler = mockApp.error.mock.calls[0][0];
      const testError = new Error('test bolt error');
      await errorHandler(testError);
      expect(logger.error).toHaveBeenCalledWith(
        'Bolt global error handler',
        expect.objectContaining({
          message: 'test bolt error',
        }),
      );
    });
  });

  // ── initSlackClient ──

  describe('initSlackClient', () => {
    it('should initialize without error when app already exists', () => {
      createSlackApp();
      // createSlackApp already ran, so app is set — initSlackClient should short-circuit
      expect(() => initSlackClient()).not.toThrow();
    });

    it('should create a new app when not yet initialized', async () => {
      // Reset modules to get a fresh slack/index with app === undefined
      vi.resetModules();
      const freshSlack = await import('../../src/slack/index');
      freshSlack.initSlackClient();
      // Should now have a working app
      expect(() => freshSlack.getSlackApp()).not.toThrow();
    });
  });

  // ── getSlackApp ──

  describe('getSlackApp', () => {
    it('should return the app after initialization', () => {
      createSlackApp();
      const app = getSlackApp();
      expect(app).toBeDefined();
      expect(app.client).toBe(mockSlackClient);
    });
  });

  // ── postMessage ──

  describe('postMessage', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should call chat.postMessage with correct parameters', async () => {
      await postMessage('C001', 'Hello world');
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C001',
        text: 'Hello world',
        thread_ts: undefined,
        username: undefined,
        icon_emoji: undefined,
      });
    });

    it('should pass threadTs when provided', async () => {
      await postMessage('C001', 'Reply', '111.222');
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C001',
          text: 'Reply',
          thread_ts: '111.222',
        }),
      );
    });

    it('should pass username and iconEmoji when provided', async () => {
      await postMessage('C001', 'Bot message', undefined, 'MyBot', ':robot_face:');
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'MyBot',
          icon_emoji: ':robot_face:',
        }),
      );
    });
  });

  // ── updateMessage ──

  describe('updateMessage', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should call chat.update with correct parameters', async () => {
      await updateMessage('C001', '111.222', 'Updated text');
      expect(mockSlackClient.chat.update).toHaveBeenCalledWith({
        channel: 'C001',
        ts: '111.222',
        text: 'Updated text',
        blocks: [],
      });
    });
  });

  // ── deleteMessage ──

  describe('deleteMessage', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should call chat.delete with correct parameters', async () => {
      await deleteMessage('C001', '111.222');
      expect(mockSlackClient.chat.delete).toHaveBeenCalledWith({
        channel: 'C001',
        ts: '111.222',
      });
    });

    it('should suppress message_not_found errors', async () => {
      mockSlackClient.chat.delete.mockRejectedValueOnce({
        data: { error: 'message_not_found' },
      });
      await expect(deleteMessage('C001', '111.222')).resolves.toBeUndefined();
    });

    it('should re-throw other errors', async () => {
      const err = new Error('network_error');
      (err as any).data = { error: 'network_error' };
      mockSlackClient.chat.delete.mockRejectedValueOnce(err);
      await expect(deleteMessage('C001', '111.222')).rejects.toThrow('network_error');
    });
  });

  // ── createChannel ──

  describe('createChannel', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should create a channel with sanitized name', async () => {
      const channelId = await createChannel('My Project');
      expect(mockSlackClient.conversations.create).toHaveBeenCalledWith({
        name: 'tinyhands-my-project',
        is_private: false,
      });
      expect(channelId).toBe('C123');
    });

    it('should join the newly created channel', async () => {
      await createChannel('test');
      expect(mockSlackClient.conversations.join).toHaveBeenCalledWith({
        channel: 'C123',
      });
    });

    it('should retry with suffix when name is taken', async () => {
      mockSlackClient.conversations.create
        .mockRejectedValueOnce({ data: { error: 'name_taken' } })
        .mockResolvedValueOnce({ ok: true, channel: { id: 'C456' } });

      const channelId = await createChannel('taken-name');
      expect(mockSlackClient.conversations.create).toHaveBeenCalledTimes(2);
      expect(channelId).toBe('C456');
    });

    it('should throw after 5 name_taken attempts', async () => {
      mockSlackClient.conversations.create.mockRejectedValue({
        data: { error: 'name_taken' },
      });
      await expect(createChannel('taken')).rejects.toThrow();
    });

    it('should throw immediately for non-name_taken errors', async () => {
      mockSlackClient.conversations.create.mockRejectedValueOnce({
        data: { error: 'restricted_action' },
      });
      await expect(createChannel('restricted')).rejects.toBeDefined();
    });

    it('should truncate channel name to 80 characters', async () => {
      mockSlackClient.conversations.create.mockResolvedValueOnce({ ok: true, channel: { id: 'C789' } });
      const longName = 'a'.repeat(100);
      await createChannel(longName);
      const lastCall = mockSlackClient.conversations.create.mock.calls;
      const calledName = lastCall[lastCall.length - 1][0].name;
      expect(calledName.length).toBeLessThanOrEqual(80);
    });

    it('should return empty string when channel ID is missing from response', async () => {
      mockSlackClient.conversations.create.mockResolvedValueOnce({ ok: true, channel: {} });
      const channelId = await createChannel('no-id');
      expect(channelId).toBe('');
      // Should not attempt to join when channelId is empty
      expect(mockSlackClient.conversations.join).not.toHaveBeenCalled();
    });

    it('should handle join failure silently after creating channel', async () => {
      mockSlackClient.conversations.create.mockResolvedValueOnce({ ok: true, channel: { id: 'C999' } });
      mockSlackClient.conversations.join.mockRejectedValueOnce(new Error('cannot_join'));
      const channelId = await createChannel('test-join-fail');
      expect(channelId).toBe('C999');
    });
  });

  // ── postBlocks ──

  describe('postBlocks', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should call chat.postMessage with blocks and return ts', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Hello' } }];
      const ts = await postBlocks('C001', blocks, 'fallback text');
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C001',
          blocks,
          text: 'fallback text',
          thread_ts: undefined,
        }),
      );
      expect(ts).toBe('123.456');
    });

    it('should support threadTs, username, and iconEmoji', async () => {
      const blocks = [{ type: 'divider' }];
      await postBlocks('C001', blocks, 'text', '111.222', 'AgentBot', ':star:');
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: '111.222',
          username: 'AgentBot',
          icon_emoji: ':star:',
        }),
      );
    });
  });

  // ── postEphemeral ──

  describe('postEphemeral', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should call chat.postEphemeral with correct parameters', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Ephemeral' } }];
      await postEphemeral('C001', 'U001', blocks, 'fallback text');
      expect(mockSlackClient.chat.postEphemeral).toHaveBeenCalledWith({
        channel: 'C001',
        user: 'U001',
        blocks,
        text: 'fallback text',
      });
    });

    it('should call chat.postEphemeral with empty blocks', async () => {
      await postEphemeral('C002', 'U002', [], 'simple text');
      expect(mockSlackClient.chat.postEphemeral).toHaveBeenCalledWith({
        channel: 'C002',
        user: 'U002',
        blocks: [],
        text: 'simple text',
      });
    });
  });

  // ── openModal ──

  describe('openModal', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should call views.open with trigger_id and view', async () => {
      const view = { type: 'modal', title: { type: 'plain_text', text: 'Test' } };
      await openModal('trigger-123', view);
      expect(mockSlackClient.views.open).toHaveBeenCalledWith({
        trigger_id: 'trigger-123',
        view,
      });
    });
  });

  // ── pushModal ──

  describe('pushModal', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should call views.push with trigger_id and view', async () => {
      const view = { type: 'modal', title: { type: 'plain_text', text: 'Pushed' } };
      await pushModal('trigger-456', view);
      expect(mockSlackClient.views.push).toHaveBeenCalledWith({
        trigger_id: 'trigger-456',
        view,
      });
    });
  });

  // ── updateModal ──

  describe('updateModal', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should call views.update with view_id and view', async () => {
      const view = { type: 'modal', title: { type: 'plain_text', text: 'Updated' } };
      await updateModal('V123', view);
      expect(mockSlackClient.views.update).toHaveBeenCalledWith({
        view_id: 'V123',
        view,
      });
    });
  });

  // ── publishHomeTab ──

  describe('publishHomeTab', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should call views.publish with user_id and home view', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Welcome' } }];
      await publishHomeTab('U001', blocks);
      expect(mockSlackClient.views.publish).toHaveBeenCalledWith({
        user_id: 'U001',
        view: {
          type: 'home',
          blocks,
        },
      });
    });
  });

  // ── sendDM ──

  describe('sendDM', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should open a DM conversation and post a message', async () => {
      const ts = await sendDM('U001', 'Hello DM');
      expect(mockSlackClient.conversations.open).toHaveBeenCalledWith({ users: 'U001' });
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith({
        channel: 'D999',
        text: 'Hello DM',
        blocks: undefined,
      });
      expect(ts).toBe('123.456');
    });

    it('should return undefined if conversations.open fails to return a channel', async () => {
      mockSlackClient.conversations.open.mockResolvedValueOnce({ ok: true, channel: {} });
      const ts = await sendDM('U002', 'No channel');
      expect(ts).toBeUndefined();
    });

    it('should pass blocks when provided', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Block DM' } }];
      await sendDM('U001', 'Block text', blocks);
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ blocks }),
      );
    });
  });

  // ── sendDMBlocks ──

  describe('sendDMBlocks', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should delegate to sendDM with blocks and text', async () => {
      const blocks = [{ type: 'divider' }];
      const ts = await sendDMBlocks('U001', blocks, 'fallback');
      expect(mockSlackClient.conversations.open).toHaveBeenCalledWith({ users: 'U001' });
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'D999',
          text: 'fallback',
          blocks,
        }),
      );
      expect(ts).toBe('123.456');
    });
  });

  // ── ensureBotInChannels ──

  describe('ensureBotInChannels', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should attempt to join each channel', async () => {
      await ensureBotInChannels(['C001', 'C002', 'C003']);
      expect(mockSlackClient.conversations.join).toHaveBeenCalledTimes(3);
      expect(mockSlackClient.conversations.join).toHaveBeenCalledWith({ channel: 'C001' });
      expect(mockSlackClient.conversations.join).toHaveBeenCalledWith({ channel: 'C002' });
      expect(mockSlackClient.conversations.join).toHaveBeenCalledWith({ channel: 'C003' });
    });

    it('should silently handle already_in_channel errors', async () => {
      mockSlackClient.conversations.join.mockRejectedValueOnce({
        data: { error: 'already_in_channel' },
        message: 'already_in_channel',
      });
      await expect(ensureBotInChannels(['C001'])).resolves.toBeUndefined();
    });

    it('should warn on other join errors but not throw', async () => {
      mockSlackClient.conversations.join.mockRejectedValueOnce({
        data: { error: 'channel_not_found' },
        message: 'channel_not_found',
      });
      const { logger } = await import('../../src/utils/logger');
      await ensureBotInChannels(['C001']);
      expect(logger.warn).toHaveBeenCalledWith(
        'Could not auto-join channel — invite the bot manually',
        expect.objectContaining({ channelId: 'C001' }),
      );
    });

    it('should handle empty array', async () => {
      await ensureBotInChannels([]);
      expect(mockSlackClient.conversations.join).not.toHaveBeenCalled();
    });
  });

  // ── getThreadHistory ──

  describe('getThreadHistory', () => {
    beforeEach(() => {
      createSlackApp();
    });

    it('should return empty string when no messages', async () => {
      mockSlackClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });
      const history = await getThreadHistory('C001', '111.222');
      expect(history).toBe('');
    });

    it('should return empty string when only one message (the current one)', async () => {
      mockSlackClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [{ text: 'Only message', user: 'U001' }],
      });
      const history = await getThreadHistory('C001', '111.222');
      expect(history).toBe('');
    });

    it('should format thread messages excluding the latest', async () => {
      mockSlackClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [
          { text: 'User question', user: 'U001' },
          { text: 'Bot reply', bot_id: 'B001', user: 'UBOT' },
          { text: 'Follow-up', user: 'U001' },
        ],
      });
      const history = await getThreadHistory('C001', '111.222');
      expect(history).toContain('[user]: User question');
      expect(history).toContain('[assistant]: Bot reply');
      // The latest message (Follow-up) should be excluded
      expect(history).not.toContain('Follow-up');
    });

    it('should label bot messages as assistant', async () => {
      mockSlackClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [
          { text: 'Bot response', user: 'UBOT' },
          { text: 'User reply', user: 'U002' },
        ],
      });
      const history = await getThreadHistory('C001', '111.222');
      expect(history).toContain('[assistant]: Bot response');
    });

    it('should call conversations.replies with correct parameters', async () => {
      mockSlackClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });
      await getThreadHistory('C001', '111.222', 50);
      expect(mockSlackClient.conversations.replies).toHaveBeenCalledWith({
        channel: 'C001',
        ts: '111.222',
        limit: 50,
        inclusive: true,
      });
    });

    it('should use default limit of 20', async () => {
      mockSlackClient.conversations.replies.mockResolvedValueOnce({
        ok: true,
        messages: [],
      });
      await getThreadHistory('C001', '111.222');
      expect(mockSlackClient.conversations.replies).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('should return empty string on API error', async () => {
      mockSlackClient.conversations.replies.mockRejectedValueOnce(
        new Error('channel_not_found'),
      );
      const history = await getThreadHistory('C001', '111.222');
      expect(history).toBe('');
    });
  });
});
