import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
}));

vi.mock('../../src/config', () => ({
  config: {
    observability: { dailyBudgetUsd: 50, logLevel: 'info', dailyDigestTime: '09:00' },
  },
}));

vi.mock('../../src/modules/dashboard', () => ({
  getMetrics: vi.fn(),
}));

vi.mock('../../src/modules/agents', () => ({
  listAgents: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getAlertRules,
  checkAlerts,
  getAgentErrorRates,
  generateDailyDigest,
  getRunByTraceId,
} from '../../src/modules/observability';

const TEST_WORKSPACE_ID = 'W_TEST_123';

// ── getAlertRules ──

describe('getAlertRules', () => {
  it('should return 5 default alert rules', () => {
    const rules = getAlertRules();
    expect(rules).toHaveLength(5);
  });

  it('should include all expected conditions', () => {
    const rules = getAlertRules();
    const conditions = rules.map((r) => r.condition);
    expect(conditions).toContain('error_rate');
    expect(conditions).toContain('single_run_cost');
    expect(conditions).toContain('daily_spend');
    expect(conditions).toContain('queue_depth');
    expect(conditions).toContain('run_duration');
  });

  it('should return a copy, not the original array', () => {
    const rules1 = getAlertRules();
    const rules2 = getAlertRules();
    expect(rules1).not.toBe(rules2);
    expect(rules1).toEqual(rules2);
  });

  it('should have correct thresholds', () => {
    const rules = getAlertRules();
    const byCondition = Object.fromEntries(rules.map((r) => [r.condition, r]));
    expect(byCondition['error_rate'].threshold).toBe(0.10);
    expect(byCondition['single_run_cost'].threshold).toBe(5.0);
    expect(byCondition['daily_spend'].threshold).toBe(50); // from mocked config
    expect(byCondition['queue_depth'].threshold).toBe(50);
    expect(byCondition['run_duration'].threshold).toBe(600000);
  });

  it('should have non-empty action strings', () => {
    const rules = getAlertRules();
    for (const rule of rules) {
      expect(rule.action.length).toBeGreaterThan(0);
    }
  });
});

// ── checkAlerts ──

describe('checkAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when no alerts are triggered', async () => {
    // Hour stats: no failures
    mockQueryOne
      .mockResolvedValueOnce({ total: '10', failed: '0' }) // hourStats
      .mockResolvedValueOnce(null) // expensiveRun
      .mockResolvedValueOnce({ total: '5.00' }) // dailySpend (under 50 budget)
      .mockResolvedValueOnce(null); // longRun

    const alerts = await checkAlerts(TEST_WORKSPACE_ID);
    expect(alerts).toEqual([]);
  });

  it('should trigger error_rate alert when >10%', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ total: '20', failed: '5' }) // 25% error rate
      .mockResolvedValueOnce(null) // no expensive run
      .mockResolvedValueOnce({ total: '10.00' }) // daily spend under budget
      .mockResolvedValueOnce(null); // no long run

    const alerts = await checkAlerts(TEST_WORKSPACE_ID);
    const errorAlert = alerts.find((a) => a.condition === 'error_rate');
    expect(errorAlert).toBeDefined();
    expect(errorAlert!.triggered).toBe(true);
    expect(errorAlert!.value).toBeCloseTo(0.25);
    expect(errorAlert!.threshold).toBe(0.10);
    expect(errorAlert!.message).toContain('25.0%');
    expect(errorAlert!.message).toContain('5/20');
  });

  it('should not trigger error_rate when exactly 10%', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ total: '10', failed: '1' }) // exactly 10%
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ total: '0' })
      .mockResolvedValueOnce(null);

    const alerts = await checkAlerts(TEST_WORKSPACE_ID);
    const errorAlert = alerts.find((a) => a.condition === 'error_rate');
    expect(errorAlert).toBeUndefined(); // 10% is not > 10%, so not triggered
  });

  it('should not produce error_rate result when total is 0', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ total: '0', failed: '0' }) // no runs
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ total: '0' })
      .mockResolvedValueOnce(null);

    const alerts = await checkAlerts(TEST_WORKSPACE_ID);
    const errorAlert = alerts.find((a) => a.condition === 'error_rate');
    expect(errorAlert).toBeUndefined();
  });

  it('should trigger single_run_cost alert when expensive run found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ total: '5', failed: '0' })
      .mockResolvedValueOnce({
        id: 'run-12345678-aaaa-bbbb-cccc-dddddddddddd',
        agent_id: 'agent-001',
        estimated_cost_usd: '7.50',
      }) // expensive run
      .mockResolvedValueOnce({ total: '10.00' })
      .mockResolvedValueOnce(null);

    const alerts = await checkAlerts(TEST_WORKSPACE_ID);
    const costAlert = alerts.find((a) => a.condition === 'single_run_cost');
    expect(costAlert).toBeDefined();
    expect(costAlert!.triggered).toBe(true);
    expect(costAlert!.value).toBeCloseTo(7.5);
    expect(costAlert!.threshold).toBe(5.0);
    expect(costAlert!.message).toContain('run-1234');
    expect(costAlert!.message).toContain('$7.50');
  });

  it('should trigger daily_spend alert when over budget', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ total: '10', failed: '0' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ total: '75.00' }) // 75 > 50 budget
      .mockResolvedValueOnce(null);

    const alerts = await checkAlerts(TEST_WORKSPACE_ID);
    const spendAlert = alerts.find((a) => a.condition === 'daily_spend');
    expect(spendAlert).toBeDefined();
    expect(spendAlert!.triggered).toBe(true);
    expect(spendAlert!.value).toBeCloseTo(75);
    expect(spendAlert!.threshold).toBe(50);
    expect(spendAlert!.message).toContain('$75.00');
    expect(spendAlert!.message).toContain('$50');
  });

  it('should not trigger daily_spend when under budget', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ total: '10', failed: '0' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ total: '30.00' }) // 30 < 50 budget
      .mockResolvedValueOnce(null);

    const alerts = await checkAlerts(TEST_WORKSPACE_ID);
    const spendAlert = alerts.find((a) => a.condition === 'daily_spend');
    expect(spendAlert).toBeUndefined(); // filtered out because not triggered
  });

  it('should trigger run_duration alert for long-running task', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ total: '10', failed: '0' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ total: '10.00' })
      .mockResolvedValueOnce({
        id: 'longrun-1234-aaaa-bbbb-ccccddddeeee',
        agent_id: 'agent-001',
        duration_ms: 900000, // 900s
      });

    const alerts = await checkAlerts(TEST_WORKSPACE_ID);
    const durAlert = alerts.find((a) => a.condition === 'run_duration');
    expect(durAlert).toBeDefined();
    expect(durAlert!.triggered).toBe(true);
    expect(durAlert!.value).toBe(900000);
    expect(durAlert!.threshold).toBe(600000);
    expect(durAlert!.message).toContain('900s');
  });

  it('should return multiple triggered alerts at once', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ total: '10', failed: '5' }) // 50% error rate
      .mockResolvedValueOnce({
        id: 'expensive-1234-aaaa-bbbb-ccccddddeeee',
        agent_id: 'agent-001',
        estimated_cost_usd: '10.00',
      }) // expensive run
      .mockResolvedValueOnce({ total: '100.00' }) // over budget
      .mockResolvedValueOnce({
        id: 'longlong-1234-aaaa-bbbb-ccccddddeeee',
        agent_id: 'agent-001',
        duration_ms: 1200000,
      }); // long run

    const alerts = await checkAlerts(TEST_WORKSPACE_ID);
    expect(alerts.length).toBe(4);
    const conditions = alerts.map((a) => a.condition);
    expect(conditions).toContain('error_rate');
    expect(conditions).toContain('single_run_cost');
    expect(conditions).toContain('daily_spend');
    expect(conditions).toContain('run_duration');
  });

  it('should handle null hourStats gracefully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // null hourStats
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ total: '0' })
      .mockResolvedValueOnce(null);

    const alerts = await checkAlerts(TEST_WORKSPACE_ID);
    // No error_rate alert since hourStats is null
    expect(alerts.find((a) => a.condition === 'error_rate')).toBeUndefined();
  });

  it('should handle null dailySpend gracefully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ total: '5', failed: '0' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null) // null daily spend
      .mockResolvedValueOnce(null);

    const alerts = await checkAlerts(TEST_WORKSPACE_ID);
    // dailySpend of 0 should not trigger (0 < 50)
    expect(alerts.find((a) => a.condition === 'daily_spend')).toBeUndefined();
  });
});

