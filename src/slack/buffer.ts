import { postMessage, updateMessage, deleteMessage } from './index';
import { markdownToSlack } from '../utils/slack-format';
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
  statusMessageTs?: string; // Temporary status message that gets updated/deleted on completion
}

const buffers = new Map<string, ChannelBuffer>();

// Map of channelId:threadTs -> statusMessageTs for pre-created status messages from events.ts
const pendingStatusMessages = new Map<string, string>();

const BUFFER_INTERVAL_MS = 1500;
const MAX_THINKING_CHARS = 200;
const MAX_TOOL_RESULT_CHARS = 150;

export function setStatusMessageTs(channelId: string, threadTs: string, ts: string, agentId?: string): void {
  const key = agentId ? `${channelId}:${threadTs}:${agentId}` : `${channelId}:${threadTs}`;
  pendingStatusMessages.set(key, ts);
  // Also set on buffer if it already exists
  const buffer = buffers.get(key);
  if (buffer) {
    buffer.statusMessageTs = ts;
  }
}

export function bufferEvent(
  channelId: string,
  threadTs: string,
  eventType: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'done' | 'error',
  content: string,
  username?: string,
  iconEmoji?: string,
  suppressThinking: boolean = false,
  agentId?: string,
): void {
  const key = agentId ? `${channelId}:${threadTs}:${agentId}` : `${channelId}:${threadTs}`;

  if (!buffers.has(key)) {
    const statusTs = pendingStatusMessages.get(key);
    pendingStatusMessages.delete(key);
    logger.info('Buffer created', { key, statusTs: statusTs || 'none', pendingKeys: [...pendingStatusMessages.keys()].join(',') });
    buffers.set(key, {
      events: [],
      timer: null,
      channelId,
      threadTs,
      username,
      iconEmoji,
      statusMessageTs: statusTs,
    });
  }

  const buffer = buffers.get(key)!;

  // Format event text
  let text: string;
  switch (eventType) {
    case 'thinking':
      if (suppressThinking) return;
      // Update the temporary status message — no agent prefix needed, chat:write.customize shows the name
      updateStatusMessage(buffer, `:brain: Thinking...`);
      return;
    case 'tool_use':
      // Update the temporary status message with tool use state
      updateStatusMessage(buffer, `:wrench: Using \`${truncate(content, 80)}\`...`);
      return;
    case 'tool_result':
      // Don't show tool results as separate messages
      return;
    case 'text':
      text = content;
      break;
    case 'done':
      // Done event: flush any pending, then handle completion
      flushBuffer(key);
      handleDoneEvent(buffer, markdownToSlack(content));
      return;
    case 'error':
      text = `:x: Dropped the ball — ${content}`;
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

async function updateStatusMessage(buffer: ChannelBuffer, statusText: string): Promise<void> {
  if (!buffer.statusMessageTs) return;
  try {
    await updateMessage(buffer.channelId, buffer.statusMessageTs, statusText);
  } catch (err: any) {
    logger.warn('Failed to update status message', { error: err.message });
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
    // Delete the "Thinking..." status message and post a fresh one with username/icon
    if (buffer.statusMessageTs) {
      logger.info('Deleting status message', { channelId: buffer.channelId, statusTs: buffer.statusMessageTs });
      await deleteMessage(buffer.channelId, buffer.statusMessageTs).catch((err) => {
        logger.warn('Failed to delete status message', { error: String(err), channelId: buffer.channelId, statusTs: buffer.statusMessageTs });
      });
    } else {
      logger.info('No status message to delete', { channelId: buffer.channelId, threadTs: buffer.threadTs });
    }

    // No text prefix needed — chat:write.customize shows agent name/emoji as the bot identity
    const fullOutput = finalOutput.slice(0, 3000);

    await postMessage(
      buffer.channelId,
      fullOutput,
      buffer.threadTs,
      buffer.username,
      buffer.iconEmoji
    );
  } catch (err: any) {
    logger.warn('Failed to post done event', { error: err.message });
    try {
      await postMessage(
        buffer.channelId,
        finalOutput,
        buffer.threadTs,
        buffer.username,
        buffer.iconEmoji
      );
    } catch {
      // Best effort
    }
  }

  // Cleanup buffer
  const key = `${buffer.channelId}:${buffer.threadTs}`;
  buffers.delete(key);
}

export function setMainMessageTs(channelId: string, threadTs: string, ts: string): void {
  const key = `${channelId}:${threadTs}`;
  const buffer = buffers.get(key);
  if (buffer) {
    buffer.statusMessageTs = ts;
  }
}

export async function cleanupStatusMessage(channelId: string, threadTs: string, agentId?: string): Promise<void> {
  const key = agentId ? `${channelId}:${threadTs}:${agentId}` : `${channelId}:${threadTs}`;
  const buffer = buffers.get(key);
  const statusTs = buffer?.statusMessageTs || pendingStatusMessages.get(key);
  if (statusTs) {
    await deleteMessage(channelId, statusTs).catch((err) => {
      logger.warn('Failed to delete status message during silent cleanup', { error: String(err) });
    });
  }
  cleanupBuffer(channelId, threadTs, agentId);
}

export function cleanupBuffer(channelId: string, threadTs: string, agentId?: string): void {
  const key = agentId ? `${channelId}:${threadTs}:${agentId}` : `${channelId}:${threadTs}`;
  const buffer = buffers.get(key);
  if (buffer?.timer) {
    clearTimeout(buffer.timer);
  }
  buffers.delete(key);
  pendingStatusMessages.delete(key);
}

function agentPrefix(buffer: ChannelBuffer): string {
  if (!buffer.username) return '';
  return `${buffer.iconEmoji || ':robot_face:'} *${buffer.username}* `;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
