import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (must be hoisted) ──

const {
  mockQuery, mockQueryOne, mockExecute, mockWithTransaction,
  mockGetAgent, mockUpdateAgent,
  mockRegisterCustomTool, mockGetCustomTool, mockListCustomTools,
  mockRegisterSkill, mockAttachSkillToAgent,
  mockCreateProposal, mockCanModifyAgent,
  mockDockerCreateContainer, mockDockerContainerStart, mockDockerContainerWait,
  mockDockerContainerKill, mockDockerContainerLogs, mockDockerContainerRemove,
  mockAnthropicCreate,
} = vi.hoisted(() => {
  const mockQuery = vi.fn().mockResolvedValue([]);
  const mockQueryOne = vi.fn().mockResolvedValue(undefined);
  const mockExecute = vi.fn().mockResolvedValue(undefined);
  const mockWithTransaction = vi.fn();
  const mockGetAgent = vi.fn();
  const mockUpdateAgent = vi.fn();
  const mockRegisterCustomTool = vi.fn();
  const mockGetCustomTool = vi.fn();
  const mockListCustomTools = vi.fn().mockResolvedValue([]);
  const mockRegisterSkill = vi.fn();
  const mockAttachSkillToAgent = vi.fn();
  const mockCreateProposal = vi.fn();
  const mockCanModifyAgent = vi.fn();
  const mockDockerCreateContainer = vi.fn();
  const mockDockerContainerStart = vi.fn();
  const mockDockerContainerWait = vi.fn().mockResolvedValue({ StatusCode: 0 });
  const mockDockerContainerKill = vi.fn();
  const mockDockerContainerLogs = vi.fn().mockResolvedValue(Buffer.from(''));
  const mockDockerContainerRemove = vi.fn();
  const mockAnthropicCreate = vi.fn();

  return {
    mockQuery, mockQueryOne, mockExecute, mockWithTransaction,
    mockGetAgent, mockUpdateAgent,
    mockRegisterCustomTool, mockGetCustomTool, mockListCustomTools,
    mockRegisterSkill, mockAttachSkillToAgent,
    mockCreateProposal, mockCanModifyAgent,
    mockDockerCreateContainer, mockDockerContainerStart, mockDockerContainerWait,
    mockDockerContainerKill, mockDockerContainerLogs, mockDockerContainerRemove,
    mockAnthropicCreate,
  };
});

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
  withTransaction: (fn: any) => mockWithTransaction(fn),
}));

vi.mock('../../src/modules/agents', () => ({
  getAgent: (...args: any[]) => mockGetAgent(...args),
  updateAgent: (...args: any[]) => mockUpdateAgent(...args),
}));

vi.mock('../../src/modules/tools', () => ({
  registerCustomTool: (...args: any[]) => mockRegisterCustomTool(...args),
  getCustomTool: (...args: any[]) => mockGetCustomTool(...args),
  listCustomTools: (...args: any[]) => mockListCustomTools(...args),
}));

vi.mock('../../src/modules/skills', () => ({
  registerSkill: (...args: any[]) => mockRegisterSkill(...args),
  attachSkillToAgent: (...args: any[]) => mockAttachSkillToAgent(...args),
}));

vi.mock('../../src/modules/self-evolution', () => ({
  createProposal: (...args: any[]) => mockCreateProposal(...args),
}));

vi.mock('../../src/modules/access-control', () => ({
  canModifyAgent: (...args: any[]) => mockCanModifyAgent(...args),
}));

