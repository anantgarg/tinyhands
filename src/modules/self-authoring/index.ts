import { v4 as uuid } from 'uuid';
import Dockerode from 'dockerode';
import { writeFileSync, unlinkSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { query, getClient } from '../../db';
import { getAgent, updateAgent } from '../agents';
import { registerCustomTool, getCustomTool, listCustomTools } from '../tools';
import { registerSkill, attachSkillToAgent } from '../skills';
import { createProposal } from '../self-evolution';
import { canModifyAgent } from '../access-control';
import { config } from '../../config';
import type { CustomTool, AuthoredSkill, CodeArtifact, McpConfig } from '../../types';
import { logger } from '../../utils/logger';

const docker = new Dockerode();

// ── Types ──

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  language: 'javascript' | 'python' | 'bash';
}

export interface AuthorToolResult {
  tool: CustomTool;
  code: string;
  testResult: SandboxTestResult | null;
  requiresApproval: boolean;
}

export interface SandboxTestResult {
  passed: boolean;
  output: string;
  error: string | null;
  durationMs: number;
}

export interface ToolAnalytics {
  toolName: string;
  totalRuns: number;
  successRate: number;
  avgDurationMs: number;
  lastUsed: string | null;
  lastError: string | null;
}

// ══════════════════════════════════════════════════
//  1. AI-POWERED TOOL AUTHORING (generate → validate → test → store)
// ══════════════════════════════════════════════════

export async function authorTool(
  agentId: string,
  taskDescription: string,
): Promise<AuthorToolResult> {
  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  // Step 1: AI generates tool specification and implementation
  const { spec, code } = await generateToolCode(taskDescription, agent.name);

  // Step 2: Validate name + code
  validateToolName(spec.name);
  validateToolCode(code, spec.language);

  // Step 3: Sandbox test — run with sample input, verify it doesn't crash
  let testResult: SandboxTestResult | null = null;
  try {
    testResult = await sandboxTest(code, spec.language, spec.inputSchema);
  } catch (err: any) {
    logger.warn('Sandbox test failed, proceeding with warning', { error: err.message });
  }

  // Step 4: If test failed, attempt AI auto-fix (one retry)
  let finalCode = code;
  if (testResult && !testResult.passed) {
    try {
      const fixed = await autoFixToolCode(code, spec, testResult.error || 'Unknown error', agent.name);
      validateToolCode(fixed, spec.language);
      const retestResult = await sandboxTest(fixed, spec.language, spec.inputSchema);
      if (retestResult.passed) {
        finalCode = fixed;
        testResult = retestResult;
        logger.info('Auto-fix succeeded', { toolName: spec.name });
      }
    } catch {
      logger.warn('Auto-fix attempt failed, using original code', { toolName: spec.name });
    }
  }

  // Step 5: Store in DB
  const needsApproval = agent.self_evolution_mode === 'approve-first';
  const tool = await registerCustomTool(
    spec.name,
    JSON.stringify(spec.inputSchema),
    null,
    agentId,
    { code: finalCode, language: spec.language, autoApprove: !needsApproval }
  );

  // Step 6: Record in tool_runs for analytics baseline
  await recordToolRun(spec.name, agentId, testResult?.passed ?? false, testResult?.durationMs ?? 0, testResult?.error ?? null);

  // Step 7: Audit trail
  await createProposal(agentId, 'write_tool', `Auto-authored tool: ${spec.name} — ${spec.description}`, JSON.stringify({
    name: spec.name,
    description: spec.description,
    schema: spec.inputSchema,
    language: spec.language,
    code: finalCode,
    stored_in_db: true,
    test_passed: testResult?.passed ?? null,
  }));

  logger.info('Agent authored new tool', {
    agentId, toolName: spec.name, language: spec.language,
    codeLength: finalCode.length, needsApproval,
    testPassed: testResult?.passed ?? null,
  });

  return { tool, code: finalCode, testResult, requiresApproval: needsApproval };
}

