import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockPostMessage = vi.fn().mockResolvedValue(undefined);
const mockApproveContribution = vi.fn();
const mockApproveProposal = vi.fn();
const mockRejectProposal = vi.fn();
const mockResolveHumanAction = vi.fn();
const mockDeleteKBEntry = vi.fn();
const mockPauseTrigger = vi.fn();
const mockResumeTrigger = vi.fn();

vi.mock('../../src/db', () => ({
  getDefaultWorkspaceId: () => 'W_TEST_123',
}));

vi.mock('../../src/slack/index', () => ({
  postMessage: (...args: any[]) => mockPostMessage(...args),
}));

vi.mock('../../src/modules/kb-wizard', () => ({
  approveContribution: (...args: any[]) => mockApproveContribution(...args),
}));

vi.mock('../../src/modules/self-evolution', () => ({
  approveProposal: (...args: any[]) => mockApproveProposal(...args),
  rejectProposal: (...args: any[]) => mockRejectProposal(...args),
}));

vi.mock('../../src/modules/workflows', () => ({
  resolveHumanAction: (...args: any[]) => mockResolveHumanAction(...args),
}));

vi.mock('../../src/modules/knowledge-base', () => ({
  deleteKBEntry: (...args: any[]) => mockDeleteKBEntry(...args),
}));

