import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_WORKSPACE_ID = 'W_TEST_123';

// ── Mock setup ──
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockWithTransaction = vi.fn();
const mockCanModifyAgent = vi.fn();
const mockEnqueueRun = vi.fn();
const mockIsDuplicateEvent = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
  withTransaction: (fn: any) => mockWithTransaction(fn),
}));

vi.mock('../../src/modules/access-control', () => ({
  canModifyAgent: (...args: any[]) => mockCanModifyAgent(...args),
}));

vi.mock('../../src/queue', () => ({
  enqueueRun: (...args: any[]) => mockEnqueueRun(...args),
  isDuplicateEvent: (...args: any[]) => mockIsDuplicateEvent(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

import {
  createTrigger,
  getTrigger,
  getAgentTriggers,
  getActiveTriggersByType,
  pauseTrigger,
  resumeTrigger,
  deleteTrigger,
  fireTrigger,
  checkTriggerStorm,
  findSlackChannelTriggers,
  getScheduledTriggersDue,
  updateTriggerLastFired,
  getTriggerLastFiredAt,
} from '../../src/modules/triggers/index';

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════
// Trigger CRUD
// ═══════════════════════════════════════════════════

describe('createTrigger', () => {
  it('should create a trigger when user has permissions', async () => {
    mockCanModifyAgent.mockResolvedValue(true);

    const result = await createTrigger(TEST_WORKSPACE_ID, {
      agentId: 'agent-1',
      triggerType: 'slack_channel' as any,
      config: { channel_id: 'C123' },
      createdBy: 'user1',
    });

    expect(result.id).toBe('test-uuid-1234');
    expect(result.agent_id).toBe('agent-1');
    expect(result.trigger_type).toBe('slack_channel');
    expect(result.config_json).toBe(JSON.stringify({ channel_id: 'C123' }));
    expect(result.status).toBe('active');
    expect(result.created_by).toBe('user1');
    expect(result.created_at).toBeDefined();
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO triggers'),
      expect.arrayContaining(['test-uuid-1234', 'agent-1', 'slack_channel']),
    );
  });

  it('should throw when user lacks permissions', async () => {
    mockCanModifyAgent.mockResolvedValue(false);

    await expect(
      createTrigger(TEST_WORKSPACE_ID, {
        agentId: 'agent-1',
        triggerType: 'webhook' as any,
        config: {},
        createdBy: 'unauthorized-user',
      }),
    ).rejects.toThrow('Insufficient permissions to create trigger');

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('should check permissions with correct agentId and userId', async () => {
    mockCanModifyAgent.mockResolvedValue(true);

    await createTrigger(TEST_WORKSPACE_ID, {
      agentId: 'agent-99',
      triggerType: 'linear' as any,
      config: {},
      createdBy: 'user-42',
    });

    expect(mockCanModifyAgent).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'agent-99', 'user-42');
  });

  it('should serialize complex config to JSON', async () => {
    mockCanModifyAgent.mockResolvedValue(true);

    const config = { channel_id: 'C123', keywords: ['urgent', 'help'], filterBots: true };
    const result = await createTrigger(TEST_WORKSPACE_ID, {
      agentId: 'agent-1',
      triggerType: 'slack_channel' as any,
      config,
      createdBy: 'user1',
    });

    expect(result.config_json).toBe(JSON.stringify(config));
  });
});

describe('getTrigger', () => {
  it('should return a trigger by id', async () => {
    const trigger = { id: 't1', agent_id: 'a1', trigger_type: 'webhook', status: 'active' };
    mockQueryOne.mockResolvedValue(trigger);

    const result = await getTrigger(TEST_WORKSPACE_ID, 't1');
    expect(result).toEqual(trigger);
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM triggers WHERE id = $1'),
      expect.arrayContaining(['t1']),
    );
  });

  it('should return null when trigger does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);
    const result = await getTrigger(TEST_WORKSPACE_ID, 'nonexistent');
    expect(result).toBeNull();
  });

  it('should return null for undefined queryOne result', async () => {
    mockQueryOne.mockResolvedValue(undefined);
    const result = await getTrigger(TEST_WORKSPACE_ID, 'nope');
    expect(result).toBeNull();
  });
});

describe('getAgentTriggers', () => {
  it('should return all triggers for an agent', async () => {
    const triggers = [
      { id: 't1', agent_id: 'a1', trigger_type: 'slack_channel' },
      { id: 't2', agent_id: 'a1', trigger_type: 'webhook' },
    ];
    mockQuery.mockResolvedValue(triggers);

    const result = await getAgentTriggers(TEST_WORKSPACE_ID, 'a1');
    expect(result).toEqual(triggers);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM triggers WHERE agent_id = $1'),
      expect.arrayContaining(['a1']),
    );
  });

  it('should return empty array when agent has no triggers', async () => {
    mockQuery.mockResolvedValue([]);
    const result = await getAgentTriggers(TEST_WORKSPACE_ID, 'agent-no-triggers');
    expect(result).toEqual([]);
  });
});

describe('getActiveTriggersByType', () => {
  it('should return only active triggers of specified type', async () => {
    const triggers = [{ id: 't1', trigger_type: 'webhook', status: 'active' }];
    mockQuery.mockResolvedValue(triggers);

    const result = await getActiveTriggersByType(TEST_WORKSPACE_ID, 'webhook' as any);
    expect(result).toEqual(triggers);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM triggers WHERE trigger_type = $1'),
      expect.arrayContaining(['webhook', 'active']),
    );
  });
});

