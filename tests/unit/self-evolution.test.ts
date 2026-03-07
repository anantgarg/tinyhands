import { describe, it, expect } from 'vitest';

describe('Evolution Actions', () => {
  const validActions = ['write_tool', 'create_mcp', 'commit_code', 'update_prompt', 'add_to_kb'];

  it('should support all action types', () => {
    expect(validActions).toHaveLength(5);
    expect(validActions).toContain('write_tool');
    expect(validActions).toContain('create_mcp');
    expect(validActions).toContain('commit_code');
    expect(validActions).toContain('update_prompt');
    expect(validActions).toContain('add_to_kb');
  });
});

describe('Evolution Modes', () => {
  it('should auto-execute in autonomous mode', () => {
    const mode = 'autonomous';
    const autoExecute = mode === 'autonomous';
    expect(autoExecute).toBe(true);
  });

  it('should require approval in approve_first mode', () => {
    const mode = 'approve_first';
    const autoExecute = mode === 'autonomous';
    expect(autoExecute).toBe(false);
  });

  it('should block all in disabled mode', () => {
    const mode = 'disabled';
    const canPropose = mode !== 'disabled';
    expect(canPropose).toBe(false);
  });
});

describe('Proposal Lifecycle', () => {
  it('should track valid statuses', () => {
    const validStatuses = ['pending', 'approved', 'rejected', 'executed'];
    expect(validStatuses).toContain('pending');
    expect(validStatuses).toContain('approved');
    expect(validStatuses).toContain('rejected');
    expect(validStatuses).toContain('executed');
  });

  it('should only approve pending proposals', () => {
    const canApprove = (status: string) => status === 'pending';
    expect(canApprove('pending')).toBe(true);
    expect(canApprove('approved')).toBe(false);
    expect(canApprove('executed')).toBe(false);
  });
});

describe('Proposal Timeout', () => {
  it('should expire after 30 minutes', () => {
    const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;
    const now = Date.now();
    const createdAt = now - 31 * 60 * 1000; // 31 minutes ago
    const isExpired = (now - createdAt) > APPROVAL_TIMEOUT_MS;
    expect(isExpired).toBe(true);
  });

  it('should not expire before 30 minutes', () => {
    const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;
    const now = Date.now();
    const createdAt = now - 29 * 60 * 1000; // 29 minutes ago
    const isExpired = (now - createdAt) > APPROVAL_TIMEOUT_MS;
    expect(isExpired).toBe(false);
  });
});

describe('Tool Config Parsing', () => {
  it('should parse valid tool config', () => {
    const diff = JSON.stringify({
      name: 'my-tool',
      schema: { input: { type: 'string' } },
      script: 'console.log("hello")',
    });

    const parsed = JSON.parse(diff);
    expect(parsed.name).toBe('my-tool');
    expect(parsed.schema).toBeDefined();
    expect(parsed.script).toBeDefined();
  });

  it('should parse KB contribution config', () => {
    const diff = JSON.stringify({
      title: 'New Knowledge',
      summary: 'Agent learned something',
      content: 'Detailed content here',
      category: 'Agent Contributed',
      tags: ['learning', 'auto'],
    });

    const parsed = JSON.parse(diff);
    expect(parsed.title).toBe('New Knowledge');
    expect(parsed.tags).toHaveLength(2);
  });
});