vi.mock('../../src/modules/triggers', () => ({
  pauseTrigger: (...args: any[]) => mockPauseTrigger(...args),
  resumeTrigger: (...args: any[]) => mockResumeTrigger(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerActions } from '../../src/slack/actions';

// ── Helpers ──

type ActionHandler = (params: { action: any; ack: () => Promise<void>; body: any }) => Promise<void>;

/**
 * Creates a mock Bolt App and registers all actions.
 * Returns a map of action_id -> handler function for direct invocation.
 */
function setupApp(): Record<string, ActionHandler> {
  const handlers: Record<string, ActionHandler> = {};
  const mockApp = {
    action: vi.fn((actionId: string, handler: ActionHandler) => {
      handlers[actionId] = handler;
    }),
  };

  registerActions(mockApp as any);
  return handlers;
}

function makeAck(): () => Promise<void> {
  return vi.fn().mockResolvedValue(undefined);
}

function makeBody(userId: string, channelId: string): any {
  return {
    user: { id: userId },
    channel: { id: channelId },
    team: { id: 'W_TEST_123' },
  };
}

function makeAction(value: string): any {
  return { value };
}

// ── Tests ──

describe('Slack actions module', () => {
  let handlers: Record<string, ActionHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = setupApp();
  });

  // ── Registration ──

  describe('registerActions', () => {
    it('should register all expected action handlers', () => {
      expect(handlers).toHaveProperty('kb_approve');
      expect(handlers).toHaveProperty('kb_reject');
      expect(handlers).toHaveProperty('evolution_approve');
      expect(handlers).toHaveProperty('evolution_reject');
      expect(handlers).toHaveProperty('workflow_action');
      expect(handlers).toHaveProperty('trigger_pause');
      expect(handlers).toHaveProperty('trigger_resume');
      expect(handlers).toHaveProperty('open_dashboard_requests');
    });

    it('should register exactly 8 action handlers', () => {
      expect(Object.keys(handlers)).toHaveLength(8);
    });
  });

  // ── KB Approve ──

  describe('kb_approve', () => {
    it('should ack, approve the entry, and post a confirmation message', async () => {
      mockApproveContribution.mockResolvedValue({ title: 'How to Reset Password' });
      const ack = makeAck();
      const body = makeBody('U001', 'C001');
      const action = makeAction('entry-123');

      await handlers.kb_approve({ action, ack, body });

      expect(ack).toHaveBeenCalled();
      expect(mockApproveContribution).toHaveBeenCalledWith('W_TEST_123', 'entry-123');
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C001',
        expect.stringContaining('How to Reset Password'),
      );
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C001',
        expect.stringContaining('<@U001>'),
      );
    });

    it('should log error when approval fails', async () => {
      mockApproveContribution.mockRejectedValue(new Error('DB connection lost'));
      const ack = makeAck();
      const body = makeBody('U001', 'C001');
      const action = makeAction('entry-bad');

      await handlers.kb_approve({ action, ack, body });

      expect(ack).toHaveBeenCalled();
      const { logger } = await import('../../src/utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'KB approval failed',
        expect.objectContaining({ entryId: 'entry-bad', error: 'DB connection lost' }),
      );
    });

    it('should use empty string for channel if body.channel is missing', async () => {
      mockApproveContribution.mockResolvedValue({ title: 'Test' });
      const ack = makeAck();
      const body = { user: { id: 'U001' }, team: { id: 'W_TEST_123' } }; // no channel

      await handlers.kb_approve({ action: makeAction('entry-1'), ack, body });

      expect(mockPostMessage).toHaveBeenCalledWith(
        '',
        expect.any(String),
      );
    });
  });

  // ── KB Reject ──

  describe('kb_reject', () => {
    it('should ack, delete the entry, and post a rejection message', async () => {
      mockDeleteKBEntry.mockResolvedValue(undefined);
      const ack = makeAck();
      const body = makeBody('U002', 'C002');
      const action = makeAction('entry-456');

      await handlers.kb_reject({ action, ack, body });

      expect(ack).toHaveBeenCalled();
      expect(mockDeleteKBEntry).toHaveBeenCalledWith('W_TEST_123', 'entry-456');
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C002',
        expect.stringContaining('rejected'),
      );
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C002',
        expect.stringContaining('<@U002>'),
      );
    });
  });

  // ── Evolution Approve ──

  describe('evolution_approve', () => {
    it('should ack, approve the proposal, and post confirmation', async () => {
      mockApproveProposal.mockResolvedValue({ description: 'Add caching layer' });
      const ack = makeAck();
      const body = makeBody('U003', 'C003');
      const action = makeAction('proposal-789');

      await handlers.evolution_approve({ action, ack, body });

      expect(ack).toHaveBeenCalled();
      expect(mockApproveProposal).toHaveBeenCalledWith('W_TEST_123', 'proposal-789', 'U003');
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C003',
        expect.stringContaining('Add caching layer'),
      );
    });

    it('should log error when proposal approval fails', async () => {
      mockApproveProposal.mockRejectedValue(new Error('not found'));
      const ack = makeAck();
      const body = makeBody('U003', 'C003');
      const action = makeAction('proposal-bad');

      await handlers.evolution_approve({ action, ack, body });

      expect(ack).toHaveBeenCalled();
      const { logger } = await import('../../src/utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Evolution approval failed',
        expect.objectContaining({ proposalId: 'proposal-bad' }),
      );
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  // ── Evolution Reject ──

  describe('evolution_reject', () => {
    it('should ack, reject the proposal, and post confirmation', async () => {
      mockRejectProposal.mockResolvedValue(undefined);
      const ack = makeAck();
      const body = makeBody('U004', 'C004');
      const action = makeAction('proposal-111');

      await handlers.evolution_reject({ action, ack, body });

      expect(ack).toHaveBeenCalled();
      expect(mockRejectProposal).toHaveBeenCalledWith('W_TEST_123', 'proposal-111', 'U004');
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C004',
        expect.stringContaining('rejected'),
      );
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C004',
        expect.stringContaining('<@U004>'),
      );
    });

    it('should log error when rejection fails', async () => {
      mockRejectProposal.mockRejectedValue(new Error('DB error'));
      const ack = makeAck();
      const body = makeBody('U004', 'C004');
      const action = makeAction('proposal-err');

      await handlers.evolution_reject({ action, ack, body });

      const { logger } = await import('../../src/utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Evolution rejection failed',
        expect.objectContaining({ proposalId: 'proposal-err' }),
      );
    });
  });

  // ── Workflow Action ──

  describe('workflow_action', () => {
    it('should ack, resolve the action, and post resume message', async () => {
      mockResolveHumanAction.mockResolvedValue(undefined);
      const ack = makeAck();
      const body = makeBody('U005', 'C005');
      const actionPayload = JSON.stringify({
        workflowRunId: 'run-123',
        actionData: { choice: 'approved' },
      });
      const action = makeAction(actionPayload);

      await handlers.workflow_action({ action, ack, body });

      expect(ack).toHaveBeenCalled();
      expect(mockResolveHumanAction).toHaveBeenCalledWith('W_TEST_123', 'run-123', { choice: 'approved' });
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C005',
        expect.stringContaining('Workflow resumed'),
      );
    });

    it('should handle invalid JSON in action value gracefully', async () => {
      const ack = makeAck();
      const body = makeBody('U005', 'C005');
      const action = makeAction('not-valid-json');

      await handlers.workflow_action({ action, ack, body });

      expect(ack).toHaveBeenCalled();
      const { logger } = await import('../../src/utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Workflow action failed',
        expect.objectContaining({ error: expect.any(String) }),
      );
      expect(mockResolveHumanAction).not.toHaveBeenCalled();
    });

    it('should log error when resolveHumanAction fails', async () => {
      mockResolveHumanAction.mockRejectedValue(new Error('workflow not found'));
      const ack = makeAck();
      const body = makeBody('U005', 'C005');
      const actionPayload = JSON.stringify({ workflowRunId: 'run-bad', actionData: {} });
      const action = makeAction(actionPayload);

      await handlers.workflow_action({ action, ack, body });

      const { logger } = await import('../../src/utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Workflow action failed',
        expect.objectContaining({ error: 'workflow not found' }),
      );
    });
  });

  // ── Trigger Pause ──

  describe('trigger_pause', () => {
    it('should ack, pause the trigger, and post confirmation', async () => {
      mockPauseTrigger.mockResolvedValue(undefined);
      const ack = makeAck();
      const body = makeBody('U006', 'C006');
      const action = makeAction('trigger-abc');

      await handlers.trigger_pause({ action, ack, body });

      expect(ack).toHaveBeenCalled();
      expect(mockPauseTrigger).toHaveBeenCalledWith('W_TEST_123', 'trigger-abc', 'U006');
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C006',
        expect.stringContaining('Trigger paused'),
      );
    });

    it('should log error when pause fails', async () => {
      mockPauseTrigger.mockRejectedValue(new Error('trigger not found'));
      const ack = makeAck();
      const body = makeBody('U006', 'C006');
      const action = makeAction('trigger-bad');

      await handlers.trigger_pause({ action, ack, body });

      const { logger } = await import('../../src/utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Trigger pause failed',
        expect.objectContaining({ error: 'trigger not found' }),
      );
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  // ── Trigger Resume ──

  describe('trigger_resume', () => {
    it('should ack, resume the trigger, and post confirmation', async () => {
      mockResumeTrigger.mockResolvedValue(undefined);
      const ack = makeAck();
      const body = makeBody('U007', 'C007');
      const action = makeAction('trigger-xyz');

      await handlers.trigger_resume({ action, ack, body });

      expect(ack).toHaveBeenCalled();
      expect(mockResumeTrigger).toHaveBeenCalledWith('W_TEST_123', 'trigger-xyz', 'U007');
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C007',
        expect.stringContaining('Trigger resumed'),
      );
    });

    it('should log error when resume fails', async () => {
      mockResumeTrigger.mockRejectedValue(new Error('already running'));
      const ack = makeAck();
      const body = makeBody('U007', 'C007');
      const action = makeAction('trigger-running');

      await handlers.trigger_resume({ action, ack, body });

      const { logger } = await import('../../src/utils/logger');
      expect(logger.error).toHaveBeenCalledWith(
        'Trigger resume failed',
        expect.objectContaining({ error: 'already running' }),
      );
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  // ── Dashboard CTA (no-op) ──

  describe('open_dashboard_requests', () => {
    it('should ack and do nothing else', async () => {
      const ack = makeAck();
      await handlers.open_dashboard_requests({ action: makeAction(''), ack, body: makeBody('U010', 'C010') });
      expect(ack).toHaveBeenCalled();
      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('should always call ack before any async work', async () => {
      // Use a slow mock to verify ack ordering
      let ackOrder = 0;
      let approveOrder = 0;
      const ack = vi.fn().mockImplementation(async () => { ackOrder = Date.now(); });
      mockApproveContribution.mockImplementation(async () => {
        approveOrder = Date.now();
        return { title: 'Test' };
      });

      const body = makeBody('U001', 'C001');
      await handlers.kb_approve({ action: makeAction('entry-1'), ack, body });

      expect(ack).toHaveBeenCalled();
      // ack should be called (order of ack <= approve given they both resolve immediately)
      expect(ackOrder).toBeLessThanOrEqual(approveOrder);
    });

    it('should handle missing body.user gracefully in kb_approve', async () => {
      mockApproveContribution.mockResolvedValue({ title: 'Test' });
      const ack = makeAck();
      const body = { channel: { id: 'C001' }, team: { id: 'W_TEST_123' } }; // no user

      await handlers.kb_approve({ action: makeAction('entry-1'), ack, body });

      expect(ack).toHaveBeenCalled();
      expect(mockPostMessage).toHaveBeenCalledWith(
        'C001',
        expect.stringContaining('<@undefined>'),
      );
    });
  });
});