// ══════════════════════════════════════════════════
//  2. TOOL VERSIONING — rollback to any previous version
// ══════════════════════════════════════════════════

export async function updateToolCode(
  toolName: string,
  newCode: string,
  language: 'javascript' | 'python' | 'bash',
  userId: string,
): Promise<void> {
  const tool = await getCustomTool(toolName);
  if (!tool) throw new Error(`Tool "${toolName}" not found`);

  // Validate before starting transaction
  validateToolCode(newCode, language);

  // Archive + update atomically to prevent race conditions
  const client = await getClient();
  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO tool_versions (id, tool_name, version, script_code, language, changed_by, created_at)
      VALUES ($1, $2, (SELECT COALESCE(MAX(version), 0) + 1 FROM tool_versions WHERE tool_name = $3), $4, $5, $6, NOW()::text)
    `, [uuid(), toolName, toolName, tool.script_code || '', tool.language, userId]);

    await client.query('UPDATE custom_tools SET script_code = $1, language = $2 WHERE name = $3', [newCode, language, toolName]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  logger.info('Tool code updated', { toolName, userId });
}

export async function rollbackTool(toolName: string, version: number, userId: string): Promise<void> {
  const { rows } = await query(
    'SELECT script_code, language FROM tool_versions WHERE tool_name = $1 AND version = $2',
    [toolName, version]
  );

  if (rows.length === 0) throw new Error(`Version ${version} not found for tool "${toolName}"`);

  // Archive current before rollback
  await updateToolCode(toolName, rows[0].script_code, rows[0].language as any, userId);
  logger.info('Tool rolled back', { toolName, version, userId });
}

export async function getToolVersions(toolName: string): Promise<Array<{ version: number; changed_by: string; created_at: string }>> {
  const { rows } = await query(
    'SELECT version, changed_by, created_at FROM tool_versions WHERE tool_name = $1 ORDER BY version DESC',
    [toolName]
  );
  return rows as any[];
}

// ══════════════════════════════════════════════════
//  3. SANDBOX TESTING — validate tool code before deployment
// ══════════════════════════════════════════════════

async function sandboxTest(
  code: string,
  language: string,
  inputSchema: Record<string, any>,
): Promise<SandboxTestResult> {
  const startTime = Date.now();

  // Generate sample input from schema
  const sampleInput = generateSampleInput(inputSchema);
  const wrappedCode = wrapForExecution(code, language, 'sandbox-test');

  const extMap: Record<string, string> = { javascript: 'js', python: 'py', bash: 'sh' };
  const ext = extMap[language] || 'js';

  let interpreter: string;
  switch (language) {
    case 'javascript': interpreter = 'node'; break;
    case 'python': interpreter = 'python3'; break;
    case 'bash': interpreter = 'bash'; break;
    default:
      return { passed: false, output: '', error: `Unsupported language: ${language}`, durationMs: 0 };
  }

  // Write code to a temp file on host, mount read-only into throwaway container
  const tmpDir = mkdtempSync(join(tmpdir(), 'tj-sandbox-'));
  const tmpFile = join(tmpDir, `test.${ext}`);
  writeFileSync(tmpFile, wrappedCode, 'utf-8');

  let container: Dockerode.Container | null = null;
  try {
    const image = config.docker.baseImage;

    container = await docker.createContainer({
      Image: image,
      Cmd: [interpreter, `/sandbox/test.${ext}`],
      Env: [`INPUT=${JSON.stringify(sampleInput)}`],
      WorkingDir: '/sandbox',
      HostConfig: {
        Binds: [`${tmpDir}:/sandbox:ro`],
        Memory: 256 * 1024 * 1024, // 256MB
        NanoCpus: 0.5e9, // 0.5 CPU
        NetworkMode: 'none',
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        AutoRemove: true,
        // tmpfs for interpreters that need writable /tmp
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=16m' },
      },
      Labels: {
        'tinyjobs.sandbox': 'true',
        'tinyjobs.sandbox_language': language,
      },
    });

    await container.start();

    // Wait with 15s timeout
    const { exitCode } = await new Promise<{ exitCode: number }>((resolve, reject) => {
      const timer = setTimeout(async () => {
        try { await container!.kill(); } catch {}
        reject(new Error('Sandbox test timed out after 15s'));
      }, 15000);

      container!.wait()
        .then((result: { StatusCode: number }) => {
          clearTimeout(timer);
          resolve({ exitCode: result.StatusCode });
        })
        .catch((err: Error) => {
          clearTimeout(timer);
          reject(err);
        });
    });

    // Read logs before container auto-removes
    const logs = await container.logs({ stdout: true, stderr: true, follow: false });
    const output = logs.toString('utf8').trim();

    if (exitCode !== 0) {
      return {
        passed: false,
        output: '',
        error: (output || `Process exited with code ${exitCode}`).slice(0, 2000),
        durationMs: Date.now() - startTime,
      };
    }

    return {
      passed: true,
      output: output.slice(0, 2000),
      error: null,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    // Try to clean up container if it wasn't auto-removed
    if (container) {
      try { await container.remove({ force: true }); } catch {}
    }

    return {
      passed: false,
      output: '',
      error: (err.message || 'Unknown sandbox error').slice(0, 2000),
      durationMs: Date.now() - startTime,
    };
  } finally {
    // Clean up temp file and directory
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  }
}

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

// ══════════════════════════════════════════════════
//  4. AUTO-FIX — AI repairs broken tool code
// ══════════════════════════════════════════════════

async function autoFixToolCode(
  brokenCode: string,
  spec: ToolSpec,
  errorMessage: string,
  agentName: string,
): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: `You are fixing a broken tool script for AI agent "${agentName}".
The tool "${spec.name}" failed sandbox testing. Fix the code so it works correctly.
Return ONLY the fixed code — no JSON wrapping, no markdown, just the raw code.
The code must:
- Read input from process.env.INPUT (JS) or os.environ['INPUT'] (Python) as JSON
- Print result to stdout
- Be self-contained (stdlib only)
- Not use: eval, exec, spawn, child_process, process.exit, Function constructor`,
    messages: [{
      role: 'user',
      content: `Tool spec: ${JSON.stringify(spec)}

Broken code:
\`\`\`
${brokenCode}
\`\`\`

Error:
${errorMessage}

Fix the code. Return ONLY the fixed code.`,
    }],
  });

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('');

  // Strip markdown code fences if present
  const codeMatch = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
  return codeMatch ? codeMatch[1].trim() : text.trim();
}

