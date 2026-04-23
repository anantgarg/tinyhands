// Extracts a single string representation of a Slack message that includes
// not just `msg.text` but also content carried in `msg.attachments` and
// (as a fallback) `msg.blocks`. Many third-party Slack apps (HubSpot, Datadog,
// Jira, GitHub, PagerDuty, etc.) put the interesting payload in attachments or
// Block Kit, not in the top-level `text` field. Reading only `msg.text`
// silently drops that content before the agent ever sees it.

import { logger } from '../utils/logger';

type AnyObj = Record<string, any>;

const MAX_LEN = 50_000;
const TRUNCATION_MARKER = '…[truncated]';

function pushIfNonEmpty(parts: string[], value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed) parts.push(trimmed);
}

function walkRichTextElements(elements: any[], parts: string[]): void {
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;
    switch (el.type) {
      case 'text':
        pushIfNonEmpty(parts, el.text);
        break;
      case 'emoji':
        if (el.name) pushIfNonEmpty(parts, `:${el.name}:`);
        break;
      case 'link':
        if (el.url && el.text && el.text !== el.url) {
          pushIfNonEmpty(parts, `${el.url} ${el.text}`);
        } else {
          pushIfNonEmpty(parts, el.url || el.text);
        }
        break;
      case 'user':
        if (el.user_id) pushIfNonEmpty(parts, `<@${el.user_id}>`);
        break;
      case 'channel':
        if (el.channel_id) pushIfNonEmpty(parts, `<#${el.channel_id}>`);
        break;
      case 'rich_text_section':
      case 'rich_text_list':
      case 'rich_text_quote':
      case 'rich_text_preformatted':
        if (Array.isArray(el.elements)) walkRichTextElements(el.elements, parts);
        break;
      case 'usergroup':
      case 'broadcast':
      case 'color':
        break;
      default:
        if (Array.isArray(el.elements)) walkRichTextElements(el.elements, parts);
    }
  }
}

function extractFromBlock(block: AnyObj, parts: string[]): void {
  if (!block || typeof block !== 'object') return;
  switch (block.type) {
    case 'rich_text':
      if (Array.isArray(block.elements)) walkRichTextElements(block.elements, parts);
      break;
    case 'section': {
      if (block.text && (block.text.type === 'mrkdwn' || block.text.type === 'plain_text')) {
        pushIfNonEmpty(parts, block.text.text);
      }
      if (Array.isArray(block.fields)) {
        for (const f of block.fields) {
          if (f && (f.type === 'mrkdwn' || f.type === 'plain_text')) {
            pushIfNonEmpty(parts, f.text);
          }
        }
      }
      break;
    }
    case 'header':
      if (block.text) pushIfNonEmpty(parts, block.text.text);
      break;
    case 'context':
      if (Array.isArray(block.elements)) {
        for (const el of block.elements) {
          if (!el) continue;
          if (el.type === 'mrkdwn' || el.type === 'plain_text') pushIfNonEmpty(parts, el.text);
          else if (el.type === 'image') pushIfNonEmpty(parts, el.alt_text);
        }
      }
      break;
    default:
      // Unknown block type — skip silently (log at debug for visibility).
      logger.debug('extractSlackMessageText: unknown block type', { type: block.type });
  }
}

export interface ExtractedSlackMessage {
  combined: string;
  raw: string;
}

export function extractSlackMessageText(
  msg: { text?: string; attachments?: any[]; blocks?: any[]; channel?: string } | null | undefined,
): ExtractedSlackMessage {
  const raw = (msg && typeof msg === 'object' && typeof msg.text === 'string') ? msg.text : '';
  if (!msg || typeof msg !== 'object') return { combined: '', raw: '' };

  const parts: string[] = [];
  pushIfNonEmpty(parts, raw);

  if (Array.isArray(msg.attachments)) {
    for (const att of msg.attachments) {
      if (!att || typeof att !== 'object') continue;
      pushIfNonEmpty(parts, att.pretext);
      pushIfNonEmpty(parts, att.title);
      pushIfNonEmpty(parts, att.text);
      // fallback usually duplicates text; only emit if different
      if (typeof att.fallback === 'string' && att.fallback.trim() && att.fallback !== att.text) {
        pushIfNonEmpty(parts, att.fallback);
      }
      if (Array.isArray(att.actions)) {
        for (const action of att.actions) {
          if (!action || typeof action !== 'object') continue;
          if (typeof action.url === 'string' && action.url) {
            const label = typeof action.text === 'string' && action.text ? action.text : 'link';
            pushIfNonEmpty(parts, `[${label}] ${action.url}`);
          }
        }
      }
    }
  }

  // Block Kit fallback: Slack mirrors msg.blocks into msg.text for most apps,
  // so walking blocks when text is present would double-count. Only walk
  // blocks when text is empty (Block-Kit-only senders).
  if (!raw.trim() && Array.isArray(msg.blocks)) {
    for (const b of msg.blocks) extractFromBlock(b, parts);
  }

  let combined = parts.join('\n\n').trim();

  if (combined.length > MAX_LEN) {
    const originalLen = combined.length;
    combined = combined.slice(0, MAX_LEN) + TRUNCATION_MARKER;
    logger.warn('extractSlackMessageText: truncated oversized Slack message', {
      channelId: msg.channel,
      originalLen,
    });
  }

  return { combined, raw };
}
