import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAgent = vi.fn();
const mockUpdateAgent = vi.fn();
const mockCanModifyAgent = vi.fn();

vi.mock('../../src/modules/agents', () => ({
  getAgent: (...args: any[]) => mockGetAgent(...args),
  updateAgent: (...args: any[]) => mockUpdateAgent(...args),
}));

vi.mock('../../src/modules/access-control', () => ({
  canModifyAgent: (...args: any[]) => mockCanModifyAgent(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  parseModelOverride,
  stripModelOverride,
  setAgentModel,
  getAgentModel,
  getModelSummary,
} from '../../src/modules/model-selection';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseModelOverride', () => {
  it('should parse [run with opus]', () => {
    expect(parseModelOverride('Do this task [run with opus]')).toBe('opus');
  });

  it('should parse [use sonnet]', () => {
    expect(parseModelOverride('[use sonnet] analyze this')).toBe('sonnet');
  });

  it('should parse [run with haiku]', () => {
    expect(parseModelOverride('Quick task [run with haiku]')).toBe('haiku');
  });

  it('should return null when no override present', () => {
    expect(parseModelOverride('Regular task without override')).toBeNull();
  });

  it('should be case insensitive', () => {
    expect(parseModelOverride('[Run With Opus]')).toBe('opus');
    expect(parseModelOverride('[USE HAIKU]')).toBe('haiku');
  });
});

describe('stripModelOverride', () => {
  it('should strip override from message', () => {
    expect(stripModelOverride('Do this [run with opus]')).toBe('Do this');
  });

  it('should strip [use ...] patterns', () => {
    expect(stripModelOverride('[use haiku] task')).toBe('task');
  });

  it('should leave message unchanged when no override', () => {
    expect(stripModelOverride('Normal task')).toBe('Normal task');
  });

  it('should strip case-insensitively', () => {
    expect(stripModelOverride('test [RUN WITH SONNET] end')).toBe('test  end');
  });
});

describe('setAgentModel', () => {
  it('should update the agent model', async () => {
    mockCanModifyAgent.mockResolvedValue(true);

    const result = await setAgentModel('a1', 'opus', 'U1');
    expect(result.model).toBe('opus');
    expect(mockUpdateAgent).toHaveBeenCalledWith('a1', { model: 'opus' }, 'U1');
  });

  it('should return warning for haiku', async () => {
    mockCanModifyAgent.mockResolvedValue(true);

    const result = await setAgentModel('a1', 'haiku', 'U1');
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('Haiku');
  });

  it('should return no warning for sonnet', async () => {
    mockCanModifyAgent.mockResolvedValue(true);

    const result = await setAgentModel('a1', 'sonnet', 'U1');
    expect(result.warning).toBeUndefined();
  });

  it('should throw on insufficient permissions', async () => {
    mockCanModifyAgent.mockResolvedValue(false);

    await expect(setAgentModel('a1', 'opus', 'U1')).rejects.toThrow('Insufficient permissions');
  });

  it('should throw on invalid model', async () => {
    mockCanModifyAgent.mockResolvedValue(true);

    await expect(setAgentModel('a1', 'gpt4' as any, 'U1')).rejects.toThrow('Invalid model');
  });
});

describe('getAgentModel', () => {
  it('should return model info', async () => {
    mockGetAgent.mockResolvedValue({ id: 'a1', model: 'sonnet' });

    const result = await getAgentModel('a1');
    expect(result.model).toBe('sonnet');
    expect(result.modelId).toBeDefined();
    expect(result.info.bestFor).toContain('General');
  });

  it('should throw if agent not found', async () => {
    mockGetAgent.mockResolvedValue(null);

    await expect(getAgentModel('missing')).rejects.toThrow('not found');
  });

  it('should return warning for haiku model', async () => {
    mockGetAgent.mockResolvedValue({ id: 'a1', model: 'haiku' });

    const result = await getAgentModel('a1');
    expect(result.info.warning).toBeDefined();
  });
});

describe('getModelSummary', () => {
  it('should return all 3 models', () => {
    const summary = getModelSummary();
    expect(summary).toHaveLength(3);
    expect(summary.map(s => s.alias)).toEqual(['opus', 'sonnet', 'haiku']);
  });

  it('should include modelId for each', () => {
    const summary = getModelSummary();
    for (const s of summary) {
      expect(s.modelId).toBeDefined();
      expect(s.modelId.length).toBeGreaterThan(0);
    }
  });

  it('should include bestFor for each', () => {
    const summary = getModelSummary();
    for (const s of summary) {
      expect(s.bestFor).toBeDefined();
    }
  });

  it('should only have warning on haiku', () => {
    const summary = getModelSummary();
    const haiku = summary.find(s => s.alias === 'haiku');
    const others = summary.filter(s => s.alias !== 'haiku');

    expect(haiku?.warning).toBeDefined();
    for (const s of others) {
      expect(s.warning).toBeUndefined();
    }
  });
});
