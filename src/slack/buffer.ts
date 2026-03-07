import { postMessage, updateMessage } from './index';
import { logger } from '../utils/logger';

// ── Slack Event Buffer ──
// Batches SDK events in 1.5-second windows to respect Slack rate limits (~1 msg/sec/channel)

interface BufferedEvent {
  text: string;
  timestamp: number;
}

interface ChannelBuffer {
  events: BufferedEvent[];
  timer: ReturnType<typeof setTimeout> | null;
  channelId: string;
  threadTs: string;
  username?: string;
  iconEmoji?: string;
  mainMessageTs?: string;
}

const buffers = new Map<string, ChannelBuffer>();
const BUFFER_INTERVAL_MS = 1500;
const MAX_THINKING_CHARS = 200;
const MAX_TOOL_RESULT_CHARS = 150;

export function bufferEvent(
  channelId: string,
  threadTs: string,
  eventType: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'done' | 'error',
  content: string,
  username?: string,
  iconEmoji?: string,
  suppressThinking: boolean = false
): void {
  const key = `${channelId}:${threadTs}`;

  if (!buffers.has(key)) {
    buffers.set(key, {
      events: [],
      timer: null,
      channelId,
      threadTs,
      username,
      iconEmoji,
    });
  }

  const buffer = buffers.get(key)!;

  // Format event text
  let text: string;
  switch (eventType) {
    case 'thinking':
      if (suppressThinking) return; // Haiku: no thinking traces
      text = `:brain: _${truncate(content, MAX_THINKING_CHARS)}_`;
      break;
    case 'tool_use':
      text = `:wrench: \`${content}\``;
      break;
    case 'tool_result':
      text = `:white_check_mark: ${truncate(content, MAX_TOOL_RESULT_CHARS)}`;
      break;
    case 'text':
      text = content;
      break;
    case 'done':
      // Done event: flush immediately and update main message
      flushBuffer(key);
      handleDoneEvent(buffer, content);
      return;
    case 'error':
      text = `:x: Error: ${content}`;
      break;
    default:
      text = content;
  }

  buffer.events.push({ text, timestamp: Date.now() });

  // Start flush timer if not already running
  if (!buffer.timer) {
    buffer.timer = setTimeout(() => flushBuffer(key), BUFFER_INTERVAL_MS);
  }
}

async function flushBuffer(key: string): Promise<void> {
  const buffer = buffers.get(key);
  if (!buffer || buffer.events.length === 0) {
    if (buffer?.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    return;
  }

  // Combine buffered events into a single message
  const combined = buffer.events.map(e => e.text).join('\n');
  buffer.events = [];

  if (buffer.timer) {
    clearTimeout(buffer.timer);
    buffer.timer = null;
  }

  try {
    await postMessage(
      buffer.channelId,
      combined,
      buffer.threadTs,
      buffer.username,
      buffer.iconEmoji
    );
  } catch (err: any) {
    logger.warn('Failed to flush Slack buffer', {
      channelId: buffer.channelId,
      error: err.message,
    });

    // Re-buffer on failure (max 50 events)
    if (buffer.events.length < 50) {
      buffer.events.unshift({ text: combined, timestamp: Date.now() });
    }
  }
}

async function handleDoneEvent(buffer: ChannelBuffer, finalOutput: string): Promise<void> {
  try {
    // Post final answer as thread reply
    await postMessage(
      buffer.channelId,
      finalOutput,
      buffer.threadTs,
      buffer.username,
      buffer.iconEmoji
    );

    // Update the main acknowledgment message if we have its ts
    if (buffer.mainMessageTs) {
      await updateMessage(
        buffer.channelId,
        buffer.mainMessageTs,
        finalOutput.slice(0, 3000) // Slack message limit
      );
    }
  } catch (err: any) {
    logger.warn('Failed to post done event', { error: err.message });
  }

  // Cleanup buffer
  const key = `${buffer.channelId}:${buffer.threadTs}`;
  buffers.delete(key);
}

export function setMainMessageTs(channelId: string, threadTs: string, ts: string): void {
  const key = `${channelId}:${threadTs}`;
  const buffer = buffers.get(key);
  if (buffer) {
    buffer.mainMessageTs = ts;
  }
}

export function cleanupBuffer(channelId: string, threadTs: string): void {
  const key = `${channelId}:${threadTs}`;
  const buffer = buffers.get(key);
  if (buffer?.timer) {
    clearTimeout(buffer.timer);
  }
  buffers.delete(key);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
