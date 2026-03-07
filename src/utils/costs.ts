import type { ModelAlias } from '../types';

const PRICING: Record<ModelAlias, { inputPer1k: number; outputPer1k: number }> = {
  opus: { inputPer1k: 0.015, outputPer1k: 0.075 },
  sonnet: { inputPer1k: 0.003, outputPer1k: 0.015 },
  haiku: { inputPer1k: 0.00025, outputPer1k: 0.00125 },
};

export function estimateCost(
  model: ModelAlias,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PRICING[model];
  return (inputTokens / 1000) * pricing.inputPer1k + (outputTokens / 1000) * pricing.outputPer1k;
}

export function getModelId(alias: ModelAlias): string {
  const MODEL_IDS: Record<ModelAlias, string> = {
    opus: 'claude-opus-4-6',
    sonnet: 'claude-sonnet-4-6',
    haiku: 'claude-haiku-4-5-20251001',
  };
  return MODEL_IDS[alias];
}
