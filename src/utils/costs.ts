import type { ModelAlias } from '../types';

const PRICING: Record<ModelAlias, { inputPer1k: number; outputPer1k: number }> = {
  opus: { inputPer1k: 0.015, outputPer1k: 0.075 },
  sonnet: { inputPer1k: 0.003, outputPer1k: 0.015 },
  haiku: { inputPer1k: 0.00025, outputPer1k: 0.00125 },
};

const MODEL_IDS: Record<ModelAlias, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

export function resolveAlias(model: string): ModelAlias {
  if (model in PRICING) return model as ModelAlias;
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return 'sonnet';
}

export function estimateCost(
  model: ModelAlias | string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PRICING[resolveAlias(model)];
  return (inputTokens / 1000) * pricing.inputPer1k + (outputTokens / 1000) * pricing.outputPer1k;
}

export function getModelId(alias: ModelAlias | string): string {
  // If already a full model ID (contains 'claude-'), return as-is
  if (alias.startsWith('claude-')) return alias;
  return MODEL_IDS[alias as ModelAlias] || MODEL_IDS.sonnet;
}