// ══════════════════════════════════════════════════
//  5. TOOL ANALYTICS — track success/failure rates per tool
// ══════════════════════════════════════════════════

export async function recordToolRun(
  toolName: string,
  agentId: string,
  success: boolean,
  durationMs: number,
  error: string | null,
): Promise<void> {
  await query(`
    INSERT INTO tool_runs (id, tool_name, agent_id, success, duration_ms, error, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW()::text)
  `, [uuid(), toolName, agentId, success, durationMs, error]);
}

export async function getToolAnalytics(toolName: string): Promise<ToolAnalytics> {
  const { rows: statsRows } = await query(`
    SELECT
      COUNT(*) as total_runs,
      SUM(CASE WHEN success = true THEN 1 ELSE 0 END) as successes,
      AVG(duration_ms) as avg_duration,
      MAX(created_at) as last_used
    FROM tool_runs WHERE tool_name = $1
  `, [toolName]);

  const stats = statsRows[0];

  const { rows: errorRows } = await query(
    'SELECT error FROM tool_runs WHERE tool_name = $1 AND success = false ORDER BY created_at DESC LIMIT 1',
    [toolName]
  );

  return {
    toolName,
    totalRuns: parseInt(stats?.total_runs) || 0,
    successRate: parseInt(stats?.total_runs) > 0 ? (parseInt(stats.successes) / parseInt(stats.total_runs)) : 0,
    avgDurationMs: Math.round(parseFloat(stats?.avg_duration) || 0),
    lastUsed: stats?.last_used || null,
    lastError: errorRows[0]?.error || null,
  };
}

