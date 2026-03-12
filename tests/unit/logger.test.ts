import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config', () => ({
  config: { observability: { logLevel: 'info' } },
}));

import { logger, logRunEvent } from '../../src/utils/logger';

describe('logger', () => {
  it('should be a winston logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should have the configured log level', () => {
    expect(logger.level).toBe('info');
  });
});

describe('logRunEvent', () => {
  it('should call logger.info with run_event', () => {
    const spy = vi.spyOn(logger, 'info');
    const event = { runId: 'r1', agentId: 'a1', event: 'started' } as any;
    logRunEvent(event);
    expect(spy).toHaveBeenCalledWith('run_event', expect.objectContaining({ runId: 'r1' }));
    spy.mockRestore();
  });
});
