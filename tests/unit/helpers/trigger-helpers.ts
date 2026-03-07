import type { TriggerType } from '../../../src/types';

// Extracted from src/modules/triggers/index.ts for unit testing without DB
export function normalizeEventPayload(triggerType: TriggerType, payload: Record<string, any>): string {
  switch (triggerType) {
    case 'slack_channel':
      return `New message in channel: "${payload.text || ''}"` +
        (payload.user ? ` from <@${payload.user}>` : '');

    case 'linear':
      return `Linear event: ${payload.action || 'update'} on ${payload.type || 'issue'}` +
        (payload.data?.title ? `: "${payload.data.title}"` : '') +
        (payload.data?.description ? `\n\nDescription: ${payload.data.description}` : '');

    case 'zendesk':
    case 'intercom':
      return `Support ticket ${payload.action || 'update'}: "${payload.subject || payload.title || ''}"` +
        (payload.description ? `\n\n${payload.description}` : '');

    case 'webhook':
      return `Webhook event received:\n\n${JSON.stringify(payload, null, 2)}`;

    default:
      return JSON.stringify(payload);
  }
}