export async function getAllToolAnalytics(agentId?: string): Promise<ToolAnalytics[]> {
  let toolNames: { tool_name: string }[];
  if (agentId) {
    const { rows } = await query('SELECT DISTINCT tool_name FROM tool_runs WHERE agent_id = $1', [agentId]);
    toolNames = rows;
  } else {
    const { rows } = await query('SELECT DISTINCT tool_name FROM tool_runs');
    toolNames = rows;
  }

  const results: ToolAnalytics[] = [];
  for (const t of toolNames) {
    results.push(await getToolAnalytics(t.tool_name));
  }
  return results;
}

// ══════════════════════════════════════════════════
//  6. TOOL SHARING — agents share tools with each other
// ══════════════════════════════════════════════════

export async function shareToolWithAgent(
  toolName: string,
  fromAgentId: string,
  toAgentId: string,
): Promise<void> {
  const tool = await getCustomTool(toolName);
  if (!tool) throw new Error(`Tool "${toolName}" not found`);
  if (tool.registered_by !== fromAgentId) {
    throw new Error(`Agent does not own tool "${toolName}"`);
  }

  const toAgent = await getAgent(toAgentId);
  if (!toAgent) throw new Error(`Target agent ${toAgentId} not found`);

  // Add tool to target agent's tool list
  const tools = [...toAgent.tools];
  if (!tools.includes(toolName)) {
    tools.push(toolName);
    await updateAgent(toAgentId, { tools }, fromAgentId);
  }

  logger.info('Tool shared between agents', { toolName, from: fromAgentId, to: toAgentId });
}

export async function discoverTools(queryText: string, agentId?: string): Promise<CustomTool[]> {
  const allTools = await listCustomTools();

  // Search by name and schema description
  const queryLower = queryText.toLowerCase();
  return allTools.filter(t => {
    const nameMatch = t.name.toLowerCase().includes(queryLower);
    const schemaMatch = t.schema_json.toLowerCase().includes(queryLower);
    return nameMatch || schemaMatch;
  });
}

// ══════════════════════════════════════════════════
//  7. TOOL COMPOSITION — chain multiple tools into a pipeline
// ══════════════════════════════════════════════════

export interface ToolPipeline {
  name: string;
  description: string;
  steps: Array<{
    toolName: string;
    inputMapping: Record<string, string>; // maps pipeline input keys → tool input keys
  }>;
}

export async function createToolPipeline(
  agentId: string,
  pipeline: ToolPipeline,
): Promise<CustomTool> {
  // Validate all referenced tools exist
  for (const step of pipeline.steps) {
    const tool = await getCustomTool(step.toolName);
    if (!tool) throw new Error(`Pipeline step references unknown tool: ${step.toolName}`);
  }

  // Generate pipeline execution code (system-generated, skip user validation)
  const pipelineCode = generatePipelineCode(pipeline);

  // Build combined schema from first step's input
  const firstTool = await getCustomTool(pipeline.steps[0].toolName);
  const schema = firstTool ? JSON.parse(firstTool.schema_json) : { type: 'object', properties: {} };

  const tool = await registerCustomTool(
    pipeline.name,
    JSON.stringify(schema),
    null,
    agentId,
    { code: pipelineCode, language: 'javascript', autoApprove: true },
  );

  logger.info('Tool pipeline created', {
    name: pipeline.name,
    steps: pipeline.steps.map(s => s.toolName),
    agentId,
  });

  return tool;
}