// ── getAgentErrorRates ──

describe('getAgentErrorRates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when no agents have runs', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const rates = await getAgentErrorRates(TEST_WORKSPACE_ID);
    expect(rates).toEqual([]);
  });

  it('should return agent error rates with correct calculation', async () => {
    mockQuery.mockResolvedValueOnce([
      { agent_id: 'a1', name: 'Alpha', total: '20', failed: '4' },
      { agent_id: 'a2', name: 'Beta', total: '10', failed: '1' },
    ]);

    const rates = await getAgentErrorRates(TEST_WORKSPACE_ID);
    expect(rates).toHaveLength(2);

    expect(rates[0].agentId).toBe('a1');
    expect(rates[0].name).toBe('Alpha');
    expect(rates[0].errorRate).toBeCloseTo(0.2);
    expect(rates[0].total).toBe(20);

    expect(rates[1].agentId).toBe('a2');
    expect(rates[1].name).toBe('Beta');
    expect(rates[1].errorRate).toBeCloseTo(0.1);
    expect(rates[1].total).toBe(10);
  });

  it('should return zero error rate for agent with no failures', async () => {
    mockQuery.mockResolvedValueOnce([
      { agent_id: 'a1', name: 'Perfect', total: '50', failed: '0' },
    ]);

    const rates = await getAgentErrorRates(TEST_WORKSPACE_ID);
    expect(rates[0].errorRate).toBe(0);
  });

  it('should pass a recent timestamp parameter', async () => {
    const before = Date.now();
    mockQuery.mockResolvedValueOnce([]);

    await getAgentErrorRates(TEST_WORKSPACE_ID);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const param = mockQuery.mock.calls[0][1][0];
    const ts = new Date(param).getTime();
    const expected = before - 60 * 60 * 1000;
    expect(ts).toBeGreaterThanOrEqual(expected - 1000);
    expect(ts).toBeLessThanOrEqual(before);
  });
});

