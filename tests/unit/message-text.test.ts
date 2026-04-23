import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { extractSlackMessageText } from '../../src/slack/message-text';
import { logger } from '../../src/utils/logger';

describe('extractSlackMessageText', () => {
  it('returns empty combined and raw for null/undefined/empty input', () => {
    expect(extractSlackMessageText(null)).toEqual({ combined: '', raw: '' });
    expect(extractSlackMessageText(undefined)).toEqual({ combined: '', raw: '' });
    expect(extractSlackMessageText({})).toEqual({ combined: '', raw: '' });
  });

  it('echoes msg.text when only text is present', () => {
    const out = extractSlackMessageText({ text: 'hello world' });
    expect(out.combined).toBe('hello world');
    expect(out.raw).toBe('hello world');
  });

  it('extracts HubSpot-style attachment text (email only in attachments[0].text)', () => {
    const msg = {
      text: '🚀 Heads up, team! We have a new prospect engaging.',
      attachments: [
        {
          fallback: '*Email*: stefan.silion@mannah.it\n*Vertical*: SaaS',
          text: '*Email*: stefan.silion@mannah.it\n*Vertical*: SaaS',
          title: 'New Prospect',
          actions: [
            { type: 'button', text: 'View contact in HubSpot', url: 'https://app.hubspot.com/contacts/1/contact/42' },
          ],
        },
      ],
    };
    const { combined, raw } = extractSlackMessageText(msg);
    expect(raw).toBe(msg.text);
    expect(combined).toContain('🚀 Heads up, team!');
    expect(combined).toContain('New Prospect');
    expect(combined).toContain('stefan.silion@mannah.it');
    expect(combined).toContain('SaaS');
    expect(combined).toContain('https://app.hubspot.com/contacts/1/contact/42');
    expect(combined).toContain('[View contact in HubSpot]');
  });

  it('skips attachment.fallback when it equals attachment.text (intra-attachment dedup)', () => {
    const msg = {
      text: 'header',
      attachments: [{ text: 'body', fallback: 'body' }],
    };
    const { combined } = extractSlackMessageText(msg);
    expect(combined.match(/body/g)).toHaveLength(1);
  });

  it('keeps attachment.fallback when it differs from attachment.text', () => {
    const msg = {
      text: 'header',
      attachments: [{ text: '*Email*: foo@bar.com', fallback: 'Email: foo@bar.com' }],
    };
    const { combined } = extractSlackMessageText(msg);
    expect(combined).toContain('*Email*: foo@bar.com');
    expect(combined).toContain('Email: foo@bar.com');
  });

  it('does NOT walk top-level blocks when msg.text is non-empty (text mirrors blocks)', () => {
    const msg = {
      text: 'body from text field',
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'body from text field' },
        },
      ],
    };
    const { combined } = extractSlackMessageText(msg);
    // Only one occurrence — not double-counted
    expect(combined.match(/body from text field/g)).toHaveLength(1);
  });

  it('walks Block Kit blocks as a fallback when msg.text is empty', () => {
    const msg = {
      text: '',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Ticket opened' } },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '*Priority:* high' },
          fields: [
            { type: 'mrkdwn', text: '*Assignee:* Alice' },
            { type: 'mrkdwn', text: '*Status:* open' },
          ],
        },
        { type: 'context', elements: [{ type: 'mrkdwn', text: 'Opened 2 min ago' }] },
      ],
    };
    const { combined } = extractSlackMessageText(msg);
    expect(combined).toContain('Ticket opened');
    expect(combined).toContain('Priority:');
    expect(combined).toContain('*Assignee:* Alice');
    expect(combined).toContain('Opened 2 min ago');
  });

  it('extracts rich_text blocks with links when text is empty', () => {
    const msg = {
      text: '',
      blocks: [
        {
          type: 'rich_text',
          elements: [
            {
              type: 'rich_text_section',
              elements: [
                { type: 'text', text: 'Check out' },
                { type: 'link', url: 'https://acme.com', text: 'acme' },
              ],
            },
          ],
        },
      ],
    };
    const { combined } = extractSlackMessageText(msg);
    expect(combined).toContain('Check out');
    expect(combined).toContain('https://acme.com');
    expect(combined).toContain('acme');
  });

  it('preserves mention-bearing raw text (combined == raw when no attachments/blocks)', () => {
    const { combined, raw } = extractSlackMessageText({ text: '<@UBOT> do a thing' });
    expect(combined).toBe(raw);
    expect(raw.includes('<@UBOT>')).toBe(true);
  });

  it('truncates oversized input to MAX_LEN + marker and logs a warning', () => {
    const huge = 'x'.repeat(60_000);
    const msg = { channel: 'C999', attachments: [{ text: huge }] };
    const { combined } = extractSlackMessageText(msg);
    expect(combined.endsWith('…[truncated]')).toBe(true);
    expect(combined.length).toBeLessThanOrEqual(50_000 + '…[truncated]'.length);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('truncated'),
      expect.objectContaining({ channelId: 'C999' }),
    );
  });

  it('handles unknown block types without throwing', () => {
    const msg = {
      text: '',
      blocks: [
        { type: 'divider' },
        { type: 'image', image_url: 'x', alt_text: 'pic' },
        { type: 'header', text: { type: 'plain_text', text: 'still here' } },
      ],
    };
    expect(() => extractSlackMessageText(msg)).not.toThrow();
    const { combined } = extractSlackMessageText(msg);
    expect(combined).toContain('still here');
  });

  it('skips attachment actions that have no URL', () => {
    const msg = {
      text: 'hi',
      attachments: [
        {
          actions: [
            { type: 'button', name: 'ack', value: 'x' },
            { type: 'button', text: 'Open', url: 'https://example.com' },
          ],
        },
      ],
    };
    const { combined } = extractSlackMessageText(msg);
    expect(combined).toContain('https://example.com');
    expect(combined).not.toContain('ack');
  });
});
