import { getAgent, updateAgent } from '../agents';
import { canModifyAgent } from '../access-control';
import type { ModelAlias } from '../../types';
import { getModelId } from '../../utils/costs';
import { logger } from '../../utils/logger';

const VALID_MODELS: ModelAlias[] = ['opus', 'sonnet', 'haiku'];

const MODEL_INFO: Record<ModelAlias, { name: string; bestFor: string; warning?: string }> = {
  opus: {
    name: 'Claude Opus 4.6',
    bestFor: 'Complex reasoning, deep analysis',
  },
  sonnet: {
    name: 'Claude Sonnet 4.6',
    bestFor: 'General purpose (default)',
  },
  haiku: {
    name: 'Claude Haiku 4.5',
    bestFor: 'High-volume, triage, routing',
    warning: 'No thinking traces available with Haiku',
  },
};

export async function setAgentModel(
  agentId: string,
  model: ModelAlias,
  userId: string
): Promise<{ model: ModelAlias; warning?: string }> {
  if (!(await canModifyAgent(agentId, userId))) {
    throw new Error('Insufficient permissions to change agent model');
  }

  if (!VALID_MODELS.includes(model)) {
    throw new Error(`Invalid model: ${model}. Valid options: ${VALID_MODELS.join(', ')}`);
  }

  await updateAgent(agentId, { model }, userId);
  logger.info('Agent model changed', { agentId, model, userId });

  const info = MODEL_INFO[model];
  return {
    model,
    warning: info.warning,
  };
}

export async function getAgentModel(agentId: string): Promise<{
  model: ModelAlias;
  modelId: string;
  info: typeof MODEL_INFO[ModelAlias];
}> {
  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  return {
    model: agent.model,
    modelId: getModelId(agent.model),
    info: MODEL_INFO[agent.model],
  };
}

export function parseModelOverride(message: string): ModelAlias | null {
  const patterns: Array<{ pattern: RegExp; model: ModelAlias }> = [
    { pattern: /\[run with opus\]/i, model: 'opus' },
    { pattern: /\[run with sonnet\]/i, model: 'sonnet' },
    { pattern: /\[run with haiku\]/i, model: 'haiku' },
    { pattern: /\[use opus\]/i, model: 'opus' },
    { pattern: /\[use sonnet\]/i, model: 'sonnet' },
    { pattern: /\[use haiku\]/i, model: 'haiku' },
  ];

  for (const { pattern, model } of patterns) {
    if (pattern.test(message)) return model;
  }

  return null;
}

export function stripModelOverride(message: string): string {
  return message
    .replace(/\[run with (opus|sonnet|haiku)\]/gi, '')
    .replace(/\[use (opus|sonnet|haiku)\]/gi, '')
    .trim();
}

export function getModelSummary(): Array<{
  alias: ModelAlias;
  modelId: string;
  bestFor: string;
  warning?: string;
}> {
  return VALID_MODELS.map(alias => ({
    alias,
    modelId: getModelId(alias),
    bestFor: MODEL_INFO[alias].bestFor,
    warning: MODEL_INFO[alias].warning,
  }));
}
