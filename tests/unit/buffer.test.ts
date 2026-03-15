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
  cleanupStatusMessage,
  agentPrefix,
  flushBuffer,
  buffers,
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
        ':x: Dropped the ball — Something failed',
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

    it('should not update status message when no statusMessageTs is set', async () => {
      bufferEvent('C001', '111.222', 'text', 'init');
      bufferEvent('C001', '111.222', 'thinking', '');

      await vi.runAllTimersAsync();

      // updateMessage should not be called since no statusMessageTs was set
      expect(mockUpdateMessage).not.toHaveBeenCalled();
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
    it('should update status message with friendly tool name', async () => {
      setStatusMessageTs('C001', '111.222', 'status-ts-1');
      bufferEvent('C001', '111.222', 'text', 'init');
      bufferEvent('C001', '111.222', 'tool_use', 'WebFetch');

      await vi.runAllTimersAsync();

      expect(mockUpdateMessage).toHaveBeenCalledWith(
        'C001',
        'status-ts-1',
        ':wrench: Fetching a webpage...',
      );
    });

    it('should fall back to "Working on it" for unknown tools', async () => {
      setStatusMessageTs('C001', '111.222', 'status-ts-1');
      bufferEvent('C001', '111.222', 'text', 'init');
      bufferEvent('C001', '111.222', 'tool_use', 'custom_tool');

      await vi.runAllTimersAsync();

      expect(mockUpdateMessage).toHaveBeenCalledWith(
        'C001',
        'status-ts-1',
        ':wrench: Working on it...',
      );
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

    it('should split final output exceeding 15000 characters into multiple messages', async () => {
      const longOutput = 'x'.repeat(20000);
      bufferEvent('C001', '111.222', 'done', longOutput);

      await vi.runAllTimersAsync();

      // Should be split into 2 messages
      expect(mockPostMessage.mock.calls.length).toBe(2);
      expect(mockPostMessage.mock.calls[0][1].length).toBeLessThanOrEqual(15000);
      expect(mockPostMessage.mock.calls[1][1].length).toBeLessThanOrEqual(15000);
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

  // ── cleanupStatusMessage ──

  describe('cleanupStatusMessage', () => {
    it('should delete status message from buffer and clean up', async () => {
      setStatusMessageTs('C001', '111.222', 'status-ts-cleanup');
      bufferEvent('C001', '111.222', 'text', 'init');

      await cleanupStatusMessage('C001', '111.222');

      expect(mockDeleteMessage).toHaveBeenCalledWith('C001', 'status-ts-cleanup');
    });

    it('should delete status message from pendingStatusMessages when buffer does not exist', async () => {
      setStatusMessageTs('C003', '333.444', 'pending-status-ts');

      await cleanupStatusMessage('C003', '333.444');

      expect(mockDeleteMessage).toHaveBeenCalledWith('C003', 'pending-status-ts');
    });

    it('should handle delete failure gracefully', async () => {
      mockDeleteMessage.mockRejectedValueOnce(new Error('message_not_found'));

      setStatusMessageTs('C001', '111.222', 'status-ts-fail');
      bufferEvent('C001', '111.222', 'text', 'init');

      // Should not throw
      await cleanupStatusMessage('C001', '111.222');

      const { logger } = await import('../../src/utils/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to delete status message during silent cleanup',
        expect.objectContaining({ error: expect.stringContaining('message_not_found') }),
      );
    });

    it('should support agentId in the key', async () => {
      setStatusMessageTs('C001', '111.222', 'agent-status-cleanup', 'agent-1');
      bufferEvent('C001', '111.222', 'text', 'init', undefined, undefined, false, 'agent-1');

      await cleanupStatusMessage('C001', '111.222', 'agent-1');

      expect(mockDeleteMessage).toHaveBeenCalledWith('C001', 'agent-status-cleanup');
    });

    it('should do nothing when no status message exists', async () => {
      await cleanupStatusMessage('C999', '999.999');

      expect(mockDeleteMessage).not.toHaveBeenCalled();
    });
  });

  // ── agentPrefix (indirectly tested via buffer internals) ──
  // The agentPrefix function is private, but we can test it indirectly
  // through the handleDoneEvent path. However, since we need to access it directly,
  // we test the conditions that exercise it.

  // ── splitMessage with various split strategies ──

  describe('splitMessage edge cases', () => {
    it('should split at space when no newline is available near the limit', async () => {
      // Create a long string of words (no newlines) that exceeds 15000 chars
      // Using words separated by spaces but no newlines
      const words = [];
      while (words.join(' ').length < 20000) {
        words.push('word'.repeat(10));
      }
      const longText = words.join(' ');

      bufferEvent('C001', '111.222', 'done', longText);
      await vi.runAllTimersAsync();

      // Should have split into multiple messages
      expect(mockPostMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
      // Each chunk should be at or below 15000
      for (const call of mockPostMessage.mock.calls) {
        expect(call[1].length).toBeLessThanOrEqual(15000);
      }
    });

    it('should hard split when no space or newline break point available', async () => {
      // Create a single long string with no spaces or newlines
      const longText = 'x'.repeat(20000);

      bufferEvent('C001', '111.222', 'done', longText);
      await vi.runAllTimersAsync();

      expect(mockPostMessage.mock.calls.length).toBe(2);
      expect(mockPostMessage.mock.calls[0][1].length).toBe(15000);
      expect(mockPostMessage.mock.calls[1][1].length).toBe(5000);
    });
  });

  // ── handleDoneEvent error recovery ──

  describe('handleDoneEvent error recovery', () => {
    it('should retry posting message when first attempt fails', async () => {
      mockPostMessage
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue(undefined);

      bufferEvent('C001', '111.222', 'done', 'Final output');
      await vi.runAllTimersAsync();

      // Should have tried twice: first attempt fails, retry succeeds
      expect(mockPostMessage).toHaveBeenCalledTimes(2);
      const { logger } = await import('../../src/utils/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to post done event',
        expect.objectContaining({ error: 'network error' }),
      );
    });

    it('should not throw when both attempts fail', async () => {
      mockPostMessage
        .mockRejectedValueOnce(new Error('first failure'))
        .mockRejectedValueOnce(new Error('second failure'));

      bufferEvent('C001', '111.222', 'done', 'Final output');
      // Should not throw
      await vi.runAllTimersAsync();

      expect(mockPostMessage).toHaveBeenCalledTimes(2);
    });

    it('should delete status message catch logging in handleDoneEvent', async () => {
      setStatusMessageTs('C001', '111.222', 'status-ts-done');
      mockDeleteMessage.mockRejectedValueOnce(new Error('delete_failed'));

      bufferEvent('C001', '111.222', 'done', 'Final output');
      await vi.runAllTimersAsync();

      const { logger } = await import('../../src/utils/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to delete status message',
        expect.objectContaining({ error: expect.stringContaining('delete_failed') }),
      );
      // Should still post the final message
      expect(mockPostMessage).toHaveBeenCalled();
    });
  });

  // ── Default event type fallthrough ──

  describe('default event type', () => {
    it('should use content as-is for unknown event types', async () => {
      // Cast to bypass TypeScript type checking for unknown event type
      bufferEvent('C001', '111.222', 'unknown_type' as any, 'Raw content');

      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C001',
        'Raw content',
        '111.222',
        undefined,
        undefined,
      );
    });
  });

  // ── flushBuffer with empty events but existing timer ──

  describe('flushBuffer edge cases', () => {
    it('should clear timer when buffer has no events to flush', async () => {
      bufferEvent('C001', '111.222', 'text', 'First message');

      // Advance to flush the first message
      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      expect(mockPostMessage).toHaveBeenCalledTimes(1);

      // Now the buffer exists but has no events - adding and removing should work
      // Send a thinking event (which doesn't add to buffer.events)
      setStatusMessageTs('C001', '111.222', 'status-ts-flush');
      bufferEvent('C001', '111.222', 'thinking', '');

      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      // postMessage should still be 1 (no new events to flush)
      expect(mockPostMessage).toHaveBeenCalledTimes(1);
    });

    it('should handle flushBuffer called on done when buffer events were already flushed', async () => {
      // Create buffer with a text event
      bufferEvent('C001', '111.222', 'text', 'Some text');

      // Flush the buffer by advancing timer
      vi.advanceTimersByTime(1500);
      await vi.runAllTimersAsync();

      expect(mockPostMessage).toHaveBeenCalledTimes(1);

      // Now send a done event - the flushBuffer(key) call inside bufferEvent('done')
      // will encounter the buffer with 0 events and a null timer
      bufferEvent('C001', '111.222', 'done', 'Final output');
      await vi.runAllTimersAsync();

      // Should post the final output
      expect(mockPostMessage).toHaveBeenCalledTimes(2);
    });

    it('should clear timer when flushBuffer finds buffer with timer but no events', async () => {
      // Create a buffer with a text event (sets timer)
      bufferEvent('C001', '111.222', 'text', 'Initial');

      // Directly access the buffer and empty its events while keeping the timer
      const key = 'C001:111.222';
      const buffer = buffers.get(key)!;
      expect(buffer.timer).not.toBeNull();
      buffer.events = []; // Clear events but leave timer set

      // Now call flushBuffer directly - should hit the path where
      // buffer exists, events.length === 0, and timer is truthy
      await flushBuffer(key);

      // Timer should now be cleared
      expect(buffer.timer).toBeNull();
      // postMessage should not have been called (no events to flush)
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  // ── agentPrefix ──

  describe('agentPrefix', () => {
    it('should return empty string when no username is set', () => {
      const buffer = {
        events: [],
        timer: null,
        channelId: 'C001',
        threadTs: '111.222',
      } as any;

      expect(agentPrefix(buffer)).toBe('');
    });

    it('should return formatted prefix with username and iconEmoji', () => {
      const buffer = {
        events: [],
        timer: null,
        channelId: 'C001',
        threadTs: '111.222',
        username: 'TestBot',
        iconEmoji: ':sparkles:',
      } as any;

      expect(agentPrefix(buffer)).toBe(':sparkles: *TestBot* ');
    });

    it('should use robot_face emoji as default when iconEmoji is not set', () => {
      const buffer = {
        events: [],
        timer: null,
        channelId: 'C001',
        threadTs: '111.222',
        username: 'TestBot',
      } as any;

      expect(agentPrefix(buffer)).toBe(':robot_face: *TestBot* ');
    });
  });
});
