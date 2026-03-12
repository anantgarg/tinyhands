import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ──

const mockPostMessage = vi.fn().mockResolvedValue(undefined);
const mockUpdateMessage = vi.fn().mockResolvedValue(undefined);
const mockDeleteMessage = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/slack/index', () => ({
  postMessage: (...args: any[]) => mockPostMessage(...args),
  updateMessage: (...args: any[]) => mockUpdateMessage(...args),
  deleteMessage: (...args: any[]) => mockDeleteMessage(...args),
}));

vi.mock('../../src/utils/slack-format', () => ({
  markdownToSlack: (text: string) => text, // passthrough for tests
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  bufferEvent,
  setStatusMessageTs,
  setMainMessageTs,
  cleanupBuffer,
} from '../../src/slack/buffer';

// ── Tests ──

describe('Slack buffer module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clean up any lingering buffers to avoid cross-test contamination
    cleanupBuffer('C001', '111.222');
    cleanupBuffer('C002', '222.333');
    cleanupBuffer('C003', '333.444');
    cleanupBuffer('C001', '111.222', 'agent-1');
    vi.useRealTimers();
  });

  // ── bufferEvent basics ──

  describe('bufferEvent', () => {
    it('should buffer a text event and flush after BUFFER_INTERVAL_MS', async () => {
      bufferEvent('C001', '111.222', 'text', 'Hello world');

      // Should not have posted yet
      expect(mockPostMessage).not.toHaveBeenCalled();

      // Advance past buffer interval (1500ms)
      vi.advanceTimersByTime(1500);

      // Allow async flush to complete
      await vi.runAllTimersAsync();

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C001',
        'Hello world',
        '111.222',
        undefined,
        undefined,
      );
    });

    it('should batch multiple text events into a single message', async () => {
      bufferEvent('C001', '111.222', 'text', 'Line 1');
      bufferEvent('C001', '111.222', 'text', 'Line 2');
      bufferEvent('C001', '111.222', 'text', 'Line 3');

      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C001',
        'Line 1\nLine 2\nLine 3',
        '111.222',
        undefined,
        undefined,
      );
    });

    it('should pass username and iconEmoji to postMessage', async () => {
      bufferEvent('C001', '111.222', 'text', 'Agent message', 'AgentBot', ':robot_face:');

      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C001',
        'Agent message',
        '111.222',
        'AgentBot',
        ':robot_face:',
      );
    });

    it('should format error events with :x: prefix', async () => {
      bufferEvent('C001', '111.222', 'error', 'Something failed');

      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C001',
        ':x: Something failed',
        '111.222',
        undefined,
        undefined,
      );
    });
  });

  // ── thinking events ──

  describe('thinking events', () => {
    it('should update status message on thinking event', async () => {
      setStatusMessageTs('C001', '111.222', 'status-ts-1');
      bufferEvent('C001', '111.222', 'text', 'init'); // create buffer first
      bufferEvent('C001', '111.222', 'thinking', '');

      await vi.runAllTimersAsync();

      expect(mockUpdateMessage).toHaveBeenCalledWith(
        'C001',
        'status-ts-1',
        ':brain: Thinking...',
      );
    });

    it('should suppress thinking events when suppressThinking is true', async () => {
      setStatusMessageTs('C001', '111.222', 'status-ts-1');
      bufferEvent('C001', '111.222', 'text', 'init');
      bufferEvent('C001', '111.222', 'thinking', '', undefined, undefined, true);

      await vi.runAllTimersAsync();

      expect(mockUpdateMessage).not.toHaveBeenCalled();
    });
  });

  // ── tool_use events ──

  describe('tool_use events', () => {
    it('should update status message with tool name', async () => {
      setStatusMessageTs('C001', '111.222', 'status-ts-1');
      bufferEvent('C001', '111.222', 'text', 'init');
      bufferEvent('C001', '111.222', 'tool_use', 'web_search');

      await vi.runAllTimersAsync();

      expect(mockUpdateMessage).toHaveBeenCalledWith(
        'C001',
        'status-ts-1',
        ':wrench: Using `web_search`...',
      );
    });

    it('should truncate long tool names to 80 characters', async () => {
      setStatusMessageTs('C001', '111.222', 'status-ts-1');
      bufferEvent('C001', '111.222', 'text', 'init');
      const longToolName = 'a'.repeat(100);
      bufferEvent('C001', '111.222', 'tool_use', longToolName);

      await vi.runAllTimersAsync();

      const statusText = mockUpdateMessage.mock.calls[0][2];
      // The tool name inside backticks should be truncated (80 chars + wrapper text)
      // Full format: `:wrench: Using \`<truncated>\`...`
      expect(statusText.length).toBeLessThanOrEqual(100);
      expect(statusText).toContain('...');
    });
  });

  // ── tool_result events ──

  describe('tool_result events', () => {
    it('should not produce any output for tool_result events', async () => {
      bufferEvent('C001', '111.222', 'tool_result', 'Some result data');

      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      // tool_result returns early without adding to buffer
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  // ── done events ──

  describe('done events', () => {
    it('should delete status message and post final output on done', async () => {
      setStatusMessageTs('C001', '111.222', 'status-ts-1');
      bufferEvent('C001', '111.222', 'done', 'Final answer here');

      await vi.runAllTimersAsync();

      expect(mockDeleteMessage).toHaveBeenCalledWith('C001', 'status-ts-1');
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C001',
        'Final answer here',
        '111.222',
        undefined,
        undefined,
      );
    });

    it('should handle done without a status message', async () => {
      bufferEvent('C001', '111.222', 'done', 'No status to delete');

      await vi.runAllTimersAsync();

      expect(mockDeleteMessage).not.toHaveBeenCalled();
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C001',
        'No status to delete',
        '111.222',
        undefined,
        undefined,
      );
    });

    it('should truncate final output to 3000 characters', async () => {
      const longOutput = 'x'.repeat(5000);
      bufferEvent('C001', '111.222', 'done', longOutput);

      await vi.runAllTimersAsync();

      const postedText = mockPostMessage.mock.calls[0][1];
      expect(postedText.length).toBeLessThanOrEqual(3000);
    });

    it('should flush pending buffered events before handling done', async () => {
      bufferEvent('C001', '111.222', 'text', 'Partial streamed text');
      // done event should flush the pending text first
      bufferEvent('C001', '111.222', 'done', 'Final answer');

      await vi.runAllTimersAsync();

      // First call should be the flushed buffer, second call should be the final output
      expect(mockPostMessage).toHaveBeenCalledTimes(2);
    });
  });

  // ── setStatusMessageTs ──

  describe('setStatusMessageTs', () => {
    it('should set status message on an existing buffer', async () => {
      bufferEvent('C001', '111.222', 'text', 'init');
      setStatusMessageTs('C001', '111.222', 'new-status-ts');
      bufferEvent('C001', '111.222', 'thinking', '');

      await vi.runAllTimersAsync();

      expect(mockUpdateMessage).toHaveBeenCalledWith(
        'C001',
        'new-status-ts',
        ':brain: Thinking...',
      );
    });

    it('should store status ts for buffers not yet created', async () => {
      setStatusMessageTs('C002', '222.333', 'pre-status-ts');
      bufferEvent('C002', '222.333', 'done', 'Done');

      await vi.runAllTimersAsync();

      expect(mockDeleteMessage).toHaveBeenCalledWith('C002', 'pre-status-ts');
    });

    it('should support agentId in the key', async () => {
      setStatusMessageTs('C001', '111.222', 'agent-status-ts', 'agent-1');
      bufferEvent('C001', '111.222', 'text', 'init', undefined, undefined, false, 'agent-1');
      bufferEvent('C001', '111.222', 'thinking', '', undefined, undefined, false, 'agent-1');

      await vi.runAllTimersAsync();

      expect(mockUpdateMessage).toHaveBeenCalledWith(
        'C001',
        'agent-status-ts',
        ':brain: Thinking...',
      );
    });
  });

  // ── setMainMessageTs ──

  describe('setMainMessageTs', () => {
    it('should update statusMessageTs on existing buffer', async () => {
      bufferEvent('C001', '111.222', 'text', 'init');
      setMainMessageTs('C001', '111.222', 'main-ts-123');
      bufferEvent('C001', '111.222', 'thinking', '');

      await vi.runAllTimersAsync();

      expect(mockUpdateMessage).toHaveBeenCalledWith(
        'C001',
        'main-ts-123',
        ':brain: Thinking...',
      );
    });

    it('should do nothing if buffer does not exist', () => {
      // Should not throw
      expect(() => setMainMessageTs('C999', '999.999', 'ts')).not.toThrow();
    });
  });

  // ── cleanupBuffer ──

  describe('cleanupBuffer', () => {
    it('should remove buffer and prevent further flushes', async () => {
      bufferEvent('C001', '111.222', 'text', 'Will be cleaned up');
      cleanupBuffer('C001', '111.222');

      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should clean up agent-specific buffer', async () => {
      bufferEvent('C001', '111.222', 'text', 'Agent text', undefined, undefined, false, 'agent-1');
      cleanupBuffer('C001', '111.222', 'agent-1');

      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should handle cleanup of non-existent buffer without error', () => {
      expect(() => cleanupBuffer('C999', '999.999')).not.toThrow();
    });
  });

  // ── Flush failure / re-buffer ──

  describe('flush failure handling', () => {
    it('should re-buffer events on flush failure', async () => {
      mockPostMessage
        .mockRejectedValueOnce(new Error('rate_limited'))
        .mockResolvedValue(undefined);

      bufferEvent('C001', '111.222', 'text', 'Retry this');

      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      // First call failed, text should have been re-buffered
      expect(mockPostMessage).toHaveBeenCalledTimes(1);

      // Trigger another flush by adding a new event (the re-buffered event should be included)
      bufferEvent('C001', '111.222', 'text', 'New text');
      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      // Second call should include the re-buffered content
      expect(mockPostMessage).toHaveBeenCalledTimes(2);
      const secondCall = mockPostMessage.mock.calls[1][1];
      expect(secondCall).toContain('Retry this');
      expect(secondCall).toContain('New text');
    });
  });

  // ── Buffer isolation ──

  describe('buffer isolation', () => {
    it('should maintain separate buffers per channel/thread', async () => {
      bufferEvent('C001', '111.222', 'text', 'Channel 1');
      bufferEvent('C002', '222.333', 'text', 'Channel 2');

      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      expect(mockPostMessage).toHaveBeenCalledTimes(2);
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C001', 'Channel 1', '111.222', undefined, undefined,
      );
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C002', 'Channel 2', '222.333', undefined, undefined,
      );
    });

    it('should maintain separate buffers per agentId', async () => {
      bufferEvent('C001', '111.222', 'text', 'Default agent');
      bufferEvent('C001', '111.222', 'text', 'Agent-1 text', undefined, undefined, false, 'agent-1');

      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      expect(mockPostMessage).toHaveBeenCalledTimes(2);
    });
  });

  // ── Status message update failure ──

  describe('status message update failure', () => {
    it('should not throw when status update fails', async () => {
      mockUpdateMessage.mockRejectedValueOnce(new Error('channel_not_found'));

      setStatusMessageTs('C001', '111.222', 'status-ts');
      bufferEvent('C001', '111.222', 'text', 'init');
      bufferEvent('C001', '111.222', 'thinking', '');

      // Should not throw
      await vi.runAllTimersAsync();

      const { logger } = await import('../../src/utils/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to update status message',
        expect.objectContaining({ error: 'channel_not_found' }),
      );
    });
  });
});