function generatePipelineCode(pipeline: ToolPipeline): string {
  // Pipeline code uses vm module (stdlib) to run steps in-process — avoids child_process
  const stepConfigs = JSON.stringify(pipeline.steps.map(s => ({
    toolName: s.toolName,
    inputMapping: s.inputMapping,
  })));

  return `'use strict';
const fs = require('fs');
const vm = require('vm');
const input = JSON.parse(process.env.INPUT || '{}');
const steps = ${stepConfigs};
let prevResult = null;

for (const step of steps) {
  const stepInput = {};
  if (Object.keys(step.inputMapping).length > 0) {
    for (const [from, to] of Object.entries(step.inputMapping)) {
      stepInput[to] = (prevResult || input)[from] || input[from];
    }
  } else {
    Object.assign(stepInput, prevResult || input);
  }

  const exts = ['js', 'py', 'sh'];
  let scriptPath = null;
  for (const ext of exts) {
    const p = '/tools/' + step.toolName + '.' + ext;
    if (fs.existsSync(p)) { scriptPath = p; break; }
  }
  if (!scriptPath) throw new Error('Tool script not found: ' + step.toolName);

  const script = fs.readFileSync(scriptPath, 'utf-8');
  const sandbox = { process: { env: { ...process.env, INPUT: JSON.stringify(stepInput) } }, console: { log: function(v) { prevResult = typeof v === 'string' ? JSON.parse(v) : v; } }, JSON, Math, Date, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Buffer, setTimeout: undefined, setInterval: undefined };
  vm.runInNewContext(script, sandbox, { timeout: 30000 });
}

console.log(JSON.stringify(prevResult));`;
}

// ══════════════════════════════════════════════════
//  8. AI-POWERED SKILL AUTHORING
// ══════════════════════════════════════════════════

