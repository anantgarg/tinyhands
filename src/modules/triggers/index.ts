import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
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

export async function createTrigger(params: CreateTriggerParams): Promise<Trigger> {
  if (!(await canModifyAgent(params.agentId, params.createdBy))) {
    throw new Error('Insufficient permissions to create trigger');
  }

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

  await execute(`
    INSERT INTO triggers (id, agent_id, trigger_type, config_json, status, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [trigger.id, trigger.agent_id, trigger.trigger_type,
    trigger.config_json, trigger.status, trigger.created_by, trigger.created_at]);

  logger.info('Trigger created', { triggerId: id, agentId: params.agentId, type: params.triggerType });
  return trigger;
}

export async function getTrigger(id: string): Promise<Trigger | null> {
  const row = await queryOne<Trigger>('SELECT * FROM triggers WHERE id = $1', [id]);
  return row || null;
}

export async function getAgentTriggers(agentId: string): Promise<Trigger[]> {
  return query<Trigger>('SELECT * FROM triggers WHERE agent_id = $1', [agentId]);
}

export async function getActiveTriggersByType(triggerType: TriggerType): Promise<Trigger[]> {
  return query<Trigger>(
    'SELECT * FROM triggers WHERE trigger_type = $1 AND status = $2',
    [triggerType, 'active']
  );
}

export async function pauseTrigger(triggerId: string, userId: string): Promise<void> {
  const trigger = await getTrigger(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);
  if (!(await canModifyAgent(trigger.agent_id, userId))) {
    throw new Error('Insufficient permissions');
  }

  await execute('UPDATE triggers SET status = $1 WHERE id = $2', ['paused', triggerId]);
  logger.info('Trigger paused', { triggerId });
}

export async function resumeTrigger(triggerId: string, userId: string): Promise<void> {
  const trigger = await getTrigger(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);
  if (!(await canModifyAgent(trigger.agent_id, userId))) {
    throw new Error('Insufficient permissions');
  }

  await execute('UPDATE triggers SET status = $1 WHERE id = $2', ['active', triggerId]);
  logger.info('Trigger resumed', { triggerId });
}

export async function deleteTrigger(triggerId: string, userId: string): Promise<void> {
  const trigger = await getTrigger(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);
  if (!(await canModifyAgent(trigger.agent_id, userId))) {
    throw new Error('Insufficient permissions');
  }

  await execute('DELETE FROM triggers WHERE id = $1', [triggerId]);
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
  const trigger = await getTrigger(event.triggerId);
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

    case 'schedule':
      return `Scheduled execution triggered at ${payload.firedAt || new Date().toISOString()}`;

    default:
      return JSON.stringify(payload);
  }
}

// ── Schedule Trigger Helpers ──

export async function getScheduledTriggersDue(): Promise<Trigger[]> {
  return query<Trigger>(
    `SELECT * FROM triggers WHERE trigger_type = 'schedule' AND status = 'active'`,
    []
  );
}

export async function updateTriggerLastFired(triggerId: string): Promise<void> {
  await execute('UPDATE triggers SET last_fired_at = NOW() WHERE id = $1', [triggerId]);
}

export async function getTriggerLastFiredAt(triggerId: string): Promise<Date | null> {
  const row = await queryOne<{ last_fired_at: string | null }>(
    'SELECT last_fired_at FROM triggers WHERE id = $1',
    [triggerId]
  );
  return row?.last_fired_at ? new Date(row.last_fired_at) : null;
}

// ── Trigger Storm Detection ──

const STORM_THRESHOLD = 100; // events per minute

export async function checkTriggerStorm(agentId: string): Promise<boolean> {
  return false;
}

// ── Slack Channel Trigger Matching ──

export async function findSlackChannelTriggers(channelId: string): Promise<Trigger[]> {
  const triggers = await getActiveTriggersByType('slack_channel');
  return triggers.filter(t => {
    const config = JSON.parse(t.config_json);
    return config.channel_id === channelId;
  });
}
