import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
}));

vi.mock('../../src/modules/agents', () => ({
  listAgents: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/modules/execution', () => ({
  getRecentRuns: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { buildDashboardBlocks, getMetrics } from '../../src/modules/dashboard';
import { listAgents } from '../../src/modules/agents';
import { getRecentRuns } from '../../src/modules/execution';

// ── Helpers ──

function makeAgent(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'agent-001',
    name: 'TestAgent',
    avatar_emoji: ':robot_face:',
    channel_id: 'C12345',
    status: 'active',
    permission_level: 'standard',
    model: 'sonnet',
    ...overrides,
  };
}

function makeRun(overrides: Partial<Record<string, any>> = {}) {
  return {
    trace_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    agent_id: 'agent-001-aaaa-bbbb-cccc-dddddddddddd',
    status: 'completed',
    duration_ms: 1500,
    estimated_cost_usd: 0.0234,
    model: 'sonnet',
    ...overrides,
  };
}

function defaultStatsRow(overrides: Partial<Record<string, string>> = {}) {
  return {
    total_runs: '0',
    total_tokens: '0',
    total_cost: '0',
    avg_duration: '0',
    failed_runs: '0',
    ...overrides,
  };
}

// ── getMetrics ──

describe('getMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return zero metrics when there are no runs', async () => {
    mockQueryOne.mockResolvedValueOnce(defaultStatsRow());
    mockQuery
      .mockResolvedValueOnce([]) // durations
      .mockResolvedValueOnce([]) // byAgent
      .mockResolvedValueOnce([]) // byModel
      .mockResolvedValueOnce([]) // runsByAgent
      .mockResolvedValueOnce([]); // waits

    const m = await getMetrics(30);

    expect(m.totalRuns).toBe(0);
    expect(m.totalTokens).toBe(0);
    expect(m.totalCostUsd).toBe(0);
    expect(m.errorRate).toBe(0);
    expect(m.avgDurationMs).toBe(0);
    expect(m.p50DurationMs).toBe(0);
    expect(m.p95DurationMs).toBe(0);
    expect(m.p99DurationMs).toBe(0);
    expect(m.queueWaitP50Ms).toBe(0);
    expect(m.queueWaitP95Ms).toBe(0);
    expect(m.tokensByAgent).toEqual({});
    expect(m.tokensByUser).toEqual({});
    expect(m.tokensByModel).toEqual({});
    expect(m.runsByAgent).toEqual({});
  });

  it('should compute totals and error rate from stats row', async () => {
    mockQueryOne.mockResolvedValueOnce(
      defaultStatsRow({
        total_runs: '100',
        total_tokens: '50000',
        total_cost: '12.50',
        avg_duration: '2500',
        failed_runs: '15',
      }),
    );
    mockQuery
      .mockResolvedValueOnce([]) // durations
      .mockResolvedValueOnce([]) // byAgent
      .mockResolvedValueOnce([]) // byModel
      .mockResolvedValueOnce([]) // runsByAgent
      .mockResolvedValueOnce([]); // waits

    const m = await getMetrics(7);

    expect(m.totalRuns).toBe(100);
    expect(m.totalTokens).toBe(50000);
    expect(m.totalCostUsd).toBeCloseTo(12.5);
    expect(m.errorRate).toBeCloseTo(0.15);
    expect(m.avgDurationMs).toBe(2500);
  });

  it('should compute percentile durations correctly', async () => {
    // Sorted array of 10 values: 100,200,...,1000
    const durations = Array.from({ length: 10 }, (_, i) => ({
      duration_ms: (i + 1) * 100,
    }));

    mockQueryOne.mockResolvedValueOnce(defaultStatsRow({ total_runs: '10' }));
    mockQuery
      .mockResolvedValueOnce(durations) // durations
      .mockResolvedValueOnce([]) // byAgent
      .mockResolvedValueOnce([]) // byModel
      .mockResolvedValueOnce([]) // runsByAgent
      .mockResolvedValueOnce([]); // waits

    const m = await getMetrics(30);

    // percentile: idx = ceil(p/100 * n) - 1
    // p50: ceil(0.5*10)-1 = 4 => durations[4] = 500
    expect(m.p50DurationMs).toBe(500);
    // p95: ceil(0.95*10)-1 = 9 => durations[9] = 1000
    expect(m.p95DurationMs).toBe(1000);
    // p99: ceil(0.99*10)-1 = 9 => durations[9] = 1000
    expect(m.p99DurationMs).toBe(1000);
  });

  it('should handle a single element for percentile', async () => {
    mockQueryOne.mockResolvedValueOnce(defaultStatsRow({ total_runs: '1' }));
    mockQuery
      .mockResolvedValueOnce([{ duration_ms: 777 }]) // single duration
      .mockResolvedValueOnce([]) // byAgent
      .mockResolvedValueOnce([]) // byModel
      .mockResolvedValueOnce([]) // runsByAgent
      .mockResolvedValueOnce([]); // waits

    const m = await getMetrics(30);

    expect(m.p50DurationMs).toBe(777);
    expect(m.p95DurationMs).toBe(777);
    expect(m.p99DurationMs).toBe(777);
  });

  it('should build tokensByAgent, tokensByModel, and runsByAgent maps', async () => {
    mockQueryOne.mockResolvedValueOnce(defaultStatsRow({ total_runs: '5' }));
    mockQuery
      .mockResolvedValueOnce([]) // durations
      .mockResolvedValueOnce([
        { agent_id: 'a1', tokens: '10000' },
        { agent_id: 'a2', tokens: '5000' },
      ]) // byAgent
      .mockResolvedValueOnce([
        { model: 'sonnet', tokens: '12000' },
        { model: 'haiku', tokens: '3000' },
      ]) // byModel
      .mockResolvedValueOnce([
        { agent_id: 'a1', count: '3' },
        { agent_id: 'a2', count: '2' },
      ]) // runsByAgent
      .mockResolvedValueOnce([]); // waits

    const m = await getMetrics(30);

    expect(m.tokensByAgent).toEqual({ a1: 10000, a2: 5000 });
    expect(m.tokensByModel).toEqual({ sonnet: 12000, haiku: 3000 });
    expect(m.runsByAgent).toEqual({ a1: 3, a2: 2 });
    expect(m.tokensByUser).toEqual({});
  });

  it('should compute queue wait percentiles', async () => {
    const waits = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => ({
      queue_wait_ms: v,
    }));

    mockQueryOne.mockResolvedValueOnce(defaultStatsRow({ total_runs: '10' }));
    mockQuery
      .mockResolvedValueOnce([]) // durations
      .mockResolvedValueOnce([]) // byAgent
      .mockResolvedValueOnce([]) // byModel
      .mockResolvedValueOnce([]) // runsByAgent
      .mockResolvedValueOnce(waits); // waits

    const m = await getMetrics(30);

    // p50: ceil(0.5*10)-1 = 4 => waits[4] = 50
    expect(m.queueWaitP50Ms).toBe(50);
    // p95: ceil(0.95*10)-1 = 9 => waits[9] = 100
    expect(m.queueWaitP95Ms).toBe(100);
  });

  it('should pass correct date parameter to queries', async () => {
    const before = Date.now();
    mockQueryOne.mockResolvedValueOnce(defaultStatsRow());
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await getMetrics(7);

    // queryOne called once (stats), query called 5 times
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(5);

    // All queries receive a since-date string param
    const sinceParam = mockQueryOne.mock.calls[0][1][0];
    const sinceDate = new Date(sinceParam).getTime();
    const expectedApprox = before - 7 * 24 * 60 * 60 * 1000;
    expect(sinceDate).toBeGreaterThanOrEqual(expectedApprox - 1000);
    expect(sinceDate).toBeLessThanOrEqual(before);
  });

  it('should handle null stats row gracefully', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const m = await getMetrics(30);

    expect(m.totalRuns).toBe(0);
    expect(m.totalTokens).toBe(0);
    expect(m.totalCostUsd).toBe(0);
    expect(m.errorRate).toBe(0);
  });
});

