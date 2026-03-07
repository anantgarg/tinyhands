import { v4 as uuid } from 'uuid';
import { getDb } from '../../db';
import { enqueueRun, isDuplicateEvent } from '../../queue';
import { canModifyAgent } from '../access-control';
import type { Trigger, TriggerType, TriggerStatus, JobData } from '../../types';
import { logger } from '../../utils/logger';

// ── Trigger Management ──

export interface CreateTriggerParams {
  agentId: string;
  triggerType: TriggerType;
  config: Record<string, any>;
  createdBy: string;
}

export function createTrigger(params: CreateTriggerParams): Trigger {
  if (!canModifyAgent(params.agentId, params.createdBy)) {
    throw new Error('Insufficient permissions to create trigger');
  }

  const db = getDb();
  const id = uuid();

  const trigger: Trigger = {
    id,
    agent_id: params.agentId,
    trigger_type: params.triggerType,
    config_json: JSON.stringify(params.config),
    status: 'active',
    created_by: params.createdBy,
    created_at: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO triggers (id, agent_id, trigger_type, config_json, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(trigger.id, trigger.agent_id, trigger.trigger_type,
    trigger.config_json, trigger.status, trigger.created_by, trigger.created_at);

  logger.info('Trigger created', { triggerId: id, agentId: params.agentId, type: params.triggerType });
  return trigger;
}

export function getTrigger(id: string): Trigger | null {
  const db = getDb();
  return db.prepare('SELECT * FROM triggers WHERE id = ?').get(id) as Trigger | null;
}

export function getAgentTriggers(agentId: string): Trigger[] {
  const db = getDb();
  return db.prepare('SELECT * FROM triggers WHERE agent_id = ?').all(agentId) as Trigger[];
}

export function getActiveTriggersByType(triggerType: TriggerType): Trigger[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM triggers WHERE trigger_type = ? AND status = ?'
  ).all(triggerType, 'active') as Trigger[];
}

export function pauseTrigger(triggerId: string, userId: string): void {
  const trigger = getTrigger(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);
  if (!canModifyAgent(trigger.agent_id, userId)) {
    throw new Error('Insufficient permissions');
  }

  const db = getDb();
  db.prepare('UPDATE triggers SET status = ? WHERE id = ?').run('paused', triggerId);
  logger.info('Trigger paused', { triggerId });
}

export function resumeTrigger(triggerId: string, userId: string): void {
  const trigger = getTrigger(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);
  if (!canModifyAgent(trigger.agent_id, userId)) {
    throw new Error('Insufficient permissions');
  }

  const db = getDb();
  db.prepare('UPDATE triggers SET status = ? WHERE id = ?').run('active', triggerId);
  logger.info('Trigger resumed', { triggerId });
}

export function deleteTrigger(triggerId: string, userId: string): void {
  const trigger = getTrigger(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);
  if (!canModifyAgent(trigger.agent_id, userId)) {
    throw new Error('Insufficient permissions');
  }

  const db = getDb();
  db.prepare('DELETE FROM triggers WHERE id = ?').run(triggerId);
  logger.info('Trigger deleted', { triggerId });
}

// ── Trigger Firing ──

export interface TriggerEvent {
  triggerId: string;
  idempotencyKey: string;
  payload: Record<string, any>;
  sourceChannel?: string;
  sourceThreadTs?: string;
}

export async function fireTrigger(event: TriggerEvent): Promise<string | null> {
  const trigger = getTrigger(event.triggerId);
  if (!trigger || trigger.status !== 'active') return null;

  // Dedup check
  const isDuplicate = await isDuplicateEvent(event.idempotencyKey);
  if (isDuplicate) {
    logger.info('Duplicate event dropped', { triggerId: event.triggerId, key: event.idempotencyKey });
    return null;
  }

  // Normalize payload into task prompt
  const taskPrompt = normalizeEventPayload(trigger.trigger_type, event.payload);
  const traceId = uuid();

  const jobData: JobData = {
    agentId: trigger.agent_id,
    channelId: event.sourceChannel || '',
    threadTs: event.sourceThreadTs || '',
    input: taskPrompt,
    userId: null,
    traceId,
    triggerId: trigger.id,
  };

  await enqueueRun(jobData, 'normal');

  logger.info('Trigger fired', {
    triggerId: event.triggerId,
    traceId,
    type: trigger.trigger_type,
  });

  return traceId;
}

function normalizeEventPayload(triggerType: TriggerType, payload: Record<string, any>): string {
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

// ── Trigger Storm Detection ──

const STORM_THRESHOLD = 100; // events per minute

export async function checkTriggerStorm(agentId: string): Promise<boolean> {
  // In production, this would check Redis for event count per minute
  // For now, return false (no storm detected)
  return false;
}

// ── Slack Channel Trigger Matching ──

export function findSlackChannelTriggers(channelId: string): Trigger[] {
  const triggers = getActiveTriggersByType('slack_channel');
  return triggers.filter(t => {
    const config = JSON.parse(t.config_json);
    return config.channel_id === channelId;
  });
}
