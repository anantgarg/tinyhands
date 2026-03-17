import { describe, it, expect } from 'vitest';
import { getBuiltinSkills } from '../../src/modules/skills/builtins';
import type { SkillManifest } from '../../src/modules/skills/manifest';

describe('Skill Builtins Auto-Discovery', () => {
  it('should have exactly 10 builtin skills', () => {
    const skills = getBuiltinSkills();
    expect(skills).toHaveLength(10);
  });

  it('should have required fields on every skill', () => {
    for (const skill of getBuiltinSkills()) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.skillType).toBeTruthy();
    }
  });

  it('should have capabilities arrays on MCP skills', () => {
    const mcpSkills = getBuiltinSkills().filter(s => s.skillType === 'mcp');
    expect(mcpSkills.length).toBe(5);
    for (const skill of mcpSkills) {
      expect((skill as any).capabilities).toBeDefined();
      expect(Array.isArray((skill as any).capabilities)).toBe(true);
      expect((skill as any).capabilities.length).toBeGreaterThan(0);
    }
  });

  it('should have description and template on prompt skills', () => {
    const promptSkills = getBuiltinSkills().filter(s => s.skillType === 'prompt_template');
    expect(promptSkills.length).toBe(5);
    for (const skill of promptSkills) {
      expect((skill as any).description).toBeTruthy();
      expect((skill as any).template).toBeTruthy();
    }
  });

  it('should have unique IDs across all skills', () => {
    const ids = getBuiltinSkills().map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should include specific MCP skills by id', () => {
    const ids = getBuiltinSkills().map(s => s.id);
    for (const expected of ['linear', 'zendesk', 'notion', 'slack', 'github']) {
      expect(ids).toContain(expected);
    }
  });

  it('should include specific prompt skills by id', () => {
    const ids = getBuiltinSkills().map(s => s.id);
    for (const expected of ['company-research', 'ticket-triage', 'code-review', 'lead-enrichment', 'document-filling']) {
      expect(ids).toContain(expected);
    }
  });

  it('should have correct data for linear skill', () => {
    const linear = getBuiltinSkills().find(s => s.id === 'linear')!;
    expect(linear.name).toBe('Linear');
    expect(linear.skillType).toBe('mcp');
    expect((linear as any).capabilities).toContain('Read issues');
  });

  it('should have correct data for company-research skill', () => {
    const cr = getBuiltinSkills().find(s => s.id === 'company-research')!;
    expect(cr.name).toBe('Company Research');
    expect(cr.skillType).toBe('prompt_template');
    expect((cr as any).description).toBe('Research a company and return a structured summary');
    expect((cr as any).template).toContain('{{company}}');
  });
});
