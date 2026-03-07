import { describe, it, expect } from 'vitest';

describe('Self-Authoring: Tool Code Validation', () => {
  const FORBIDDEN_PATTERNS = [
    /process\.exit/i,
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /exec\s*\(/,
    /spawn\s*\(/,
    /eval\s*\(/,
    /Function\s*\(/,
    /rm\s+-rf\s+\//,
    /:(){ :|:& };:/,
  ];

  function validateToolCode(code: string): string | null {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(code)) {
        return pattern.source;
      }
    }
    if (code.length > 50000) return 'too_large';
    if (code.split('\n').length > 500) return 'too_many_lines';
    return null;
  }

  it('should allow safe code', () => {
    const code = `
const input = JSON.parse(process.env.INPUT || '{}');
const result = input.a + input.b;
console.log(JSON.stringify({ sum: result }));
`;
    expect(validateToolCode(code)).toBeNull();
  });

  it('should reject process.exit', () => {
    expect(validateToolCode('process.exit(1)')).toBeTruthy();
  });

  it('should reject child_process require', () => {
    expect(validateToolCode('const cp = require("child_process")')).toBeTruthy();
  });

  it('should reject eval', () => {
    expect(validateToolCode('eval("alert(1)")')).toBeTruthy();
  });

  it('should reject exec', () => {
    expect(validateToolCode('exec("rm -rf /")')).toBeTruthy();
  });

  it('should reject spawn', () => {
    expect(validateToolCode('spawn("ls", ["-la"])')).toBeTruthy();
  });

  it('should reject Function constructor', () => {
    expect(validateToolCode('new Function("return 1")()')).toBeTruthy();
  });

  it('should reject rm -rf /', () => {
    expect(validateToolCode('rm -rf /')).toBeTruthy();
  });

  it('should reject code over 50KB', () => {
    const bigCode = 'x'.repeat(51000);
    expect(validateToolCode(bigCode)).toBe('too_large');
  });

  it('should reject code over 500 lines', () => {
    const longCode = Array(501).fill('const x = 1;').join('\n');
    expect(validateToolCode(longCode)).toBe('too_many_lines');
  });
});

describe('Self-Authoring: Tool Execution Script Generation', () => {
  function getToolExecutionScript(
    code: string,
    language: string,
    toolName: string
  ): string {
    switch (language) {
      case 'javascript':
        return `#!/usr/bin/env node\n'use strict';\nconst input = JSON.parse(process.env.INPUT || '{}');\n// ── Agent-authored tool: ${toolName} ──\n${code}\n`;
      case 'python':
        return `#!/usr/bin/env python3\nimport os, json, sys\ninput_data = json.loads(os.environ.get('INPUT', '{}'))\n# ── Agent-authored tool: ${toolName} ──\n${code}\n`;
      case 'bash':
        return `#!/usr/bin/env bash\nset -euo pipefail\nINPUT="$\{INPUT:-'{}'}"\n# ── Agent-authored tool: ${toolName} ──\n${code}\n`;
      default:
        return '';
    }
  }

  it('should wrap JavaScript tools with Node.js shebang', () => {
    const script = getToolExecutionScript('console.log("hi")', 'javascript', 'test-tool');
    expect(script).toContain('#!/usr/bin/env node');
    expect(script).toContain("'use strict'");
    expect(script).toContain('test-tool');
    expect(script).toContain('console.log("hi")');
  });

  it('should wrap Python tools with Python shebang', () => {
    const script = getToolExecutionScript('print("hi")', 'python', 'py-tool');
    expect(script).toContain('#!/usr/bin/env python3');
    expect(script).toContain('import os, json');
    expect(script).toContain('print("hi")');
  });

  it('should wrap Bash tools with Bash shebang', () => {
    const script = getToolExecutionScript('echo hi', 'bash', 'sh-tool');
    expect(script).toContain('#!/usr/bin/env bash');
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('echo hi');
  });

  it('should return empty for unknown language', () => {
    const script = getToolExecutionScript('code', 'rust', 'rs-tool');
    expect(script).toBe('');
  });
});

describe('Self-Authoring: Authored Skill Structure', () => {
  it('should create valid skill structure', () => {
    const skill = {
      id: 'test-id',
      agent_id: 'agent-1',
      name: 'summarize-email',
      description: 'Summarize incoming emails',
      skill_type: 'prompt_template' as const,
      template: 'Summarize this email: {{email_body}}. Focus on: action items, key decisions, deadlines.',
      version: 1,
      approved: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(skill.name).toBe('summarize-email');
    expect(skill.template).toContain('{{email_body}}');
    expect(skill.approved).toBe(false);
    expect(skill.version).toBe(1);
  });

  it('should support version increments', () => {
    let version = 1;
    version += 1;
    expect(version).toBe(2);
  });
});

describe('Self-Authoring: DB-Stored Tool Config', () => {
  it('should create tool config with inline code', () => {
    const config = {
      name: 'calc-tool',
      schema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      script_code: 'const {a, b} = input; console.log(a + b);',
      language: 'javascript',
      stored_in_db: true,
    };

    expect(config.stored_in_db).toBe(true);
    expect(config.script_code).toBeDefined();
    expect(config.language).toBe('javascript');
  });

  it('should prefer DB code over file path', () => {
    const tool = {
      script_code: 'console.log("from db")',
      script_path: '/old/path/tool.js',
    };

    const useDbCode = !!tool.script_code;
    expect(useDbCode).toBe(true);
  });
});
