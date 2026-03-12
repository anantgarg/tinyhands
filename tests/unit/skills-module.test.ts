import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockCanModifyAgent = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
}));

vi.mock('../../src/modules/access-control', () => ({
  canModifyAgent: (...args: any[]) => mockCanModifyAgent(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  registerSkill,
  getSkill,
  getSkillByName,
  listSkills,
  updateSkill,
  attachSkillToAgent,
  detachSkillFromAgent,
  getAgentSkills,
  getAvailableSkills,
} from '../../src/modules/skills';

// ── Helpers ──

function makeSkill(overrides: Partial<{
  id: string;
  name: string;
  skill_type: string;
  config_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}> = {}) {
  return {
    id: overrides.id ?? 'skill-1',
    name: overrides.name ?? 'test-skill',
    skill_type: overrides.skill_type ?? 'mcp',
    config_json: overrides.config_json ?? '{}',
    version: overrides.version ?? 1,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00.000Z',
  };
}

// ── Tests ──

describe('Skills Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────
  // registerSkill
  // ────────────────────────────────────────────

  describe('registerSkill', () => {
    it('should insert a new skill into the database and return it', async () => {
      const config = { endpoint: 'https://api.example.com' };
      const skill = await registerSkill('my-skill', 'mcp', config);

      expect(skill.name).toBe('my-skill');
      expect(skill.skill_type).toBe('mcp');
      expect(skill.config_json).toBe(JSON.stringify(config));
      expect(skill.version).toBe(1);
      expect(skill.id).toBeDefined();
      expect(skill.created_at).toBeDefined();
      expect(skill.updated_at).toBeDefined();

      // Verify DB call
      expect(mockExecute).toHaveBeenCalledOnce();
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('INSERT INTO skills');
      expect(params).toHaveLength(7);
      expect(params[1]).toBe('my-skill');
      expect(params[2]).toBe('mcp');
      expect(params[3]).toBe(JSON.stringify(config));
      expect(params[4]).toBe(1);
    });

    it('should generate a unique UUID for each skill', async () => {
      const skill1 = await registerSkill('a', 'mcp', {});
      const skill2 = await registerSkill('b', 'mcp', {});

      expect(skill1.id).not.toBe(skill2.id);
    });

    it('should support prompt_template skill type', async () => {
      const config = { template: 'Do the thing' };
      const skill = await registerSkill('prompter', 'prompt_template', config);

      expect(skill.skill_type).toBe('prompt_template');
      expect(JSON.parse(skill.config_json)).toEqual(config);
    });

    it('should handle empty config object', async () => {
      const skill = await registerSkill('empty-config', 'mcp', {});

      expect(skill.config_json).toBe('{}');
    });

    it('should handle config with nested objects', async () => {
      const config = { auth: { type: 'oauth', scopes: ['read', 'write'] }, url: 'https://x.com' };
      const skill = await registerSkill('nested', 'mcp', config);

      expect(JSON.parse(skill.config_json)).toEqual(config);
    });
  });

  // ────────────────────────────────────────────
  // getSkill
  // ────────────────────────────────────────────

  describe('getSkill', () => {
    it('should return the skill when found', async () => {
      const dbRow = makeSkill({ id: 'abc-123' });
      mockQueryOne.mockResolvedValueOnce(dbRow);

      const result = await getSkill('abc-123');

      expect(result).toEqual(dbRow);
      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT * FROM skills WHERE id = $1',
        ['abc-123']
      );
    });

    it('should return null when skill is not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await getSkill('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when queryOne returns null', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getSkill('nope');

      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────
  // getSkillByName
  // ────────────────────────────────────────────

  describe('getSkillByName', () => {
    it('should return the skill when found by name', async () => {
      const dbRow = makeSkill({ name: 'linear' });
      mockQueryOne.mockResolvedValueOnce(dbRow);

      const result = await getSkillByName('linear');

      expect(result).toEqual(dbRow);
      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT * FROM skills WHERE name = $1',
        ['linear']
      );
    });

    it('should return null when no skill matches the name', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await getSkillByName('does-not-exist');

      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────
  // listSkills
  // ────────────────────────────────────────────

  describe('listSkills', () => {
    it('should return all skills when no type is specified', async () => {
      const skills = [makeSkill({ name: 'a' }), makeSkill({ name: 'b' })];
      mockQuery.mockResolvedValueOnce(skills);

      const result = await listSkills();

      expect(result).toEqual(skills);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM skills ORDER BY name'
      );
    });

    it('should filter by skill type when provided', async () => {
      const skills = [makeSkill({ skill_type: 'mcp' })];
      mockQuery.mockResolvedValueOnce(skills);

      const result = await listSkills('mcp');

      expect(result).toEqual(skills);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM skills WHERE skill_type = $1 ORDER BY name',
        ['mcp']
      );
    });

    it('should filter by prompt_template type', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await listSkills('prompt_template');

      expect(result).toEqual([]);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM skills WHERE skill_type = $1 ORDER BY name',
        ['prompt_template']
      );
    });

    it('should return empty array when no skills exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await listSkills();

      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────
  // updateSkill
  // ────────────────────────────────────────────

  describe('updateSkill', () => {
    it('should update config and bump version', async () => {
      const existing = makeSkill({ id: 'u-1', version: 3 });
      const updated = makeSkill({ id: 'u-1', version: 4, config_json: '{"new":true}' });

      // First call: getSkill before update, Second call: getSkill after update
      mockQueryOne
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);

      const result = await updateSkill('u-1', { new: true });

      expect(result).toEqual(updated);
      expect(mockExecute).toHaveBeenCalledOnce();
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('UPDATE skills SET config_json');
      expect(sql).toContain('version = version + 1');
      expect(params).toEqual([JSON.stringify({ new: true }), 'u-1']);
    });

    it('should throw when skill does not exist', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      await expect(updateSkill('missing', {})).rejects.toThrow('Skill missing not found');
    });

    it('should re-fetch and return the updated skill', async () => {
      const existing = makeSkill({ id: 's-99', version: 1, config_json: '{"old":true}' });
      const afterUpdate = makeSkill({ id: 's-99', version: 2, config_json: '{"replaced":true}' });

      mockQueryOne
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(afterUpdate);

      const result = await updateSkill('s-99', { replaced: true });

      expect(result.version).toBe(2);
      expect(JSON.parse(result.config_json)).toEqual({ replaced: true });
      // Two queryOne calls: one for existence check, one for re-fetch
      expect(mockQueryOne).toHaveBeenCalledTimes(2);
    });
  });

  // ────────────────────────────────────────────
  // attachSkillToAgent
  // ────────────────────────────────────────────

  describe('attachSkillToAgent', () => {
    it('should throw when user lacks permission', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(false);

      await expect(
        attachSkillToAgent('agent-1', 'linear', 'read', 'user-x')
      ).rejects.toThrow('Insufficient permissions to attach skill');

      expect(mockCanModifyAgent).toHaveBeenCalledWith('agent-1', 'user-x');
    });

    it('should attach an existing skill to an agent', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      const existingSkill = makeSkill({ id: 'sk-1', name: 'existing-tool' });
      mockQueryOne.mockResolvedValueOnce(existingSkill); // getSkillByName

      const result = await attachSkillToAgent('agent-1', 'existing-tool', 'read', 'user-1');

      expect(result.agent_id).toBe('agent-1');
      expect(result.skill_id).toBe('sk-1');
      expect(result.permission_level).toBe('read');
      expect(result.attached_by).toBe('user-1');
      expect(result.attached_at).toBeDefined();

      // Should upsert into agent_skills
      expect(mockExecute).toHaveBeenCalledOnce();
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain('INSERT INTO agent_skills');
      expect(sql).toContain('ON CONFLICT');
    });

    it('should auto-create a built-in MCP skill if not found in DB', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(undefined); // getSkillByName returns null

      const result = await attachSkillToAgent('agent-1', 'linear', 'write', 'user-1');

      // registerSkill should have been called (execute for INSERT INTO skills)
      // then another execute for INSERT INTO agent_skills
      expect(mockExecute).toHaveBeenCalledTimes(2);

      // First execute: INSERT INTO skills
      const [skillSql, skillParams] = mockExecute.mock.calls[0];
      expect(skillSql).toContain('INSERT INTO skills');
      expect(skillParams[1]).toBe('linear'); // name
      expect(skillParams[2]).toBe('mcp');    // skill_type
      const configInserted = JSON.parse(skillParams[3]);
      expect(configInserted.builtin).toBe(true);
      expect(configInserted.name).toBe('Linear');
      expect(configInserted.capabilities).toContain('Read issues');

      // Result
      expect(result.permission_level).toBe('write');
    });

    it('should auto-create a built-in prompt skill if not found in DB', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(undefined); // getSkillByName returns null

      const result = await attachSkillToAgent('agent-1', 'ticket-triage', 'read', 'user-1');

      expect(mockExecute).toHaveBeenCalledTimes(2);

      const [skillSql, skillParams] = mockExecute.mock.calls[0];
      expect(skillSql).toContain('INSERT INTO skills');
      expect(skillParams[2]).toBe('prompt_template');
      const config = JSON.parse(skillParams[3]);
      expect(config.builtin).toBe(true);
      expect(config.name).toBe('Ticket Triage');
      expect(config.template).toContain('severity');

      expect(result.agent_id).toBe('agent-1');
    });

    it('should throw when skill name is not found and not a builtin', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(undefined); // getSkillByName returns null

      await expect(
        attachSkillToAgent('agent-1', 'unknown-skill', 'read', 'user-1')
      ).rejects.toThrow('Skill "unknown-skill" not found');
    });

    it('should use write permission level', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      const existingSkill = makeSkill({ id: 'sk-w', name: 'writer' });
      mockQueryOne.mockResolvedValueOnce(existingSkill);

      const result = await attachSkillToAgent('agent-2', 'writer', 'write', 'user-1');

      expect(result.permission_level).toBe('write');
    });

    it('should use admin permission level', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      const existingSkill = makeSkill({ id: 'sk-a', name: 'admin-skill' });
      mockQueryOne.mockResolvedValueOnce(existingSkill);

      const result = await attachSkillToAgent('agent-3', 'admin-skill', 'admin', 'user-1');

      expect(result.permission_level).toBe('admin');
    });

    it('should upsert — updating permission if skill already attached', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      const existingSkill = makeSkill({ id: 'sk-dup', name: 'dup-skill' });
      mockQueryOne.mockResolvedValueOnce(existingSkill);

      await attachSkillToAgent('agent-1', 'dup-skill', 'admin', 'user-1');

      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain('ON CONFLICT (agent_id, skill_id) DO UPDATE');
      expect(sql).toContain('permission_level = EXCLUDED.permission_level');
    });

    it('should handle case-insensitive builtin MCP skill lookup', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(undefined);

      // Pass "Linear" with capital L — the code lowercases for builtin lookup
      const result = await attachSkillToAgent('agent-1', 'Linear', 'read', 'user-1');

      // Should still auto-create because BUILTIN_MCP_SKILLS uses lowercase keys
      // and the code does skillName.toLowerCase()
      expect(mockExecute).toHaveBeenCalledTimes(2);
      expect(result.agent_id).toBe('agent-1');
    });

    it('should handle case-insensitive builtin prompt skill lookup', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await attachSkillToAgent('agent-1', 'Company-Research', 'read', 'user-1');

      expect(mockExecute).toHaveBeenCalledTimes(2);
      const [, skillParams] = mockExecute.mock.calls[0];
      expect(skillParams[2]).toBe('prompt_template');
    });

    it('should auto-create each builtin MCP skill correctly', async () => {
      const builtinNames = ['linear', 'zendesk', 'notion', 'slack', 'github'];

      for (const name of builtinNames) {
        vi.clearAllMocks();
        mockCanModifyAgent.mockResolvedValueOnce(true);
        mockQueryOne.mockResolvedValueOnce(undefined);

        await attachSkillToAgent('agent-1', name, 'read', 'user-1');

        expect(mockExecute).toHaveBeenCalledTimes(2);
        const skillParams = mockExecute.mock.calls[0][1];
        expect(skillParams[2]).toBe('mcp');
        const config = JSON.parse(skillParams[3]);
        expect(config.builtin).toBe(true);
        expect(config.capabilities).toBeDefined();
        expect(config.capabilities.length).toBeGreaterThan(0);
      }
    });

    it('should auto-create each builtin prompt skill correctly', async () => {
      const builtinNames = ['company-research', 'ticket-triage', 'code-review', 'lead-enrichment', 'document-filling'];

      for (const name of builtinNames) {
        vi.clearAllMocks();
        mockCanModifyAgent.mockResolvedValueOnce(true);
        mockQueryOne.mockResolvedValueOnce(undefined);

        await attachSkillToAgent('agent-1', name, 'read', 'user-1');

        expect(mockExecute).toHaveBeenCalledTimes(2);
        const skillParams = mockExecute.mock.calls[0][1];
        expect(skillParams[2]).toBe('prompt_template');
        const config = JSON.parse(skillParams[3]);
        expect(config.builtin).toBe(true);
        expect(config.template).toBeDefined();
        expect(config.description).toBeDefined();
      }
    });
  });

  // ────────────────────────────────────────────
  // detachSkillFromAgent
  // ────────────────────────────────────────────

  describe('detachSkillFromAgent', () => {
    it('should throw when user lacks permission', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(false);

      await expect(
        detachSkillFromAgent('agent-1', 'skill-1', 'user-x')
      ).rejects.toThrow('Insufficient permissions to detach skill');

      expect(mockCanModifyAgent).toHaveBeenCalledWith('agent-1', 'user-x');
    });

    it('should delete the agent-skill link when authorized', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);

      await detachSkillFromAgent('agent-1', 'skill-1', 'user-1');

      expect(mockExecute).toHaveBeenCalledWith(
        'DELETE FROM agent_skills WHERE agent_id = $1 AND skill_id = $2',
        ['agent-1', 'skill-1']
      );
    });

    it('should not throw when deleting a non-existent attachment', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);

      // The DELETE will simply affect 0 rows, which is fine
      await expect(
        detachSkillFromAgent('agent-1', 'nonexistent', 'user-1')
      ).resolves.toBeUndefined();
    });
  });

  // ────────────────────────────────────────────
  // getAgentSkills
  // ────────────────────────────────────────────

  describe('getAgentSkills', () => {
    it('should return skills joined with permission level', async () => {
      const rows = [
        { ...makeSkill({ id: 's1', name: 'alpha' }), permission_level: 'read' },
        { ...makeSkill({ id: 's2', name: 'beta' }), permission_level: 'write' },
      ];
      mockQuery.mockResolvedValueOnce(rows);

      const result = await getAgentSkills('agent-1');

      expect(result).toEqual(rows);
      expect(result).toHaveLength(2);
      expect(result[0].permission_level).toBe('read');
      expect(result[1].permission_level).toBe('write');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('JOIN skills s ON asl.skill_id = s.id');
      expect(sql).toContain('WHERE asl.agent_id = $1');
      expect(params).toEqual(['agent-1']);
    });

    it('should return empty array when agent has no skills', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getAgentSkills('lonely-agent');

      expect(result).toEqual([]);
    });

    it('should order results by skill name', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getAgentSkills('agent-1');

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('ORDER BY s.name');
    });
  });

  // ────────────────────────────────────────────
  // getAvailableSkills
  // ────────────────────────────────────────────

  describe('getAvailableSkills', () => {
    it('should return builtin MCP and prompt skills', () => {
      const result = getAvailableSkills();

      expect(result.mcp).toBeDefined();
      expect(result.prompt).toBeDefined();
      expect(Array.isArray(result.mcp)).toBe(true);
      expect(Array.isArray(result.prompt)).toBe(true);
    });

    it('should include all 5 MCP skills', () => {
      const { mcp } = getAvailableSkills();

      expect(mcp).toHaveLength(5);
      const names = mcp.map(s => s.name);
      expect(names).toContain('linear');
      expect(names).toContain('zendesk');
      expect(names).toContain('notion');
      expect(names).toContain('slack');
      expect(names).toContain('github');
    });

    it('should include all 5 prompt skills', () => {
      const { prompt } = getAvailableSkills();

      expect(prompt).toHaveLength(5);
      const names = prompt.map(s => s.name);
      expect(names).toContain('company-research');
      expect(names).toContain('ticket-triage');
      expect(names).toContain('code-review');
      expect(names).toContain('lead-enrichment');
      expect(names).toContain('document-filling');
    });

    it('should return capabilities for each MCP skill', () => {
      const { mcp } = getAvailableSkills();

      for (const skill of mcp) {
        expect(skill.capabilities).toBeDefined();
        expect(Array.isArray(skill.capabilities)).toBe(true);
        expect(skill.capabilities.length).toBeGreaterThan(0);
      }
    });

    it('should return descriptions for each prompt skill', () => {
      const { prompt } = getAvailableSkills();

      for (const skill of prompt) {
        expect(skill.description).toBeDefined();
        expect(typeof skill.description).toBe('string');
        expect(skill.description.length).toBeGreaterThan(0);
      }
    });

    it('should not make any DB calls (pure function)', () => {
      getAvailableSkills();

      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockQueryOne).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should return specific capabilities for linear', () => {
      const { mcp } = getAvailableSkills();
      const linear = mcp.find(s => s.name === 'linear');

      expect(linear).toBeDefined();
      expect(linear!.capabilities).toContain('Read issues');
      expect(linear!.capabilities).toContain('Create issues');
      expect(linear!.capabilities).toContain('Update status');
    });

    it('should return specific capabilities for github', () => {
      const { mcp } = getAvailableSkills();
      const github = mcp.find(s => s.name === 'github');

      expect(github).toBeDefined();
      expect(github!.capabilities).toContain('Create PRs');
      expect(github!.capabilities).toContain('Comment on issues');
      expect(github!.capabilities).toContain('Read code');
    });

    it('should be stable across multiple calls', () => {
      const result1 = getAvailableSkills();
      const result2 = getAvailableSkills();

      expect(result1).toEqual(result2);
    });
  });
});
