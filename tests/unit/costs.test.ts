import { describe, it, expect } from 'vitest';
import { estimateCost, getModelId } from '../../src/utils/costs';

describe('Cost Calculator', () => {
  it('should calculate sonnet costs correctly', () => {
    const cost = estimateCost('sonnet', 1000, 500);
    // (1000/1000) * 0.003 + (500/1000) * 0.015 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105);
  });

  it('should calculate opus costs correctly', () => {
    const cost = estimateCost('opus', 1000, 1000);
    // (1000/1000) * 0.015 + (1000/1000) * 0.075 = 0.015 + 0.075 = 0.09
    expect(cost).toBeCloseTo(0.09);
  });

  it('should calculate haiku costs correctly', () => {
    const cost = estimateCost('haiku', 10000, 5000);
    // (10000/1000) * 0.00025 + (5000/1000) * 0.00125 = 0.0025 + 0.00625 = 0.00875
    expect(cost).toBeCloseTo(0.00875);
  });

  it('should return zero cost for zero tokens', () => {
    expect(estimateCost('sonnet', 0, 0)).toBe(0);
  });
});

describe('Model IDs', () => {
  it('should return correct model IDs', () => {
    expect(getModelId('opus')).toBe('claude-opus-4-6');
    expect(getModelId('sonnet')).toBe('claude-sonnet-4-6');
    expect(getModelId('haiku')).toBe('claude-haiku-4-5-20251001');
  });
});
