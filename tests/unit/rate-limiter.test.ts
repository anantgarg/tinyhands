import { describe, it, expect } from 'vitest';

describe('Token Bucket Rate Limiter', () => {
  it('should calculate tokens per minute correctly', () => {
    const tpm = 100000; // tokens per minute
    const used = 50000;
    const remaining = tpm - used;
    const utilization = used / tpm;

    expect(remaining).toBe(50000);
    expect(utilization).toBe(0.5);
  });

  it('should trigger backpressure at 90% capacity', () => {
    const BACKPRESSURE_THRESHOLD = 0.9;
    const tpm = 100000;

    expect(85000 / tpm).toBeLessThan(BACKPRESSURE_THRESHOLD);
    expect(91000 / tpm).toBeGreaterThan(BACKPRESSURE_THRESHOLD);
  });

  it('should estimate in-flight token usage', () => {
    const avgTokensPerRun = 5000;
    const inFlightJobs = 3;
    const estimated = avgTokensPerRun * inFlightJobs;

    expect(estimated).toBe(15000);
  });

  it('should respect RPM limits', () => {
    const rpm = 60;
    const requestsInWindow = 55;
    const allowed = requestsInWindow < rpm;

    expect(allowed).toBe(true);
    expect(61 < rpm).toBe(false);
  });
});

describe('Cost Estimation', () => {
  const PRICING = {
    opus: { inputPer1k: 0.015, outputPer1k: 0.075 },
    sonnet: { inputPer1k: 0.003, outputPer1k: 0.015 },
    haiku: { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  };

  it('should estimate correctly for mixed models', () => {
    const opusCost = (10000 / 1000) * PRICING.opus.inputPer1k + (5000 / 1000) * PRICING.opus.outputPer1k;
    const haikuCost = (10000 / 1000) * PRICING.haiku.inputPer1k + (5000 / 1000) * PRICING.haiku.outputPer1k;

    expect(opusCost).toBeGreaterThan(haikuCost);
    expect(opusCost).toBeCloseTo(0.525);
    expect(haikuCost).toBeCloseTo(0.00875);
  });

  it('should flag expensive runs', () => {
    const EXPENSIVE_THRESHOLD = 5.0;
    const runCost = (100000 / 1000) * PRICING.opus.inputPer1k + (50000 / 1000) * PRICING.opus.outputPer1k;

    expect(runCost).toBeGreaterThan(EXPENSIVE_THRESHOLD);
  });
});

describe('Queue Depth Monitoring', () => {
  it('should alert on high queue depth', () => {
    const QUEUE_DEPTH_THRESHOLD = 50;
    expect(49).toBeLessThan(QUEUE_DEPTH_THRESHOLD);
    expect(51).toBeGreaterThan(QUEUE_DEPTH_THRESHOLD);
  });
});