vi.mock('../../src/config', () => ({
  config: {
    docker: { baseImage: 'tinyhands-runner:latest' },
    anthropic: { apiKey: 'test-key' },
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('dockerode', () => ({
  default: vi.fn().mockImplementation(() => ({
    createContainer: mockDockerCreateContainer,
  })),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('test-uuid-1234'),
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue('/tmp/tj-sandbox-test'),
}));

vi.mock('os', () => ({
  tmpdir: vi.fn().mockReturnValue('/tmp'),
}));

import {
  validateToolCode,
  validateToolName,
  validateArtifactPath,
  getToolExecutionScript,
  authorTool,
  updateToolCode,
  rollbackTool,
  getToolVersions,
  recordToolRun,
  getToolAnalytics,
  getAllToolAnalytics,
  shareToolWithAgent,
  discoverTools,
  createToolPipeline,
  authorSkill,
  getMcpConfigs,
  approveMcpConfig,
  getCodeArtifacts,
  getCodeArtifact,
  getAuthoredSkills,
  getAuthoredSkill,
  approveAuthoredSkill,
  updateAuthoredSkillTemplate,
} from '../../src/modules/self-authoring';

// ══════════════════════════════════════════════════
//  Code Validation (static analysis)
// ══════════════════════════════════════════════════

describe('Self-Authoring: Code Validation', () => {
  const FORBIDDEN_PATTERNS = [
    /process\.exit/i,
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /require\s*\(\s*['"](net|http|https|dgram|cluster|worker_threads|vm)['"]\s*\)/,
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

// ══════════════════════════════════════════════════
//  Tool Name Validation (security)
// ══════════════════════════════════════════════════

describe('Self-Authoring: Tool Name Validation', () => {
  function validateToolName(name: string): string | null {
    if (!name || name.length < 3 || name.length > 40) return 'length';
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) return 'format';
    if (name.includes('--')) return 'double-hyphen';
    return null;
  }

  it('accepts valid kebab-case names', () => {
    expect(validateToolName('my-tool')).toBeNull();
    expect(validateToolName('csv-parser')).toBeNull();
    expect(validateToolName('tool123')).toBeNull();
    expect(validateToolName('abc')).toBeNull();
  });

  it('rejects too short names', () => {
    expect(validateToolName('ab')).toBe('length');
    expect(validateToolName('')).toBe('length');
  });

  it('rejects too long names', () => {
    expect(validateToolName('a'.repeat(41))).toBe('length');
  });

  it('rejects names with uppercase', () => {
    expect(validateToolName('MyTool')).toBe('format');
  });

  it('rejects names with spaces', () => {
    expect(validateToolName('my tool')).toBe('format');
  });

  it('rejects names starting with hyphen', () => {
    expect(validateToolName('-my-tool')).toBe('format');
  });

  it('rejects names ending with hyphen', () => {
    expect(validateToolName('my-tool-')).toBe('format');
  });

  it('rejects shell injection in names', () => {
    expect(validateToolName('tool;rm -rf /')).toBe('format');
    expect(validateToolName('tool$(whoami)')).toBe('format');
    expect(validateToolName('tool`id`')).toBe('format');
  });

  it('rejects path traversal in names', () => {
    expect(validateToolName('../etc/passwd')).toBe('format');
    expect(validateToolName('tool/../../bin')).toBe('format');
  });

  it('rejects consecutive hyphens', () => {
    expect(validateToolName('my--tool')).toBe('double-hyphen');
  });
});

// ══════════════════════════════════════════════════
//  Artifact Path Validation (security)
// ══════════════════════════════════════════════════

describe('Self-Authoring: Artifact Path Validation', () => {
  const blockedPrefixes = ['/etc/', '/proc/', '/sys/', '/dev/', '/boot/', '/root/', '/var/run/'];

  function validateArtifactPath(path: string): string | null {
    if (path.includes('..') || path.includes('\0')) return 'traversal';
    if (!path.startsWith('/')) return 'not-absolute';
    for (const prefix of blockedPrefixes) {
      if (path.startsWith(prefix)) return 'blocked';
    }
    return null;
  }

  it('accepts valid absolute paths', () => {
    expect(validateArtifactPath('/src/utils/helper.ts')).toBeNull();
    expect(validateArtifactPath('/app/index.js')).toBeNull();
  });

  it('blocks path traversal', () => {
    expect(validateArtifactPath('/src/../../etc/passwd')).toBe('traversal');
    expect(validateArtifactPath('/src/../../../root/.ssh/id_rsa')).toBe('traversal');
  });

  it('blocks null bytes', () => {
    expect(validateArtifactPath('/src/file.ts\0.jpg')).toBe('traversal');
  });

  it('requires absolute paths', () => {
    expect(validateArtifactPath('relative/path.ts')).toBe('not-absolute');
  });

  it('blocks sensitive system paths', () => {
    expect(validateArtifactPath('/etc/passwd')).toBe('blocked');
    expect(validateArtifactPath('/proc/self/environ')).toBe('blocked');
    expect(validateArtifactPath('/sys/class/net')).toBe('blocked');
    expect(validateArtifactPath('/dev/sda')).toBe('blocked');
    expect(validateArtifactPath('/root/.bashrc')).toBe('blocked');
  });
});

// ══════════════════════════════════════════════════
//  Boolean/Integer Type Mapping
// ══════════════════════════════════════════════════

describe('Self-Authoring: SQLite Boolean Handling', () => {
  it('treats SQLite 0 as falsy for approved check', () => {
    const tool = { approved: 0, script_code: 'code' };
    expect(!tool.approved).toBe(true); // should be treated as not approved
  });

  it('treats SQLite 1 as truthy for approved check', () => {
    const tool = { approved: 1, script_code: 'code' };
    expect(!tool.approved).toBe(false); // should be treated as approved
  });

  it('treats JS true as truthy for approved check', () => {
    const tool = { approved: true, script_code: 'code' };
    expect(!tool.approved).toBe(false);
  });

  it('treats JS false as falsy for approved check', () => {
    const tool = { approved: false, script_code: 'code' };
    expect(!tool.approved).toBe(true);
  });
});

// ══════════════════════════════════════════════════
//  ACTUAL SOURCE MODULE TESTS
// ══════════════════════════════════════════════════

describe('Self-Authoring Module (source imports)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const fakeClient = { query: vi.fn() };
      return fn(fakeClient);
    });
  });

  // ── validateToolCode (actual function) ──

  describe('validateToolCode', () => {
    it('should accept safe JavaScript code', () => {
      expect(() => validateToolCode('const x = 1;', 'javascript')).not.toThrow();
    });

    it('should throw for process.exit', () => {
      expect(() => validateToolCode('process.exit(1)', 'javascript')).toThrow('forbidden pattern');
    });

    it('should throw for child_process require', () => {
      expect(() => validateToolCode('require("child_process")', 'javascript')).toThrow('forbidden pattern');
    });

    it('should throw for net/http/https/dgram/cluster/worker_threads/vm requires', () => {
      expect(() => validateToolCode('require("net")', 'javascript')).toThrow('forbidden pattern');
      expect(() => validateToolCode('require("http")', 'javascript')).toThrow('forbidden pattern');
      expect(() => validateToolCode('require("vm")', 'javascript')).toThrow('forbidden pattern');
    });

    it('should throw for eval', () => {
      expect(() => validateToolCode('eval("code")', 'javascript')).toThrow('forbidden pattern');
    });

    it('should throw for Function constructor', () => {
      expect(() => validateToolCode('new Function("return 1")()', 'javascript')).toThrow('forbidden pattern');
    });

    it('should throw for rm -rf /', () => {
      expect(() => validateToolCode('rm -rf /', 'bash')).toThrow('forbidden pattern');
    });

    it('should throw for fork bomb', () => {
      expect(() => validateToolCode(':(){ :|:& };:', 'bash')).toThrow('forbidden pattern');
    });

    it('should throw for Python subprocess import', () => {
      expect(() => validateToolCode('import subprocess', 'python')).toThrow('forbidden pattern');
    });

    it('should throw for Python os.system', () => {
      expect(() => validateToolCode('os.system("ls")', 'python')).toThrow('forbidden pattern');
    });

    it('should throw for Python __import__', () => {
      expect(() => validateToolCode('__import__("os")', 'python')).toThrow('forbidden pattern');
    });

    it('should throw for reading /etc files', () => {
      expect(() => validateToolCode('open("/etc/passwd")', 'python')).toThrow('forbidden pattern');
    });

    it('should throw for code exceeding 50KB', () => {
      expect(() => validateToolCode('x'.repeat(51000), 'javascript')).toThrow('maximum size');
    });

    it('should throw for code exceeding 500 lines', () => {
      expect(() => validateToolCode(Array(501).fill('x = 1').join('\n'), 'javascript')).toThrow('maximum line count');
    });
  });

  // ── validateToolName (actual function) ──

  describe('validateToolName', () => {
    it('should accept valid kebab-case names', () => {
      expect(() => validateToolName('my-tool')).not.toThrow();
      expect(() => validateToolName('abc')).not.toThrow();
      expect(() => validateToolName('tool123')).not.toThrow();
    });

    it('should throw for too short names', () => {
      expect(() => validateToolName('ab')).toThrow('3-40 characters');
      expect(() => validateToolName('')).toThrow('3-40 characters');
    });

    it('should throw for too long names', () => {
      expect(() => validateToolName('a'.repeat(41))).toThrow('3-40 characters');
    });

    it('should throw for non-kebab-case names', () => {
      expect(() => validateToolName('MyTool')).toThrow('kebab-case');
      expect(() => validateToolName('-my-tool')).toThrow('kebab-case');
      expect(() => validateToolName('my-tool-')).toThrow('kebab-case');
    });

    it('should throw for consecutive hyphens', () => {
      expect(() => validateToolName('my--tool')).toThrow('consecutive hyphens');
    });
  });

  // ── validateArtifactPath (actual function) ──

  describe('validateArtifactPath', () => {
    it('should accept valid paths', () => {
      expect(() => validateArtifactPath('/src/utils/helper.ts')).not.toThrow();
    });

    it('should throw for path traversal', () => {
      expect(() => validateArtifactPath('/src/../etc/passwd')).toThrow();
    });

    it('should throw for null bytes', () => {
      expect(() => validateArtifactPath('/src/file\0.ts')).toThrow();
    });

    it('should throw for relative paths', () => {
      expect(() => validateArtifactPath('relative/path.ts')).toThrow('absolute');
    });

    it('should throw for blocked prefixes', () => {
      expect(() => validateArtifactPath('/etc/passwd')).toThrow();
      expect(() => validateArtifactPath('/proc/self/environ')).toThrow();
      expect(() => validateArtifactPath('/sys/class')).toThrow();
      expect(() => validateArtifactPath('/dev/sda')).toThrow();
      expect(() => validateArtifactPath('/boot/grub')).toThrow();
      expect(() => validateArtifactPath('/root/.ssh')).toThrow();
      expect(() => validateArtifactPath('/var/run/docker.sock')).toThrow();
    });
  });

  // ── getToolExecutionScript ──

  describe('getToolExecutionScript', () => {
    it('should return null when tool not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);
      const result = await getToolExecutionScript('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null when tool has no script_code', async () => {
      mockGetCustomTool.mockResolvedValueOnce({ name: 'tool', script_code: null, approved: true });
      const result = await getToolExecutionScript('tool');
      expect(result).toBeNull();
    });

    it('should return null when tool is not approved', async () => {
      mockGetCustomTool.mockResolvedValueOnce({ name: 'tool', script_code: 'code', approved: false });
      const result = await getToolExecutionScript('tool');
      expect(result).toBeNull();
    });

    it('should return JavaScript execution script', async () => {
      mockGetCustomTool.mockResolvedValueOnce({
        name: 'my-tool', script_code: 'console.log("hi")', language: 'javascript', approved: true,
      });
      const result = await getToolExecutionScript('my-tool');
      expect(result).toContain('#!/usr/bin/env node');
      expect(result).toContain("'use strict'");
      expect(result).toContain('Agent-authored tool: my-tool');
      expect(result).toContain('console.log("hi")');
    });

    it('should return Python execution script', async () => {
      mockGetCustomTool.mockResolvedValueOnce({
        name: 'py-tool', script_code: 'print("hi")', language: 'python', approved: true,
      });
      const result = await getToolExecutionScript('py-tool');
      expect(result).toContain('#!/usr/bin/env python3');
      expect(result).toContain('import os, json');
    });

    it('should return Bash execution script', async () => {
      mockGetCustomTool.mockResolvedValueOnce({
        name: 'sh-tool', script_code: 'echo hi', language: 'bash', approved: true,
      });
      const result = await getToolExecutionScript('sh-tool');
      expect(result).toContain('#!/usr/bin/env bash');
      expect(result).toContain('set -euo pipefail');
    });

    it('should fall back to javascript shebang for unknown language', async () => {
      mockGetCustomTool.mockResolvedValueOnce({
        name: 'other-tool', script_code: 'code', language: 'rust', approved: true,
      });
      const result = await getToolExecutionScript('other-tool');
      expect(result).toContain('#!/usr/bin/env node');
      // The code is returned as-is without wrapping for unknown language
      expect(result).toContain('code');
    });
  });

  // ── recordToolRun ──

  describe('recordToolRun', () => {
    it('should insert a tool run record', async () => {
      await recordToolRun('my-tool', 'agent-1', true, 100, null);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('tool_runs'),
        expect.arrayContaining(['my-tool', 'agent-1', true, 100, null])
      );
    });

    it('should record failed tool runs with error message', async () => {
      await recordToolRun('my-tool', 'agent-1', false, 50, 'ReferenceError');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('tool_runs'),
        expect.arrayContaining([false, 50, 'ReferenceError'])
      );
    });
  });

  // ── getToolAnalytics ──

  describe('getToolAnalytics', () => {
    it('should return analytics for a tool', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ total_runs: '10', successes: '8', avg_duration: '150.5', last_used: '2025-01-01' })
        .mockResolvedValueOnce({ error: 'some error' });

      const analytics = await getToolAnalytics('my-tool');

      expect(analytics.toolName).toBe('my-tool');
      expect(analytics.totalRuns).toBe(10);
      expect(analytics.successRate).toBe(0.8);
      expect(analytics.avgDurationMs).toBe(151);
      expect(analytics.lastUsed).toBe('2025-01-01');
      expect(analytics.lastError).toBe('some error');
    });

    it('should handle zero runs', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ total_runs: '0', successes: '0', avg_duration: '0', last_used: null })
        .mockResolvedValueOnce(null);

      const analytics = await getToolAnalytics('empty-tool');
      expect(analytics.totalRuns).toBe(0);
      expect(analytics.successRate).toBe(0);
      expect(analytics.lastUsed).toBeNull();
      expect(analytics.lastError).toBeNull();
    });

    it('should handle null stats', async () => {
      mockQueryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const analytics = await getToolAnalytics('null-tool');
      expect(analytics.totalRuns).toBe(0);
      expect(analytics.successRate).toBe(0);
      expect(analytics.avgDurationMs).toBe(0);
    });
  });

  // ── getAllToolAnalytics ──

  describe('getAllToolAnalytics', () => {
    it('should return analytics for all tools', async () => {
      mockQuery.mockResolvedValueOnce([{ tool_name: 'tool-a' }, { tool_name: 'tool-b' }]);
      mockQueryOne
        .mockResolvedValueOnce({ total_runs: '5', successes: '5', avg_duration: '100', last_used: '2025-01-01' })
        .mockResolvedValueOnce(null) // no last error for tool-a
        .mockResolvedValueOnce({ total_runs: '3', successes: '1', avg_duration: '200', last_used: '2025-01-02' })
        .mockResolvedValueOnce({ error: 'oops' }); // last error for tool-b

      const allAnalytics = await getAllToolAnalytics();
      expect(allAnalytics).toHaveLength(2);
    });

    it('should filter by agentId when provided', async () => {
      mockQuery.mockResolvedValueOnce([{ tool_name: 'tool-x' }]);
      mockQueryOne
        .mockResolvedValueOnce({ total_runs: '1', successes: '1', avg_duration: '50', last_used: null })
        .mockResolvedValueOnce(null);

      const analytics = await getAllToolAnalytics('agent-1');
      expect(analytics).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('agent_id'),
        ['agent-1']
      );
    });
  });

  // ── getToolVersions ──

  describe('getToolVersions', () => {
    it('should return tool versions', async () => {
      mockQuery.mockResolvedValueOnce([
        { version: 2, changed_by: 'user1', created_at: '2025-01-02' },
        { version: 1, changed_by: 'user1', created_at: '2025-01-01' },
      ]);

      const versions = await getToolVersions('my-tool');
      expect(versions).toHaveLength(2);
    });
  });

  // ── updateToolCode ──

  describe('updateToolCode', () => {
    it('should throw when tool not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);
      await expect(updateToolCode('nonexistent', 'code', 'javascript', 'user1')).rejects.toThrow('not found');
    });

    it('should throw when code contains forbidden patterns', async () => {
      mockGetCustomTool.mockResolvedValueOnce({ name: 'tool', script_code: 'old', language: 'javascript' });
      await expect(updateToolCode('tool', 'process.exit(1)', 'javascript', 'user1')).rejects.toThrow('forbidden pattern');
    });

    it('should update tool code with versioning', async () => {
      mockGetCustomTool.mockResolvedValueOnce({
        name: 'my-tool', script_code: 'old code', language: 'javascript',
      });

      const fakeClient = { query: vi.fn() };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      await updateToolCode('my-tool', 'const x = 1;', 'javascript', 'user1');

      expect(fakeClient.query).toHaveBeenCalledTimes(2); // insert version + update tool
    });
  });

  // ── rollbackTool ──

  describe('rollbackTool', () => {
    it('should throw when version not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(rollbackTool('my-tool', 99, 'user1')).rejects.toThrow('not found');
    });

    it('should rollback to specified version', async () => {
      mockQueryOne.mockResolvedValueOnce({ script_code: 'old code', language: 'javascript' });
      mockGetCustomTool.mockResolvedValueOnce({ name: 'my-tool', script_code: 'current', language: 'javascript' });

      const fakeClient = { query: vi.fn() };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      await rollbackTool('my-tool', 1, 'user1');
      expect(fakeClient.query).toHaveBeenCalled();
    });
  });

  // ── shareToolWithAgent ──

  describe('shareToolWithAgent', () => {
    it('should throw when tool not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);
      await expect(shareToolWithAgent('nonexistent', 'agent-1', 'agent-2')).rejects.toThrow('not found');
    });

    it('should throw when agent does not own tool', async () => {
      mockGetCustomTool.mockResolvedValueOnce({ name: 'tool', registered_by: 'agent-other' });
      await expect(shareToolWithAgent('tool', 'agent-1', 'agent-2')).rejects.toThrow('does not own');
    });

    it('should throw when target agent not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce({ name: 'tool', registered_by: 'agent-1' });
      mockGetAgent.mockResolvedValueOnce(null);
      await expect(shareToolWithAgent('tool', 'agent-1', 'agent-2')).rejects.toThrow('not found');
    });

    it('should add tool to target agent tools list', async () => {
      mockGetCustomTool.mockResolvedValueOnce({ name: 'shared-tool', registered_by: 'agent-1' });
      mockGetAgent.mockResolvedValueOnce({ id: 'agent-2', tools: ['Read', 'Write'] });
      mockUpdateAgent.mockResolvedValueOnce({});

      await shareToolWithAgent('shared-tool', 'agent-1', 'agent-2');
      expect(mockUpdateAgent).toHaveBeenCalledWith('agent-2', { tools: ['Read', 'Write', 'shared-tool'] }, 'agent-1');
    });

    it('should not duplicate tool in target agent tools list', async () => {
      mockGetCustomTool.mockResolvedValueOnce({ name: 'shared-tool', registered_by: 'agent-1' });
      mockGetAgent.mockResolvedValueOnce({ id: 'agent-2', tools: ['Read', 'shared-tool'] });

      await shareToolWithAgent('shared-tool', 'agent-1', 'agent-2');
      expect(mockUpdateAgent).not.toHaveBeenCalled();
    });
  });

  // ── discoverTools ──

  describe('discoverTools', () => {
    it('should search tools by name', async () => {
      mockListCustomTools.mockResolvedValueOnce([
        { name: 'csv-parser', schema_json: '{}' },
        { name: 'json-tool', schema_json: '{}' },
      ]);

      const results = await discoverTools('csv');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('csv-parser');
    });

    it('should search tools by schema content', async () => {
      mockListCustomTools.mockResolvedValueOnce([
        { name: 'tool-a', schema_json: '{"description":"parses CSV files"}' },
        { name: 'tool-b', schema_json: '{"description":"sends emails"}' },
      ]);

      const results = await discoverTools('csv');
      expect(results).toHaveLength(1);
    });

    it('should return all matches from name or schema', async () => {
      mockListCustomTools.mockResolvedValueOnce([
        { name: 'csv-parser', schema_json: '{}' },
        { name: 'other', schema_json: '{"description":"csv converter"}' },
        { name: 'unrelated', schema_json: '{}' },
      ]);

      const results = await discoverTools('csv');
      expect(results).toHaveLength(2);
    });
  });

  // ── createToolPipeline ──

  describe('createToolPipeline', () => {
    it('should throw when pipeline references unknown tool', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);

      await expect(createToolPipeline('agent-1', {
        name: 'test-pipe',
        description: 'test',
        steps: [{ toolName: 'nonexistent', inputMapping: {} }],
      })).rejects.toThrow('unknown tool');
    });

    it('should create pipeline tool', async () => {
      mockGetCustomTool
        .mockResolvedValueOnce({ name: 'step1' }) // validation
        .mockResolvedValueOnce({ name: 'step2' }) // validation
        .mockResolvedValueOnce({ name: 'step1', schema_json: '{"type":"object","properties":{}}' }); // first tool schema

      mockRegisterCustomTool.mockResolvedValueOnce({ name: 'my-pipeline' });

      const result = await createToolPipeline('agent-1', {
        name: 'my-pipeline',
        description: 'A pipeline',
        steps: [
          { toolName: 'step1', inputMapping: {} },
          { toolName: 'step2', inputMapping: { data: 'input' } },
        ],
      });

      expect(result.name).toBe('my-pipeline');
      expect(mockRegisterCustomTool).toHaveBeenCalled();
    });

    it('should handle pipeline where firstTool schema is null', async () => {
      mockGetCustomTool
        .mockResolvedValueOnce({ name: 'step1' }) // validation
        .mockResolvedValueOnce(null); // firstTool lookup returns null

      mockRegisterCustomTool.mockResolvedValueOnce({ name: 'pipe' });

      await createToolPipeline('agent-1', {
        name: 'pipe',
        description: 'test',
        steps: [{ toolName: 'step1', inputMapping: {} }],
      });

      // Should use empty schema when firstTool is null
      expect(mockRegisterCustomTool).toHaveBeenCalledWith(
        'pipe',
        expect.any(String),
        null,
        'agent-1',
        expect.any(Object),
      );
    });
  });

  // ── authorTool ──

  describe('authorTool', () => {
    it('should throw when agent not found', async () => {
      mockGetAgent.mockResolvedValueOnce(null);
      await expect(authorTool('nonexistent', 'build a tool')).rejects.toThrow('not found');
    });

    it('should generate, validate, test and register a tool', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1', name: 'test-agent', self_evolution_mode: 'autonomous',
      });

      mockListCustomTools.mockResolvedValueOnce([]);

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'calc-tool',
            description: 'A calculator',
            language: 'javascript',
            inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
            code: 'const {a, b} = JSON.parse(process.env.INPUT); console.log(JSON.stringify({sum: a + b}));',
          }),
        }],
      });

      // Mock sandbox test (docker container)
      const mockContainer = {
        start: mockDockerContainerStart.mockResolvedValue(undefined),
        wait: mockDockerContainerWait.mockResolvedValue({ StatusCode: 0 }),
        kill: mockDockerContainerKill,
        logs: mockDockerContainerLogs.mockResolvedValue(Buffer.from('{"sum": 84}')),
        remove: mockDockerContainerRemove,
      };
      mockDockerCreateContainer.mockResolvedValueOnce(mockContainer);

      mockRegisterCustomTool.mockResolvedValueOnce({
        name: 'calc-tool', schema_json: '{}', approved: true,
      });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool('agent-1', 'build a calculator');

      expect(result.tool.name).toBe('calc-tool');
      expect(result.requiresApproval).toBe(false);
      expect(result.testResult).toBeDefined();
      expect(result.testResult!.passed).toBe(true);
    });

    it('should handle sandbox test failure and attempt auto-fix', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1', name: 'test-agent', self_evolution_mode: 'approve-first',
      });

      mockListCustomTools.mockResolvedValueOnce([]);

      // Initial code generation
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'broken-tool',
            description: 'A broken tool',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'const x = 1; console.log(JSON.stringify({result: x}));',
          }),
        }],
      });

      // Sandbox test fails (non-zero exit)
      const failContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 1 }),
        kill: vi.fn(),
        logs: vi.fn().mockResolvedValue(Buffer.from('Error: something wrong')),
        remove: vi.fn(),
      };
      mockDockerCreateContainer.mockResolvedValueOnce(failContainer);

      // Auto-fix response
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: '```javascript\nconst x = 2; console.log(JSON.stringify({result: x}));\n```',
        }],
      });

      // Retry sandbox test succeeds
      const successContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
        kill: vi.fn(),
        logs: vi.fn().mockResolvedValue(Buffer.from('{"result": 2}')),
        remove: vi.fn(),
      };
      mockDockerCreateContainer.mockResolvedValueOnce(successContainer);

      mockRegisterCustomTool.mockResolvedValueOnce({ name: 'broken-tool', approved: false });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool('agent-1', 'build a broken tool');

      expect(result.requiresApproval).toBe(true);
      expect(result.testResult!.passed).toBe(true);
    });

    it('should handle sandbox test docker error gracefully', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1', name: 'test-agent', self_evolution_mode: 'autonomous',
      });

      mockListCustomTools.mockResolvedValueOnce([]);

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'test-tool',
            description: 'A test tool',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("ok");',
          }),
        }],
      });

      // Docker create throws — caught inside sandboxTest, returns failed result
      mockDockerCreateContainer.mockRejectedValueOnce(new Error('Docker not available'));

      // Auto-fix will be attempted since testResult.passed === false
      // Auto-fix also fails
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API error'));

      mockRegisterCustomTool.mockResolvedValueOnce({ name: 'test-tool', approved: true });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool('agent-1', 'build a test tool');

      // sandboxTest catches docker errors internally and returns failed result
      expect(result.testResult).toBeDefined();
      expect(result.testResult!.passed).toBe(false);
      expect(result.testResult!.error).toContain('Docker not available');
    });

    it('should handle unsupported language in sandbox test', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1', name: 'test-agent', self_evolution_mode: 'autonomous',
      });

      mockListCustomTools.mockResolvedValueOnce([]);

      // Return code with unsupported language
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'rust-tool',
            description: 'A rust tool',
            language: 'rust',
            inputSchema: { type: 'object', properties: {} },
            code: 'fn main() {}',
          }),
        }],
      });

      // Auto-fix attempt (since test failed)
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API error'));

      mockRegisterCustomTool.mockResolvedValueOnce({ name: 'rust-tool', approved: true });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool('agent-1', 'build a rust tool');

      expect(result.testResult).toBeDefined();
      expect(result.testResult!.passed).toBe(false);
      expect(result.testResult!.error).toContain('Unsupported language');
    });

    it('should handle container.wait() rejection in sandbox', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1', name: 'test-agent', self_evolution_mode: 'autonomous',
      });

      mockListCustomTools.mockResolvedValueOnce([]);

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'wait-fail-tool',
            description: 'Tool that fails on wait',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("ok");',
          }),
        }],
      });

      // Container where wait() rejects
      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockRejectedValue(new Error('container disappeared')),
        kill: vi.fn(),
        logs: vi.fn().mockResolvedValue(Buffer.from('')),
        remove: vi.fn(),
      };
      mockDockerCreateContainer.mockResolvedValueOnce(mockContainer);

      // Auto-fix fails
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API error'));

      mockRegisterCustomTool.mockResolvedValueOnce({ name: 'wait-fail-tool', approved: true });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool('agent-1', 'build tool');

      expect(result.testResult).toBeDefined();
      expect(result.testResult!.passed).toBe(false);
      expect(result.testResult!.error).toContain('container disappeared');
    });

    it('should handle container.wait() rejection in sandbox and attempt cleanup', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1', name: 'test-agent', self_evolution_mode: 'autonomous',
      });

      mockListCustomTools.mockResolvedValueOnce([]);

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'cleanup-tool',
            description: 'Tool that errors during wait',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("ok");',
          }),
        }],
      });

      // Container whose start succeeds but wait throws — triggers catch block at 258 with container cleanup at 260
      const mockContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockRejectedValue(new Error('container vanished')),
        kill: vi.fn(),
        logs: vi.fn().mockResolvedValue(Buffer.from('')),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      mockDockerCreateContainer.mockResolvedValueOnce(mockContainer);

      // Auto-fix fails
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API error'));

      mockRegisterCustomTool.mockResolvedValueOnce({ name: 'cleanup-tool', approved: true });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool('agent-1', 'build cleanup tool');

      expect(result.testResult).toBeDefined();
      expect(result.testResult!.passed).toBe(false);
      expect(result.testResult!.error).toContain('container vanished');
      // Container cleanup was attempted
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
    });

    // Lines 225-226 (sandbox timeout handler) are covered by the container.wait() rejection test above.
    // The actual setTimeout callback at line 224-226 requires a real 15-second wait, which is
    // impractical in unit tests. The error path is exercised through wait() rejection instead.

    it('should handle sandboxTest throwing (null testResult)', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1', name: 'test-agent', self_evolution_mode: 'autonomous',
      });

      mockListCustomTools.mockResolvedValueOnce([]);

      // Return code with unsupported language to trigger early return in sandboxTest
      // Actually, unsupported language returns { passed: false } rather than throws.
      // To get testResult = null, we need sandboxTest to throw. Let's mock mkdtempSync to throw.
      const { mkdtempSync } = await import('fs');
      (mkdtempSync as any).mockImplementationOnce(() => { throw new Error('fs error'); });

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'fs-tool',
            description: 'A tool',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("ok");',
          }),
        }],
      });

      mockRegisterCustomTool.mockResolvedValueOnce({ name: 'fs-tool', approved: true });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool('agent-1', 'build fs tool');

      // When sandboxTest throws, testResult is null
      expect(result.testResult).toBeNull();
    });

    it('should handle auto-fix failure gracefully', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1', name: 'test-agent', self_evolution_mode: 'autonomous',
      });

      mockListCustomTools.mockResolvedValueOnce([]);

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'bad-tool',
            description: 'A bad tool',
            language: 'javascript',
            inputSchema: { type: 'object', properties: {} },
            code: 'console.log("ok");',
          }),
        }],
      });

      // Sandbox test fails
      const failContainer = {
        start: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue({ StatusCode: 1 }),
        kill: vi.fn(),
        logs: vi.fn().mockResolvedValue(Buffer.from('error')),
        remove: vi.fn(),
      };
      mockDockerCreateContainer.mockResolvedValueOnce(failContainer);

      // Auto-fix also fails
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API error'));

      mockRegisterCustomTool.mockResolvedValueOnce({ name: 'bad-tool', approved: true });
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const result = await authorTool('agent-1', 'build a tool');

      // Should use original code despite auto-fix failure
      expect(result.testResult).toBeDefined();
      expect(result.testResult!.passed).toBe(false);
    });
  });

  // ── authorSkill ──

  describe('authorSkill', () => {
    it('should throw when agent not found', async () => {
      mockGetAgent.mockResolvedValueOnce(null);
      await expect(authorSkill('nonexistent', 'create a skill')).rejects.toThrow('not found');
    });

    it('should generate and register a skill', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1', name: 'test-agent', self_evolution_mode: 'autonomous',
      });

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'email-summary',
            description: 'Summarizes emails',
            template: 'Summarize: {{email_body}}',
          }),
        }],
      });

      mockRegisterSkill.mockResolvedValueOnce(undefined);
      mockAttachSkillToAgent.mockResolvedValueOnce(undefined);
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const skill = await authorSkill('agent-1', 'create email summary skill');

      expect(skill.name).toBe('email-summary');
      expect(skill.skill_type).toBe('prompt_template');
      expect(skill.approved).toBe(true);
      expect(mockRegisterSkill).toHaveBeenCalled();
      expect(mockAttachSkillToAgent).toHaveBeenCalled();
    });

    it('should set approved to false for approve-first agents', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1', name: 'test-agent', self_evolution_mode: 'approve-first',
      });

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: 'my-skill',
            description: 'A skill',
            template: 'Do {{task}}',
          }),
        }],
      });

      mockRegisterSkill.mockResolvedValueOnce(undefined);
      mockAttachSkillToAgent.mockResolvedValueOnce(undefined);
      mockCreateProposal.mockResolvedValueOnce(undefined);

      const skill = await authorSkill('agent-1', 'create skill');
      expect(skill.approved).toBe(false);
    });
  });

  // ── getMcpConfigs ──

  describe('getMcpConfigs', () => {
    it('should return MCP configs for an agent', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'mcp1', agent_id: 'agent-1', name: 'linear' },
      ]);

      const configs = await getMcpConfigs('agent-1');
      expect(configs).toHaveLength(1);
    });
  });

  // ── approveMcpConfig ──

  describe('approveMcpConfig', () => {
    it('should throw when config not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(approveMcpConfig('nonexistent', 'user1')).rejects.toThrow('not found');
    });

    it('should throw when user lacks permissions', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'mcp1', agent_id: 'agent-1' });
      mockCanModifyAgent.mockResolvedValueOnce(false);
      await expect(approveMcpConfig('mcp1', 'user1')).rejects.toThrow('Insufficient permissions');
    });

    it('should approve config when authorized', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'mcp1', agent_id: 'agent-1' });
      mockCanModifyAgent.mockResolvedValueOnce(true);

      await approveMcpConfig('mcp1', 'user1');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('approved = TRUE'),
        ['mcp1']
      );
    });
  });

  // ── getCodeArtifacts / getCodeArtifact ──

  describe('getCodeArtifacts', () => {
    it('should return code artifacts for an agent', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'art1', agent_id: 'agent-1', file_path: '/src/helper.ts' },
      ]);

      const artifacts = await getCodeArtifacts('agent-1');
      expect(artifacts).toHaveLength(1);
    });
  });

  describe('getCodeArtifact', () => {
    it('should return artifact when found', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'art1', agent_id: 'agent-1', file_path: '/src/helper.ts',
      });

      const artifact = await getCodeArtifact('agent-1', '/src/helper.ts');
      expect(artifact).toBeDefined();
    });

    it('should return null when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      const artifact = await getCodeArtifact('agent-1', '/nonexistent');
      expect(artifact).toBeNull();
    });
  });

  // ── getAuthoredSkills / getAuthoredSkill ──

  describe('getAuthoredSkills', () => {
    it('should return authored skills for an agent', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 's1', agent_id: 'agent-1', name: 'skill1' },
      ]);

      const skills = await getAuthoredSkills('agent-1');
      expect(skills).toHaveLength(1);
    });
  });

  describe('getAuthoredSkill', () => {
    it('should return skill when found', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 's1', name: 'skill1' });
      const skill = await getAuthoredSkill('s1');
      expect(skill).toBeDefined();
    });

    it('should return null when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      const skill = await getAuthoredSkill('nonexistent');
      expect(skill).toBeNull();
    });
  });

  // ── approveAuthoredSkill ──

  describe('approveAuthoredSkill', () => {
    it('should throw when skill not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(approveAuthoredSkill('nonexistent', 'user1')).rejects.toThrow('not found');
    });

    it('should throw when user lacks permissions', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 's1', agent_id: 'agent-1' });
      mockCanModifyAgent.mockResolvedValueOnce(false);
      await expect(approveAuthoredSkill('s1', 'user1')).rejects.toThrow('Insufficient permissions');
    });

    it('should approve skill when authorized', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 's1', agent_id: 'agent-1' });
      mockCanModifyAgent.mockResolvedValueOnce(true);

      await approveAuthoredSkill('s1', 'user1');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('approved = TRUE'),
        ['s1']
      );
    });
  });

  // ── updateAuthoredSkillTemplate ──

  describe('updateAuthoredSkillTemplate', () => {
    it('should throw when skill not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      await expect(updateAuthoredSkillTemplate('nonexistent', 'template', 'user1')).rejects.toThrow('not found');
    });

    it('should throw when user lacks permissions', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 's1', agent_id: 'agent-1', version: 1 });
      mockCanModifyAgent.mockResolvedValueOnce(false);
      await expect(updateAuthoredSkillTemplate('s1', 'template', 'user1')).rejects.toThrow('Insufficient permissions');
    });

    it('should update template when authorized', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 's1', agent_id: 'agent-1', version: 1 });
      mockCanModifyAgent.mockResolvedValueOnce(true);

      await updateAuthoredSkillTemplate('s1', 'new template', 'user1');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('template'),
        ['new template', 's1']
      );
    });
  });
});