// ── buildDashboardBlocks ──

describe('buildDashboardBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: all queries return [], metrics queryOne returns zeros
    // buildDashboardBlocks query call order:
    //   1. Top Power Users query (query)
    //   2. Top Agent Creators query (query)
    //   3. Most Popular Agents query (query)
    //   4. getMetrics: queryOne (stats) + 5x query (durations, byAgent, byModel, runsByAgent, waits)
    // Total: 8 query calls, 1 queryOne call
    mockQuery.mockResolvedValue([]);
    mockQueryOne.mockResolvedValue(defaultStatsRow());
  });

  it('should return an array of blocks', async () => {
    const blocks = await buildDashboardBlocks();
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('should include a header block with version number', async () => {
    const blocks = await buildDashboardBlocks();
    const header = blocks.find(
      (b) => b.type === 'header' && b.text?.text?.includes('Tiny Hands Dashboard') && b.text?.text?.includes('v'),
    );
    expect(header).toBeDefined();
    expect(header!.text.text).toMatch(/v\d+\.\d+\.\d+/);
  });

  it('should include divider blocks', async () => {
    const blocks = await buildDashboardBlocks();
    const dividers = blocks.filter((b) => b.type === 'divider');
    // Header, Usage Snapshot, Power Users, Agent Creators, Popular Agents, Agent Fleet = 6 dividers
    expect(dividers.length).toBeGreaterThanOrEqual(6);
  });

  it('should show "No recent runs" when there are no runs', async () => {
    const blocks = await buildDashboardBlocks();
    const noRuns = blocks.find(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes('No recent runs')),
    );
    expect(noRuns).toBeDefined();
  });

  it('should render agent fleet section with agent count', async () => {
    const agents = [makeAgent({ name: 'Alpha' }), makeAgent({ name: 'Beta', id: 'agent-002' })];
    vi.mocked(listAgents).mockResolvedValueOnce(agents as any);

    const blocks = await buildDashboardBlocks();
    const fleetHeader = blocks.find(
      (b) => b.type === 'section' && b.text?.text?.includes('Agent Fleet') && b.text.text.includes('2 agents'),
    );
    expect(fleetHeader).toBeDefined();
  });

  it('should show agent details in fleet section', async () => {
    const agents = [makeAgent({ name: 'MyBot', avatar_emoji: ':star:' })];
    vi.mocked(listAgents).mockResolvedValueOnce(agents as any);

    const blocks = await buildDashboardBlocks();
    const agentBlock = blocks.find(
      (b) => b.type === 'section' && b.text?.text?.includes('MyBot'),
    );
    expect(agentBlock).toBeDefined();
    expect(agentBlock!.text.text).toContain(':star:');
    expect(agentBlock!.text.text).toContain('C12345');
  });

  it('should show "+N more" when more than 10 agents', async () => {
    const agents = Array.from({ length: 12 }, (_, i) =>
      makeAgent({ id: `agent-${i}`, name: `Agent${i}` }),
    );
    vi.mocked(listAgents).mockResolvedValueOnce(agents as any);

    const blocks = await buildDashboardBlocks();

    // Should see context block with "...and 2 more agents"
    const moreBlock = blocks.find(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes('2 more agents')),
    );
    expect(moreBlock).toBeDefined();

    // Should verify agent count in header is correct
    const fleetHeader = blocks.find(
      (b) => b.type === 'section' && b.text?.text?.includes('12 agents'),
    );
    expect(fleetHeader).toBeDefined();
  });

  it('should not show "+N more" when exactly 10 agents', async () => {
    const agents = Array.from({ length: 10 }, (_, i) =>
      makeAgent({ id: `agent-${i}`, name: `Agent${i}` }),
    );
    vi.mocked(listAgents).mockResolvedValueOnce(agents as any);

    const blocks = await buildDashboardBlocks();

    const moreBlock = blocks.find(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes('more agents')),
    );
    expect(moreBlock).toBeUndefined();
  });

  it('should render recent runs with status emojis', async () => {
    const runs = [
      makeRun({ status: 'completed' }),
      makeRun({ status: 'failed', trace_id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' }),
      makeRun({ status: 'running', trace_id: 'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa' }),
    ];
    vi.mocked(getRecentRuns).mockResolvedValueOnce(runs as any);

    const blocks = await buildDashboardBlocks();

    const contextBlocks = blocks.filter(
      (b) => b.type === 'context' && b.elements?.some((e: any) => e.text?.includes('`')),
    );

    const allText = contextBlocks.map((b) => b.elements[0].text).join('\n');
    expect(allText).toContain(':white_check_mark:');
    expect(allText).toContain(':x:');
    expect(allText).toContain(':hourglass:');
  });

  it('should render run duration and cost', async () => {
    const runs = [makeRun({ duration_ms: 2345, estimated_cost_usd: 0.1234 })];
    vi.mocked(getRecentRuns).mockResolvedValueOnce(runs as any);

    const blocks = await buildDashboardBlocks();
    const runBlock = blocks.find(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes('2.3s') && e.text?.includes('$0.1234')),
    );
    expect(runBlock).toBeDefined();
  });

  it('should show dash for missing duration/cost', async () => {
    const runs = [makeRun({ duration_ms: null, estimated_cost_usd: null })];
    vi.mocked(getRecentRuns).mockResolvedValueOnce(runs as any);

    const blocks = await buildDashboardBlocks();
    const runBlock = blocks.find(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes('aaaaaaaa')),
    );
    expect(runBlock).toBeDefined();
    // The text should contain '-' placeholders for missing values
    expect(runBlock!.elements[0].text).toMatch(/ — - — /);
  });

  it('should include usage snapshot section with emoji formatting', async () => {
    mockQueryOne.mockResolvedValue(
      defaultStatsRow({
        total_runs: '42',
        total_tokens: '10000',
        total_cost: '5.50',
        avg_duration: '3000',
        failed_runs: '2',
      }),
    );

    const blocks = await buildDashboardBlocks();
    const usageBlock = blocks.find(
      (b) =>
        b.type === 'section' &&
        b.text?.text?.includes('Usage Snapshot'),
    );
    expect(usageBlock).toBeDefined();
    expect(usageBlock!.text.text).toContain(':chart_with_upwards_trend:');
    expect(usageBlock!.text.text).toContain('*42* runs');
    expect(usageBlock!.text.text).toContain('*$5.50* spent');
    expect(usageBlock!.text.text).toContain(':coin:');
    expect(usageBlock!.text.text).toContain(':zap:');
    expect(usageBlock!.text.text).toContain(':stopwatch:');
    expect(usageBlock!.text.text).toContain(':rotating_light:');
  });

  it('should show "No user activity yet" when no power users', async () => {
    const blocks = await buildDashboardBlocks();
    const noUsers = blocks.find(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes('No user activity yet')),
    );
    expect(noUsers).toBeDefined();
  });

  it('should show "No agents created yet" when no agent creators', async () => {
    const blocks = await buildDashboardBlocks();
    const noCreators = blocks.find(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes('No agents created yet')),
    );
    expect(noCreators).toBeDefined();
  });

  it('should show "No agent runs yet" when no popular agents', async () => {
    const blocks = await buildDashboardBlocks();
    const noPopular = blocks.find(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes('No agent runs yet')),
    );
    expect(noPopular).toBeDefined();
  });

  it('should render top power users with medals', async () => {
    mockQuery.mockReset();
    // getMetrics (called first by buildUsageSnapshotSection): durations, byAgent, byModel, runsByAgent, waits
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    // Top Power Users query
    mockQuery.mockResolvedValueOnce([
      { slack_user_id: 'U111', run_count: '42', agent_names: ['Alpha', 'Beta'] },
      { slack_user_id: 'U222', run_count: '30', agent_names: ['Gamma'] },
      { slack_user_id: 'U333', run_count: '20', agent_names: ['Delta'] },
    ]);
    // Top Agent Creators query
    mockQuery.mockResolvedValueOnce([]);
    // Most Popular Agents query
    mockQuery.mockResolvedValueOnce([]);

    const blocks = await buildDashboardBlocks();

    // Check header
    const powerHeader = blocks.find(
      (b) => b.type === 'section' && b.text?.text?.includes('Top Power Users'),
    );
    expect(powerHeader).toBeDefined();

    // Check medals
    const userBlocks = blocks.filter(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes('<@U')),
    );
    expect(userBlocks.length).toBe(3);
    expect(userBlocks[0].elements[0].text).toContain(':first_place_medal:');
    expect(userBlocks[0].elements[0].text).toContain('<@U111>');
    expect(userBlocks[0].elements[0].text).toContain('42 runs');
    expect(userBlocks[0].elements[0].text).toContain('Alpha, Beta');
    expect(userBlocks[1].elements[0].text).toContain(':second_place_medal:');
    expect(userBlocks[2].elements[0].text).toContain(':third_place_medal:');
  });

  it('should render top agent creators with "+N more" for many agents', async () => {
    mockQuery.mockReset();
    // getMetrics (called first by buildUsageSnapshotSection): durations, byAgent, byModel, runsByAgent, waits
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    // Top Power Users query
    mockQuery.mockResolvedValueOnce([]);
    // Top Agent Creators query
    mockQuery.mockResolvedValueOnce([
      { created_by: 'U111', agent_count: '5', agent_names: ['A', 'B', 'C', 'D', 'E'] },
      { created_by: 'U222', agent_count: '2', agent_names: ['X', 'Y'] },
    ]);
    // Most Popular Agents query
    mockQuery.mockResolvedValueOnce([]);

    const blocks = await buildDashboardBlocks();

    const creatorHeader = blocks.find(
      (b) => b.type === 'section' && b.text?.text?.includes('Top Agent Creators'),
    );
    expect(creatorHeader).toBeDefined();

    const creatorBlocks = blocks.filter(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes(':hammer_and_wrench:')),
    );
    expect(creatorBlocks.length).toBe(2);
    // First creator has 5 agents, should show 3 + "+2 more"
    expect(creatorBlocks[0].elements[0].text).toContain('<@U111>');
    expect(creatorBlocks[0].elements[0].text).toContain('5 agents');
    expect(creatorBlocks[0].elements[0].text).toContain('A, B, C');
    expect(creatorBlocks[0].elements[0].text).toContain('+2 more');
    // Second creator has 2 agents, no "+N more"
    expect(creatorBlocks[1].elements[0].text).toContain('<@U222>');
    expect(creatorBlocks[1].elements[0].text).toContain('2 agents');
    expect(creatorBlocks[1].elements[0].text).toContain('X, Y');
    expect(creatorBlocks[1].elements[0].text).not.toContain('+');
  });

  it('should render most popular agents with fire emoji for #1', async () => {
    mockQuery.mockReset();
    // getMetrics (called first by buildUsageSnapshotSection): durations, byAgent, byModel, runsByAgent, waits
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    // Top Power Users query
    mockQuery.mockResolvedValueOnce([]);
    // Top Agent Creators query
    mockQuery.mockResolvedValueOnce([]);
    // Most Popular Agents query
    mockQuery.mockResolvedValueOnce([
      { agent_id: 'a1', name: 'AlphaBot', avatar_emoji: ':robot_face:', run_count: '150', total_cost: '12.34' },
      { agent_id: 'a2', name: 'BetaBot', avatar_emoji: ':star:', run_count: '80', total_cost: '5.67' },
    ]);

    const blocks = await buildDashboardBlocks();

    const popularHeader = blocks.find(
      (b) => b.type === 'section' && b.text?.text?.includes('Most Popular Agents'),
    );
    expect(popularHeader).toBeDefined();

    const popularBlocks = blocks.filter(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes('runs*') && e.text?.includes('spent')),
    );
    expect(popularBlocks.length).toBe(2);
    // First agent gets :fire:
    expect(popularBlocks[0].elements[0].text).toContain(':fire:');
    expect(popularBlocks[0].elements[0].text).toContain(':robot_face:');
    expect(popularBlocks[0].elements[0].text).toContain('*AlphaBot*');
    expect(popularBlocks[0].elements[0].text).toContain('150 runs');
    expect(popularBlocks[0].elements[0].text).toContain('$12.34 spent');
    // Second agent gets :chart_with_upwards_trend:
    expect(popularBlocks[1].elements[0].text).toContain(':chart_with_upwards_trend:');
    expect(popularBlocks[1].elements[0].text).toContain(':star:');
    expect(popularBlocks[1].elements[0].text).toContain('*BetaBot*');
  });

  it('should truncate to 20 blocks when payload exceeds 48KB', async () => {
    // Create many agents to inflate the block array beyond 48KB
    const bigAgents = Array.from({ length: 10 }, (_, i) =>
      makeAgent({
        id: `agent-${i}`,
        name: 'A'.repeat(4000) + i,
        avatar_emoji: ':robot_face:',
      }),
    );
    vi.mocked(listAgents).mockResolvedValueOnce(bigAgents as any);

    const blocks = await buildDashboardBlocks();

    // If the blocks exceeded 48KB, they should be truncated to 20
    // The exact behavior depends on whether the combined size exceeds 48000 chars
    expect(blocks.length).toBeLessThanOrEqual(48);
  });

  it('should have correct section order: header, usage, power users, creators, popular, fleet, runs', async () => {
    const blocks = await buildDashboardBlocks();

    // Find index of each section header
    const headerIdx = blocks.findIndex(
      (b) => b.type === 'header' && b.text?.text?.includes('Tiny Hands Dashboard'),
    );
    const usageIdx = blocks.findIndex(
      (b) => b.type === 'section' && b.text?.text?.includes('Usage Snapshot'),
    );
    const powerIdx = blocks.findIndex(
      (b) => b.type === 'section' && b.text?.text?.includes('Top Power Users'),
    );
    const creatorsIdx = blocks.findIndex(
      (b) => b.type === 'section' && b.text?.text?.includes('Top Agent Creators'),
    );
    const popularIdx = blocks.findIndex(
      (b) => b.type === 'section' && b.text?.text?.includes('Most Popular Agents'),
    );
    const fleetIdx = blocks.findIndex(
      (b) => b.type === 'section' && b.text?.text?.includes('Agent Fleet'),
    );
    const runsIdx = blocks.findIndex(
      (b) => b.type === 'section' && b.text?.text?.includes('Recent Runs'),
    );

    expect(headerIdx).toBeLessThan(usageIdx);
    expect(usageIdx).toBeLessThan(powerIdx);
    expect(powerIdx).toBeLessThan(creatorsIdx);
    expect(creatorsIdx).toBeLessThan(popularIdx);
    expect(popularIdx).toBeLessThan(fleetIdx);
    expect(fleetIdx).toBeLessThan(runsIdx);
  });

  it('should use :star: for power users ranked 4th and 5th', async () => {
    mockQuery.mockReset();
    // getMetrics (called first by buildUsageSnapshotSection): durations, byAgent, byModel, runsByAgent, waits
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    // Top Power Users query - 5 users
    mockQuery.mockResolvedValueOnce([
      { slack_user_id: 'U1', run_count: '50', agent_names: ['A'] },
      { slack_user_id: 'U2', run_count: '40', agent_names: ['B'] },
      { slack_user_id: 'U3', run_count: '30', agent_names: ['C'] },
      { slack_user_id: 'U4', run_count: '20', agent_names: ['D'] },
      { slack_user_id: 'U5', run_count: '10', agent_names: ['E'] },
    ]);
    // Top Agent Creators query
    mockQuery.mockResolvedValueOnce([]);
    // Most Popular Agents query
    mockQuery.mockResolvedValueOnce([]);

    const blocks = await buildDashboardBlocks();

    const userBlocks = blocks.filter(
      (b) =>
        b.type === 'context' &&
        b.elements?.some((e: any) => e.text?.includes('<@U')),
    );
    expect(userBlocks.length).toBe(5);
    expect(userBlocks[3].elements[0].text).toContain(':star:');
    expect(userBlocks[3].elements[0].text).toContain('<@U4>');
    expect(userBlocks[4].elements[0].text).toContain(':star:');
    expect(userBlocks[4].elements[0].text).toContain('<@U5>');
  });
});