export async function authorSkill(
  agentId: string,
  taskDescription: string,
): Promise<AuthoredSkill> {
  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const { name, description, template } = await generateSkillTemplate(taskDescription, agent.name);

  const id = uuid();
  const needsApproval = agent.self_evolution_mode === 'approve-first';

  const skill: AuthoredSkill = {
    id,
    agent_id: agentId,
    name,
    description,
    skill_type: 'prompt_template',
    template,
    version: 1,
    approved: !needsApproval,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await query(`
    INSERT INTO authored_skills (id, agent_id, name, description, skill_type, template, version, approved, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [skill.id, skill.agent_id, skill.name, skill.description,
    skill.skill_type, skill.template, skill.version, skill.approved,
    skill.created_at, skill.updated_at]);

  // Register globally so other agents can use it
  await registerSkill(name, 'prompt_template', {
    authored_by: agentId,
    description,
    template,
  });

  await attachSkillToAgent(agentId, name, 'write', agentId);

  await createProposal(agentId, 'add_to_kb', `Authored skill: ${name}`, JSON.stringify({
    name, description, template, stored_in_db: true,
  }));

  logger.info('Agent authored new skill', { agentId, skillName: name, needsApproval });
  return skill;
}

// ══════════════════════════════════════════════════
//  9. MCP CONFIG QUERIES (all DB-stored)
// ══════════════════════════════════════════════════

export async function getMcpConfigs(agentId: string): Promise<McpConfig[]> {
  const { rows } = await query(
    'SELECT * FROM mcp_configs WHERE agent_id = $1 ORDER BY created_at DESC',
    [agentId]
  );
  return rows as McpConfig[];
}

export async function approveMcpConfig(id: string, userId: string): Promise<void> {
  const { rows } = await query('SELECT * FROM mcp_configs WHERE id = $1', [id]);
  const mcpConfig = rows[0] as McpConfig | undefined;
  if (!mcpConfig) throw new Error(`MCP config ${id} not found`);
  if (!(await canModifyAgent(mcpConfig.agent_id, userId))) throw new Error('Insufficient permissions');
  await query("UPDATE mcp_configs SET approved = true, updated_at = NOW()::text WHERE id = $1", [id]);
  logger.info('MCP config approved', { id, userId });
}

// ══════════════════════════════════════════════════
//  10. CODE ARTIFACT QUERIES (all DB-stored)
// ══════════════════════════════════════════════════

export async function getCodeArtifacts(agentId: string): Promise<CodeArtifact[]> {
  const { rows } = await query(
    'SELECT * FROM code_artifacts WHERE agent_id = $1 ORDER BY updated_at DESC',
    [agentId]
  );
  return rows as CodeArtifact[];
}

export async function getCodeArtifact(agentId: string, filePath: string): Promise<CodeArtifact | null> {
  const { rows } = await query(
    'SELECT * FROM code_artifacts WHERE agent_id = $1 AND file_path = $2',
    [agentId, filePath]
  );
  return rows[0] as CodeArtifact | null ?? null;
}

// ══════════════════════════════════════════════════
//  11. SKILL/TOOL QUERIES
// ══════════════════════════════════════════════════

export async function getAuthoredSkills(agentId: string): Promise<AuthoredSkill[]> {
  const { rows } = await query(
    'SELECT * FROM authored_skills WHERE agent_id = $1 ORDER BY created_at DESC',
    [agentId]
  );
  return rows as AuthoredSkill[];
}

export async function getAuthoredSkill(id: string): Promise<AuthoredSkill | null> {
  const { rows } = await query('SELECT * FROM authored_skills WHERE id = $1', [id]);
  return rows[0] as AuthoredSkill | null ?? null;
}

export async function approveAuthoredSkill(id: string, userId: string): Promise<void> {
  const skill = await getAuthoredSkill(id);
  if (!skill) throw new Error(`Authored skill ${id} not found`);
  if (!(await canModifyAgent(skill.agent_id, userId))) throw new Error('Insufficient permissions');
  await query("UPDATE authored_skills SET approved = true, updated_at = NOW()::text WHERE id = $1", [id]);
  logger.info('Authored skill approved', { id, userId });
}

export async function updateAuthoredSkillTemplate(id: string, template: string, userId: string): Promise<void> {
  const skill = await getAuthoredSkill(id);
  if (!skill) throw new Error(`Authored skill ${id} not found`);
  if (!(await canModifyAgent(skill.agent_id, userId))) throw new Error('Insufficient permissions');
  await query(
    "UPDATE authored_skills SET template = $1, version = version + 1, updated_at = NOW()::text WHERE id = $2",
    [template, id]
  );
  logger.info('Authored skill template updated', { id, version: skill.version + 1 });
}

// ══════════════════════════════════════════════════
//  AI CODE GENERATION
// ══════════════════════════════════════════════════

async function generateToolCode(
  taskDescription: string,
  agentName: string
): Promise<{ spec: ToolSpec; code: string }> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic();

  // Include existing tools in context so AI avoids duplicates
  const existingTools = (await listCustomTools()).map(t => t.name).join(', ');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: `You are a tool-authoring assistant for AI agent "${agentName}".
Generate a self-contained tool that can be executed in a sandboxed Docker container.

Existing tools (avoid name collisions): ${existingTools || 'none'}

Return ONLY valid JSON with this schema:
{
  "name": "tool-name-kebab-case",
  "description": "What the tool does",
  "language": "javascript",
  "inputSchema": {
    "type": "object",
    "properties": { ... },
    "required": [...]
  },
  "code": "// Self-contained script that reads INPUT env var as JSON, does work, writes result to stdout",
  "testInput": { ... }
}

Rules:
- Name must be kebab-case, 3-40 chars, unique
- Code must be self-contained (Node.js stdlib or Python stdlib only)
- Code reads input from process.env.INPUT (JSON string) and prints JSON result to stdout
- No network calls unless explicitly needed
- No file system writes outside /tmp
- Keep code under 200 lines
- Language must be "javascript", "python", or "bash"
- Include testInput: a sample input object that exercises the tool`,
    messages: [{
      role: 'user',
      content: `Create a tool for this purpose: ${taskDescription}`,
    }],
  });

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    spec: {
      name: parsed.name,
      description: parsed.description,
      inputSchema: parsed.inputSchema || { type: 'object', properties: {} },
      language: parsed.language || 'javascript',
    },
    code: parsed.code,
  };
}

async function generateSkillTemplate(
  taskDescription: string,
  agentName: string
): Promise<{ name: string; description: string; template: string }> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic();

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: `You author reusable prompt template skills for AI agent "${agentName}".
Return ONLY valid JSON:
{
  "name": "skill-name-kebab-case",
  "description": "What this skill does",
  "template": "The prompt template with {{variable}} placeholders"
}
Keep templates focused, under 500 words. Use {{placeholders}} for dynamic values.`,
    messages: [{
      role: 'user',
      content: `Create a reusable skill template for: ${taskDescription}`,
    }],
  });

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');

  return JSON.parse(jsonMatch[0]);
}

// ══════════════════════════════════════════════════
//  CODE VALIDATION
// ══════════════════════════════════════════════════

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

export function validateToolCode(code: string, language: string): void {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      throw new Error(`Tool code contains forbidden pattern: ${pattern.source}`);
    }
  }

  if (code.length > 50000) {
    throw new Error('Tool code exceeds maximum size (50KB)');
  }

  if (code.split('\n').length > 500) {
    throw new Error('Tool code exceeds maximum line count (500 lines)');
  }
}

/**
 * Validate tool name — must be safe for use as filename and shell arg.
 */
export function validateToolName(name: string): void {
  if (!name || name.length < 3 || name.length > 40) {
    throw new Error('Tool name must be 3-40 characters');
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) {
    throw new Error('Tool name must be kebab-case (a-z, 0-9, hyphens, no leading/trailing hyphens)');
  }
  if (name.includes('--')) {
    throw new Error('Tool name must not contain consecutive hyphens');
  }
}

/**
 * Validate file path for code artifacts — prevent path traversal.
 */
export function validateArtifactPath(filePath: string): void {
  // Normalize and reject traversal
  if (filePath.includes('..') || filePath.includes('\0')) {
    throw new Error('File path must not contain ".." or null bytes');
  }
  if (!filePath.startsWith('/')) {
    throw new Error('File path must be absolute');
  }
  // Block sensitive paths
  const blockedPrefixes = ['/etc/', '/proc/', '/sys/', '/dev/', '/boot/', '/root/', '/var/run/'];
  for (const prefix of blockedPrefixes) {
    if (filePath.startsWith(prefix)) {
      throw new Error(`File path cannot target ${prefix}`);
    }
  }
}

// ══════════════════════════════════════════════════
//  TOOL EXECUTION SCRIPT GENERATION
// ══════════════════════════════════════════════════

function wrapForExecution(code: string, language: string, toolName: string): string {
  switch (language) {
    case 'javascript':
      return `'use strict';
const input = JSON.parse(process.env.INPUT || '{}');
// ── Agent-authored tool: ${toolName} ──
${code}`;
    case 'python':
      return `import os, json, sys
input_data = json.loads(os.environ.get('INPUT', '{}'))
# ── Agent-authored tool: ${toolName} ──
${code}`;
    case 'bash':
      return `set -euo pipefail
INPUT="\${INPUT:-'{}'}"
# ── Agent-authored tool: ${toolName} ──
${code}`;
    default:
      return code;
  }
}

export function getToolExecutionScript(toolName: string): string | null {
  // NOTE: This function remains synchronous because it reads from a tool object
  // that was already fetched. The caller should pass the tool object or use
  // the async version. For backward compat, we use a sync workaround.
  // In practice, getCustomTool is called before this in the execution flow.
  return null; // Callers should use getToolExecutionScriptAsync instead
}

export async function getToolExecutionScriptAsync(toolName: string): Promise<string | null> {
  const tool = await getCustomTool(toolName);
  if (!tool?.script_code || !tool.approved) return null;

  const shebangMap: Record<string, string> = {
    javascript: '#!/usr/bin/env node',
    python: '#!/usr/bin/env python3',
    bash: '#!/usr/bin/env bash',
  };

  const shebang = shebangMap[tool.language] || shebangMap.javascript;
  return `${shebang}\n${wrapForExecution(tool.script_code, tool.language, toolName)}\n`;
}
