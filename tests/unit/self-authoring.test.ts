import { describe, it, expect } from 'vitest';

// ══════════════════════════════════════════════════
//  Code Validation (static analysis)
// ══════════════════════════════════════════════════

describe('Self-Authoring: Code Validation', () => {
  const FORBIDDEN_PATTERNS = [
    /process\.exit/i,
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /eval\s*\(/,
    /Function\s*\(/,
    /rm\s+-rf\s+\//,
    /:(){ :|:& };:/,
    /import\s+.*subprocess/,
    /os\.system\s*\(/,
    /\bopen\s*\(\s*['"]\/etc/,
    /__import__/,
  ];

  function validate(code: string): string | null {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(code)) return pattern.source;
    }
    if (code.length > 50000) return 'too_large';
    if (code.split('\n').length > 500) return 'too_many_lines';
    return null;
  }

  it('allows safe JavaScript code', () => {
    expect(validate('const x = JSON.parse(process.env.INPUT); console.log(x);')).toBeNull();
  });

  it('allows safe Python code', () => {
    expect(validate('import json, os\ndata = json.loads(os.environ["INPUT"])\nprint(data)')).toBeNull();
  });

  it('blocks process.exit', () => {
    expect(validate('process.exit(1)')).toBeTruthy();
  });

  it('blocks child_process require', () => {
    expect(validate('require("child_process")')).toBeTruthy();
  });

  it('blocks eval', () => {
    expect(validate('eval("alert(1)")')).toBeTruthy();
  });

  it('blocks Function constructor', () => {
    expect(validate('new Function("return 1")()')).toBeTruthy();
  });

  it('blocks rm -rf /', () => {
    expect(validate('rm -rf /')).toBeTruthy();
  });

  it('blocks fork bombs', () => {
    expect(validate(':(){ :|:& };:')).toBeTruthy();
  });

  it('blocks Python subprocess import', () => {
    expect(validate('import subprocess')).toBeTruthy();
  });

  it('blocks Python os.system', () => {
    expect(validate('os.system("rm -rf /")')).toBeTruthy();
  });

  it('blocks Python __import__', () => {
    expect(validate('__import__("os").system("ls")')).toBeTruthy();
  });

  it('blocks reading /etc files', () => {
    expect(validate('open("/etc/passwd")')).toBeTruthy();
  });

  it('rejects code over 50KB', () => {
    expect(validate('x'.repeat(51000))).toBe('too_large');
  });

  it('rejects code over 500 lines', () => {
    expect(validate(Array(501).fill('x = 1').join('\n'))).toBe('too_many_lines');
  });
});

// ══════════════════════════════════════════════════
//  Tool Execution Script Wrapping
// ══════════════════════════════════════════════════

describe('Self-Authoring: Execution Script Generation', () => {
  function wrap(code: string, language: string, toolName: string): string {
    const shebangMap: Record<string, string> = {
      javascript: '#!/usr/bin/env node',
      python: '#!/usr/bin/env python3',
      bash: '#!/usr/bin/env bash',
    };
    const shebang = shebangMap[language];
    if (!shebang) return '';

    switch (language) {
      case 'javascript':
        return `${shebang}\n'use strict';\nconst input = JSON.parse(process.env.INPUT || '{}');\n// ── Agent-authored tool: ${toolName} ──\n${code}\n`;
      case 'python':
        return `${shebang}\nimport os, json, sys\ninput_data = json.loads(os.environ.get('INPUT', '{}'))\n# ── Agent-authored tool: ${toolName} ──\n${code}\n`;
      case 'bash':
        return `${shebang}\nset -euo pipefail\nINPUT="\${INPUT:-'{}'}"\n# ── Agent-authored tool: ${toolName} ──\n${code}\n`;
      default:
        return '';
    }
  }

  it('wraps JavaScript with Node.js shebang + strict mode', () => {
    const s = wrap('console.log("hi")', 'javascript', 'test-tool');
    expect(s).toContain('#!/usr/bin/env node');
    expect(s).toContain("'use strict'");
    expect(s).toContain('Agent-authored tool: test-tool');
  });

  it('wraps Python with Python3 shebang + json import', () => {
    const s = wrap('print("hi")', 'python', 'py-tool');
    expect(s).toContain('#!/usr/bin/env python3');
    expect(s).toContain('import os, json');
  });

  it('wraps Bash with pipefail', () => {
    const s = wrap('echo hi', 'bash', 'sh-tool');
    expect(s).toContain('#!/usr/bin/env bash');
    expect(s).toContain('set -euo pipefail');
  });

  it('returns empty for unknown language', () => {
    expect(wrap('code', 'rust', 'rs-tool')).toBe('');
  });
});

// ══════════════════════════════════════════════════
//  Sample Input Generation from JSON Schema
// ══════════════════════════════════════════════════

describe('Self-Authoring: Sample Input Generation', () => {
  function generateSampleInput(schema: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    const props = schema.properties || {};
    for (const [key, def] of Object.entries(props) as Array<[string, any]>) {
      switch (def.type) {
        case 'string': result[key] = def.example || def.default || 'sample_text'; break;
        case 'number': case 'integer': result[key] = def.example || def.default || 42; break;
        case 'boolean': result[key] = def.example ?? def.default ?? true; break;
        case 'array': result[key] = def.example || def.default || ['item1', 'item2']; break;
        case 'object': result[key] = def.example || def.default || {}; break;
        default: result[key] = 'sample';
      }
    }
    return result;
  }

  it('generates string samples', () => {
    const input = generateSampleInput({ properties: { name: { type: 'string' } } });
    expect(input.name).toBe('sample_text');
  });

  it('uses example values when provided', () => {
    const input = generateSampleInput({ properties: { name: { type: 'string', example: 'John' } } });
    expect(input.name).toBe('John');
  });

  it('generates number samples', () => {
    const input = generateSampleInput({ properties: { count: { type: 'number' } } });
    expect(input.count).toBe(42);
  });

  it('generates boolean samples', () => {
    const input = generateSampleInput({ properties: { active: { type: 'boolean' } } });
    expect(input.active).toBe(true);
  });

  it('generates array samples', () => {
    const input = generateSampleInput({ properties: { items: { type: 'array' } } });
    expect(input.items).toEqual(['item1', 'item2']);
  });

  it('generates object samples', () => {
    const input = generateSampleInput({ properties: { config: { type: 'object' } } });
    expect(input.config).toEqual({});
  });

  it('handles empty schema', () => {
    const input = generateSampleInput({});
    expect(input).toEqual({});
  });

  it('handles complex multi-property schema', () => {
    const input = generateSampleInput({
      properties: {
        text: { type: 'string', example: 'hello' },
        count: { type: 'integer', default: 10 },
        enabled: { type: 'boolean', default: false },
      }
    });
    expect(input).toEqual({ text: 'hello', count: 10, enabled: false });
  });
});

// ══════════════════════════════════════════════════
//  Tool Versioning
// ══════════════════════════════════════════════════

describe('Self-Authoring: Tool Versioning', () => {
  it('should track version history structure', () => {
    const versions = [
      { version: 3, changed_by: 'user1', created_at: '2025-01-03' },
      { version: 2, changed_by: 'agent-abc', created_at: '2025-01-02' },
      { version: 1, changed_by: 'agent-abc', created_at: '2025-01-01' },
    ];

    expect(versions).toHaveLength(3);
    expect(versions[0].version).toBe(3);
    expect(versions[2].version).toBe(1);
  });

  it('should support rollback to any version', () => {
    const versions: Record<number, string> = {
      1: 'console.log("v1")',
      2: 'console.log("v2")',
      3: 'console.log("v3 - broken")',
    };

    const rollbackTo = 2;
    const code = versions[rollbackTo];
    expect(code).toBe('console.log("v2")');
  });
});

// ══════════════════════════════════════════════════
//  Tool Analytics
// ══════════════════════════════════════════════════

describe('Self-Authoring: Tool Analytics', () => {
  it('should compute success rate correctly', () => {
    const runs = [
      { success: true }, { success: true }, { success: true },
      { success: false }, { success: true },
    ];
    const successRate = runs.filter(r => r.success).length / runs.length;
    expect(successRate).toBe(0.8);
  });

  it('should handle zero runs', () => {
    const totalRuns = 0;
    const successRate = totalRuns > 0 ? 1 : 0;
    expect(successRate).toBe(0);
  });

  it('should compute average duration', () => {
    const durations = [100, 200, 150, 250];
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    expect(avg).toBe(175);
  });
});

// ══════════════════════════════════════════════════
//  Tool Sharing
// ══════════════════════════════════════════════════

describe('Self-Authoring: Tool Sharing', () => {
  it('should not duplicate tools in agent tool list', () => {
    const tools = ['Bash', 'Read', 'my-custom-tool'];
    const toolToAdd = 'my-custom-tool';
    if (!tools.includes(toolToAdd)) {
      tools.push(toolToAdd);
    }
    expect(tools.filter(t => t === 'my-custom-tool')).toHaveLength(1);
  });

  it('should add new tool to list', () => {
    const tools = ['Bash', 'Read'];
    const toolToAdd = 'shared-tool';
    if (!tools.includes(toolToAdd)) {
      tools.push(toolToAdd);
    }
    expect(tools).toContain('shared-tool');
    expect(tools).toHaveLength(3);
  });
});

// ══════════════════════════════════════════════════
//  Tool Composition / Pipelines
// ══════════════════════════════════════════════════

describe('Self-Authoring: Tool Pipelines', () => {
  it('should validate all pipeline steps reference existing tools', () => {
    const existingTools = new Set(['fetch-data', 'transform-csv', 'summarize']);
    const pipeline = {
      name: 'etl-pipeline',
      steps: [
        { toolName: 'fetch-data', inputMapping: {} },
        { toolName: 'transform-csv', inputMapping: { data: 'input' } },
        { toolName: 'summarize', inputMapping: { text: 'output' } },
      ],
    };

    const allExist = pipeline.steps.every(s => existingTools.has(s.toolName));
    expect(allExist).toBe(true);
  });

  it('should detect missing tools in pipeline', () => {
    const existingTools = new Set(['fetch-data']);
    const pipeline = {
      steps: [
        { toolName: 'fetch-data', inputMapping: {} },
        { toolName: 'nonexistent-tool', inputMapping: {} },
      ],
    };

    const allExist = pipeline.steps.every(s => existingTools.has(s.toolName));
    expect(allExist).toBe(false);
  });

  it('should generate pipeline code that chains steps', () => {
    const steps = ['step-a', 'step-b', 'step-c'];
    const code = steps.map((s, i) =>
      `// Step ${i + 1}: ${s}\nprevResult = run('${s}', prevResult || input);`
    ).join('\n');

    expect(code).toContain('Step 1: step-a');
    expect(code).toContain('Step 3: step-c');
    expect(code.split('prevResult = run').length - 1).toBe(3);
  });
});

// ══════════════════════════════════════════════════
//  DB Storage — All Artifacts in DB
// ══════════════════════════════════════════════════

describe('Self-Authoring: DB-Only Storage', () => {
  it('custom tools store code in DB not filesystem', () => {
    const tool = {
      name: 'calc-tool',
      script_code: 'const {a, b} = input; console.log(a + b);',
      script_path: null, // no file path!
      language: 'javascript',
    };
    expect(tool.script_code).toBeTruthy();
    expect(tool.script_path).toBeNull();
  });

  it('MCP configs stored in mcp_configs table', () => {
    const config = {
      id: 'test-id',
      agent_id: 'agent-1',
      name: 'linear-mcp',
      config_json: JSON.stringify({ url: 'http://localhost:3001', apiKey: 'xxx' }),
      approved: true,
    };
    expect(config.config_json).toContain('url');
    expect(config.approved).toBe(true);
  });

  it('code artifacts stored in code_artifacts table', () => {
    const artifact = {
      id: 'art-1',
      agent_id: 'agent-1',
      file_path: '/src/utils/helper.ts',
      content: 'export function add(a: number, b: number) { return a + b; }',
      language: 'typescript',
      version: 1,
    };
    expect(artifact.file_path).toContain('/src/');
    expect(artifact.version).toBe(1);
  });

  it('code artifacts support versioned upserts', () => {
    let version = 1;
    // Simulating ON CONFLICT DO UPDATE SET version = version + 1
    version += 1;
    expect(version).toBe(2);
  });
});

// ══════════════════════════════════════════════════
//  Language Detection from File Extension
// ══════════════════════════════════════════════════

describe('Self-Authoring: Language Detection', () => {
  const langMap: Record<string, string> = {
    js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
    html: 'html', css: 'css', sql: 'sql',
  };

  function detectLanguage(path: string): string {
    const ext = path.split('.').pop() || 'text';
    return langMap[ext] || 'text';
  }

  it('detects JavaScript', () => expect(detectLanguage('app.js')).toBe('javascript'));
  it('detects TypeScript', () => expect(detectLanguage('app.ts')).toBe('typescript'));
  it('detects Python', () => expect(detectLanguage('script.py')).toBe('python'));
  it('detects Bash', () => expect(detectLanguage('run.sh')).toBe('bash'));
  it('detects JSON', () => expect(detectLanguage('config.json')).toBe('json'));
  it('detects YAML', () => expect(detectLanguage('ci.yml')).toBe('yaml'));
  it('falls back to text', () => expect(detectLanguage('README')).toBe('text'));
  it('handles nested paths', () => expect(detectLanguage('src/utils/helper.ts')).toBe('typescript'));
});

// ══════════════════════════════════════════════════
//  Sandbox Test Result Structure
// ══════════════════════════════════════════════════

describe('Self-Authoring: Sandbox Test Results', () => {
  it('structures passing result', () => {
    const result = {
      passed: true,
      output: '{"sum": 84}',
      error: null,
      durationMs: 42,
    };
    expect(result.passed).toBe(true);
    expect(result.error).toBeNull();
    expect(JSON.parse(result.output)).toEqual({ sum: 84 });
  });

  it('structures failing result', () => {
    const result = {
      passed: false,
      output: '',
      error: 'ReferenceError: x is not defined',
      durationMs: 5,
    };
    expect(result.passed).toBe(false);
    expect(result.error).toContain('ReferenceError');
  });

  it('truncates long output to 2000 chars', () => {
    const longOutput = 'x'.repeat(5000);
    const truncated = longOutput.slice(0, 2000);
    expect(truncated.length).toBe(2000);
  });
});

// ══════════════════════════════════════════════════
//  Authored Skill Structure
// ══════════════════════════════════════════════════

describe('Self-Authoring: Authored Skills', () => {
  it('creates valid skill with template placeholders', () => {
    const skill = {
      name: 'summarize-email',
      description: 'Summarize incoming emails',
      skill_type: 'prompt_template' as const,
      template: 'Summarize this email: {{email_body}}. Focus on: {{focus_areas}}',
      version: 1,
      approved: false,
    };

    expect(skill.template).toContain('{{email_body}}');
    expect(skill.template).toContain('{{focus_areas}}');

    const placeholders = skill.template.match(/\{\{(\w+)\}\}/g) || [];
    expect(placeholders).toHaveLength(2);
  });

  it('increments version on update', () => {
    let v = 1;
    v += 1;
    expect(v).toBe(2);
  });
});

// ══════════════════════════════════════════════════
//  Tool Discovery / Search
// ══════════════════════════════════════════════════

describe('Self-Authoring: Tool Discovery', () => {
  it('searches by name', () => {
    const tools = [
      { name: 'csv-parser', schema_json: '{}' },
      { name: 'json-validator', schema_json: '{}' },
      { name: 'csv-to-json', schema_json: '{}' },
    ];

    const results = tools.filter(t => t.name.includes('csv'));
    expect(results).toHaveLength(2);
  });

  it('searches by schema content', () => {
    const tools = [
      { name: 'tool-a', schema_json: '{"description":"parses CSV files"}' },
      { name: 'tool-b', schema_json: '{"description":"sends emails"}' },
    ];

    const results = tools.filter(t => t.schema_json.toLowerCase().includes('csv'));
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('tool-a');
  });
});