// ═══════════════════════════════════════════════════
// Trigger Status Changes (Pause / Resume / Delete)
// ═══════════════════════════════════════════════════

describe('pauseTrigger', () => {
  it('should pause a trigger when user has permissions', async () => {
    const trigger = { id: 't1', agent_id: 'a1', status: 'active' };
    mockQueryOne.mockResolvedValue(trigger);
    mockCanModifyAgent.mockResolvedValue(true);

    await pauseTrigger(TEST_WORKSPACE_ID, 't1', 'user1');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE triggers SET status = $1'),
      expect.arrayContaining(['paused', 't1']),
    );
  });

  it('should throw when trigger does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);

    await expect(pauseTrigger(TEST_WORKSPACE_ID, 'nonexistent', 'user1'))
      .rejects.toThrow('Trigger nonexistent not found');
  });

  it('should throw when user lacks permissions', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1', agent_id: 'a1' });
    mockCanModifyAgent.mockResolvedValue(false);

    await expect(pauseTrigger(TEST_WORKSPACE_ID, 't1', 'unauthorized'))
      .rejects.toThrow('Insufficient permissions');

    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('resumeTrigger', () => {
  it('should resume a trigger when user has permissions', async () => {
    const trigger = { id: 't1', agent_id: 'a1', status: 'paused' };
    mockQueryOne.mockResolvedValue(trigger);
    mockCanModifyAgent.mockResolvedValue(true);

    await resumeTrigger(TEST_WORKSPACE_ID, 't1', 'user1');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE triggers SET status = $1'),
      expect.arrayContaining(['active', 't1']),
    );
  });

  it('should throw when trigger does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);

    await expect(resumeTrigger(TEST_WORKSPACE_ID, 'nonexistent', 'user1'))
      .rejects.toThrow('Trigger nonexistent not found');
  });

  it('should throw when user lacks permissions', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1', agent_id: 'a1' });
    mockCanModifyAgent.mockResolvedValue(false);

    await expect(resumeTrigger(TEST_WORKSPACE_ID, 't1', 'unauthorized'))
      .rejects.toThrow('Insufficient permissions');

    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('deleteTrigger', () => {
  it('should delete a trigger when user has permissions', async () => {
    const trigger = { id: 't1', agent_id: 'a1', status: 'active' };
    mockQueryOne.mockResolvedValue(trigger);
    mockCanModifyAgent.mockResolvedValue(true);

    await deleteTrigger(TEST_WORKSPACE_ID, 't1', 'user1');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM triggers WHERE id = $1'),
      expect.arrayContaining(['t1']),
    );
  });

  it('should throw when trigger does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);

    await expect(deleteTrigger(TEST_WORKSPACE_ID, 'nonexistent', 'user1'))
      .rejects.toThrow('Trigger nonexistent not found');
  });

  it('should throw when user lacks permissions', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1', agent_id: 'a1' });
    mockCanModifyAgent.mockResolvedValue(false);

    await expect(deleteTrigger(TEST_WORKSPACE_ID, 't1', 'unauthorized'))
      .rejects.toThrow('Insufficient permissions');

    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════
// Trigger Firing
// ═══════════════════════════════════════════════════

describe('fireTrigger', () => {
  const makeEvent = (overrides = {}): any => ({
    triggerId: 't1',
    idempotencyKey: 'key-123',
    payload: { text: 'Hello' },
    sourceChannel: 'C123',
    sourceThreadTs: '123.456',
    ...overrides,
  });

  it('should fire trigger, enqueue job, and return traceId', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'agent-1',
      trigger_type: 'slack_channel',
      config_json: '{}',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    const result = await fireTrigger(TEST_WORKSPACE_ID, makeEvent());

    expect(result).toBe('test-uuid-1234'); // traceId from uuid mock
    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: TEST_WORKSPACE_ID,
        agentId: 'agent-1',
        channelId: 'C123',
        threadTs: '123.456',
        triggerId: 't1',
        traceId: 'test-uuid-1234',
      }),
      'normal',
    );
  });

  it('should return null when trigger does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);

    const result = await fireTrigger(TEST_WORKSPACE_ID, makeEvent());
    expect(result).toBeNull();
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('should return null when trigger is paused', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1', status: 'paused' });

    const result = await fireTrigger(TEST_WORKSPACE_ID, makeEvent());
    expect(result).toBeNull();
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('should return null for duplicate events', async () => {
    mockQueryOne.mockResolvedValue({
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'webhook',
      status: 'active',
    });
    mockIsDuplicateEvent.mockResolvedValue(true);

    const result = await fireTrigger(TEST_WORKSPACE_ID, makeEvent());
    expect(result).toBeNull();
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('should normalize slack_channel payload', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'slack_channel',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({ payload: { text: 'Help me', user: 'U456' } }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toContain('Help me');
    expect(jobData.input).toContain('<@U456>');
  });

  it('should normalize slack_channel payload without user or text', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'slack_channel',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({ payload: {} }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toBe('New message in channel: ""');
    expect(jobData.input).not.toContain('from');
  });

  it('should normalize linear payload', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'linear',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({
      payload: {
        action: 'create',
        type: 'issue',
        data: { title: 'Bug Report', description: 'Something broke' },
      },
    }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toContain('Linear event');
    expect(jobData.input).toContain('create');
    expect(jobData.input).toContain('Bug Report');
    expect(jobData.input).toContain('Something broke');
  });

  it('should normalize linear payload with defaults when fields are missing', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'linear',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({ payload: {} }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toContain('Linear event: update on issue');
    expect(jobData.input).not.toContain('Description:');
  });

  it('should normalize zendesk payload', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'zendesk',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({
      payload: { action: 'created', subject: 'Login issue', description: 'Cannot sign in' },
    }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toContain('Support ticket');
    expect(jobData.input).toContain('Login issue');
    expect(jobData.input).toContain('Cannot sign in');
  });

  it('should normalize zendesk payload with defaults when fields are missing', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'zendesk',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({ payload: {} }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toContain('Support ticket update');
    expect(jobData.input).not.toContain('\n\n');
  });

  it('should normalize webhook payload as JSON', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'webhook',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({ payload: { key: 'value', num: 42 } }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toContain('Webhook event received');
    expect(jobData.input).toContain('"key"');
    expect(jobData.input).toContain('"value"');
  });

  it('should default sourceChannel and sourceThreadTs to empty strings', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'webhook',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, {
      triggerId: 't1',
      idempotencyKey: 'key-1',
      payload: { data: true },
    } as any);

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.channelId).toBe('');
    expect(jobData.threadTs).toBe('');
  });

  it('should normalize unknown trigger type as raw JSON', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'custom_unknown',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({ payload: { foo: 'bar' } }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('should normalize schedule payload', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'schedule',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({ payload: { firedAt: '2025-06-01T12:00:00Z' } }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toContain('Scheduled execution triggered at');
    expect(jobData.input).toContain('2025-06-01T12:00:00Z');
  });

  it('should normalize schedule payload without firedAt', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'schedule',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({ payload: {} }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toContain('Scheduled execution triggered at');
  });

  it('should normalize intercom payload', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'intercom',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({
      payload: { action: 'opened', title: 'Need help', description: 'I am stuck' },
    }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toContain('Support ticket');
    expect(jobData.input).toContain('Need help');
    expect(jobData.input).toContain('I am stuck');
  });

  it('should normalize zendesk payload using title when subject is missing', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'zendesk',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({
      payload: { title: 'Fallback title' },
    }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toContain('Fallback title');
  });

  it('should normalize linear payload with title but no description', async () => {
    const trigger = {
      id: 't1',
      agent_id: 'a1',
      trigger_type: 'linear',
      status: 'active',
    };
    mockQueryOne.mockResolvedValue(trigger);
    mockIsDuplicateEvent.mockResolvedValue(false);

    await fireTrigger(TEST_WORKSPACE_ID, makeEvent({
      payload: { data: { title: 'Title only' } },
    }));

    const jobData = mockEnqueueRun.mock.calls[0][0];
    expect(jobData.input).toContain('Title only');
    expect(jobData.input).not.toContain('Description');
  });
});

// ═══════════════════════════════════════════════════
// Trigger Storm Detection
// ═══════════════════════════════════════════════════

describe('checkTriggerStorm', () => {
  it('should always return false (stub)', async () => {
    const result = await checkTriggerStorm(TEST_WORKSPACE_ID, 'agent-1');
    expect(result).toBe(false);
  });

  it('should return false regardless of agentId', async () => {
    const result = await checkTriggerStorm(TEST_WORKSPACE_ID, 'any-agent');
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════
// Slack Channel Trigger Matching
// ═══════════════════════════════════════════════════

describe('findSlackChannelTriggers', () => {
  it('should return triggers matching the channel id', async () => {
    const triggers = [
      { id: 't1', trigger_type: 'slack_channel', config_json: JSON.stringify({ channel_id: 'C123' }), status: 'active' },
      { id: 't2', trigger_type: 'slack_channel', config_json: JSON.stringify({ channel_id: 'C456' }), status: 'active' },
      { id: 't3', trigger_type: 'slack_channel', config_json: JSON.stringify({ channel_id: 'C123' }), status: 'active' },
    ];
    mockQuery.mockResolvedValue(triggers);

    const result = await findSlackChannelTriggers(TEST_WORKSPACE_ID, 'C123');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('t1');
    expect(result[1].id).toBe('t3');
  });

  it('should return empty array when no triggers match the channel', async () => {
    const triggers = [
      { id: 't1', trigger_type: 'slack_channel', config_json: JSON.stringify({ channel_id: 'C999' }), status: 'active' },
    ];
    mockQuery.mockResolvedValue(triggers);

    const result = await findSlackChannelTriggers(TEST_WORKSPACE_ID, 'C123');
    expect(result).toEqual([]);
  });

  it('should return empty array when no slack_channel triggers exist', async () => {
    mockQuery.mockResolvedValue([]);

    const result = await findSlackChannelTriggers(TEST_WORKSPACE_ID, 'C123');
    expect(result).toEqual([]);
  });

  it('should call getActiveTriggersByType with slack_channel', async () => {
    mockQuery.mockResolvedValue([]);

    await findSlackChannelTriggers(TEST_WORKSPACE_ID, 'C123');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM triggers WHERE trigger_type = $1'),
      expect.arrayContaining(['slack_channel', 'active']),
    );
  });
});

// ═══════════════════════════════════════════════════
// Schedule Trigger Helpers
// ═══════════════════════════════════════════════════

describe('getScheduledTriggersDue', () => {
  it('should query for active schedule triggers', async () => {
    const triggers = [
      { id: 't1', trigger_type: 'schedule', status: 'active' },
      { id: 't2', trigger_type: 'schedule', status: 'active' },
    ];
    mockQuery.mockResolvedValue(triggers);

    const result = await getScheduledTriggersDue();
    expect(result).toEqual(triggers);
    expect(mockQuery).toHaveBeenCalledWith(
      `SELECT * FROM triggers WHERE trigger_type = 'schedule' AND status = 'active'`,
      [],
    );
  });

  it('should return empty array when no scheduled triggers exist', async () => {
    mockQuery.mockResolvedValue([]);

    const result = await getScheduledTriggersDue();
    expect(result).toEqual([]);
  });
});

describe('updateTriggerLastFired', () => {
  it('should update the last_fired_at timestamp', async () => {
    mockExecute.mockResolvedValue(undefined);

    await updateTriggerLastFired(TEST_WORKSPACE_ID, 't1');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE triggers SET last_fired_at = NOW()'),
      expect.arrayContaining(['t1']),
    );
  });
});

describe('getTriggerLastFiredAt', () => {
  it('should return the last fired date when set', async () => {
    mockQueryOne.mockResolvedValue({ last_fired_at: '2025-06-01T12:00:00Z' });

    const result = await getTriggerLastFiredAt(TEST_WORKSPACE_ID, 't1');
    expect(result).toEqual(new Date('2025-06-01T12:00:00Z'));
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('SELECT last_fired_at FROM triggers WHERE id = $1'),
      expect.arrayContaining(['t1']),
    );
  });

  it('should return null when last_fired_at is null', async () => {
    mockQueryOne.mockResolvedValue({ last_fired_at: null });

    const result = await getTriggerLastFiredAt(TEST_WORKSPACE_ID, 't1');
    expect(result).toBeNull();
  });

  it('should return null when trigger does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);

    const result = await getTriggerLastFiredAt(TEST_WORKSPACE_ID, 'nonexistent');
    expect(result).toBeNull();
  });
});