// ── generateDailyDigest ──

describe('generateDailyDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a formatted digest string with header', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ run_count: '0', tokens: '0', cost: '0', failures: '0' }) // stats
      .mockResolvedValueOnce(null) // topAgent
      .mockResolvedValueOnce(null); // topUser
    mockQuery
      .mockResolvedValueOnce([]) // errorAgents
      .mockResolvedValueOnce([]); // anomalous

    const digest = await generateDailyDigest(TEST_WORKSPACE_ID);
    expect(digest).toContain('TinyHands Daily Digest');
    expect(digest).toContain('Runs: *0*');
    expect(digest).toContain('Cost: *$0.00*');
  });

  it('should include run stats in the digest', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ run_count: '42', tokens: '150000', cost: '23.45', failures: '3' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const digest = await generateDailyDigest(TEST_WORKSPACE_ID);
    expect(digest).toContain('Runs: *42*');
    expect(digest).toContain('Tokens: *150,000*');
    expect(digest).toContain('Cost: *$23.45*');
  });

  it('should include top agent when present', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ run_count: '10', tokens: '5000', cost: '2.00', failures: '0' })
      .mockResolvedValueOnce({ name: 'SuperBot', runs: '7' }) // topAgent
      .mockResolvedValueOnce(null);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const digest = await generateDailyDigest(TEST_WORKSPACE_ID);
    expect(digest).toContain('Top agent: *SuperBot*');
    expect(digest).toContain('7 runs');
  });

  it('should include top user when present', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ run_count: '10', tokens: '5000', cost: '2.00', failures: '0' })
      .mockResolvedValueOnce(null) // no top agent
      .mockResolvedValueOnce({ slack_user_id: 'U12345', runs: '5' }); // topUser
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const digest = await generateDailyDigest(TEST_WORKSPACE_ID);
    expect(digest).toContain('Top user: <@U12345>');
    expect(digest).toContain('5 runs');
  });

  it('should include high error rate agents section', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ run_count: '50', tokens: '20000', cost: '10.00', failures: '10' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockQuery
      .mockResolvedValueOnce([
        { name: 'FailBot', total: '10', failed: '5' },
        { name: 'BadBot', total: '8', failed: '3' },
      ]) // errorAgents
      .mockResolvedValueOnce([]); // anomalous

    const digest = await generateDailyDigest(TEST_WORKSPACE_ID);
    expect(digest).toContain('High error rate agents');
    expect(digest).toContain('FailBot');
    expect(digest).toContain('50%');
    expect(digest).toContain('5/10');
    expect(digest).toContain('BadBot');
  });

  it('should include anomalous cost agents section', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ run_count: '20', tokens: '10000', cost: '15.00', failures: '0' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockQuery
      .mockResolvedValueOnce([]) // no error agents
      .mockResolvedValueOnce([
        { name: 'SpendyBot', yesterday_cost: '12.50', avg_daily_cost: '3.00' },
      ]); // anomalous

    const digest = await generateDailyDigest(TEST_WORKSPACE_ID);
    expect(digest).toContain('Anomalous cost agents');
    expect(digest).toContain('SpendyBot');
    expect(digest).toContain('$12.50');
    expect(digest).toContain('2x+ avg');
  });

  it('should not include error agents section when none qualify', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ run_count: '10', tokens: '5000', cost: '2.00', failures: '0' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockQuery
      .mockResolvedValueOnce([]) // no error agents
      .mockResolvedValueOnce([]); // no anomalous

    const digest = await generateDailyDigest(TEST_WORKSPACE_ID);
    expect(digest).not.toContain('High error rate agents');
    expect(digest).not.toContain('Anomalous cost agents');
  });

  it('should handle null stats gracefully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // null stats
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const digest = await generateDailyDigest(TEST_WORKSPACE_ID);
    expect(digest).toContain('Runs: *0*');
    expect(digest).toContain('Cost: *$0.00*');
  });

  it('should include both top agent and top user when both present', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ run_count: '30', tokens: '50000', cost: '15.00', failures: '2' })
      .mockResolvedValueOnce({ name: 'AlphaBot', runs: '12' })
      .mockResolvedValueOnce({ slack_user_id: 'UADMIN', runs: '8' });
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const digest = await generateDailyDigest(TEST_WORKSPACE_ID);
    expect(digest).toContain('Top agent: *AlphaBot* (12 runs)');
    expect(digest).toContain('Top user: <@UADMIN> (8 runs)');
  });
});

// ── getRunByTraceId ──

describe('getRunByTraceId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should query with the provided trace ID', async () => {
    const fakeRun = { id: 'run-1', trace_id: 'abc-123', status: 'completed' };
    mockQueryOne.mockResolvedValueOnce(fakeRun);

    const result = await getRunByTraceId(TEST_WORKSPACE_ID, 'abc-123');

    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT * FROM run_history WHERE trace_id = $1 AND workspace_id = $2',
      ['abc-123', TEST_WORKSPACE_ID],
    );
    expect(result).toEqual(fakeRun);
  });

  it('should return null when trace ID not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await getRunByTraceId(TEST_WORKSPACE_ID, 'nonexistent');
    expect(result).toBeNull();
  });

  it('should return undefined when queryOne returns undefined', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);

    const result = await getRunByTraceId(TEST_WORKSPACE_ID, 'missing');
    expect(result).toBeUndefined();
  });
});
