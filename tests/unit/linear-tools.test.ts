import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockRegisterCustomTool = vi.fn();
const mockGetCustomTool = vi.fn();

vi.mock('../../src/db', () => ({
  query: vi.fn(),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
}));

vi.mock('../../src/modules/tools/index', () => ({
  registerCustomTool: (...args: any[]) => mockRegisterCustomTool(...args),
  getCustomTool: (...args: any[]) => mockGetCustomTool(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerLinearTools, updateLinearConfig } from '../../src/modules/tools/linear';

// ── Helpers ──

const LINEAR_CONFIG = {
  api_key: 'lin_api_test123abc',
};

// ── Tests ──

describe('Linear Tools Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────
  // Tool Schema Definitions
  // ────────────────────────────────────────────────
  describe('Tool Schema Definitions', () => {
    it('registers read tool with correct name and schema', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const readCall = mockRegisterCustomTool.mock.calls[0];
      expect(readCall[0]).toBe('linear-read');

      const readSchema = JSON.parse(readCall[1]);
      expect(readSchema.type).toBe('object');
      expect(readSchema.description).toContain('Read-only access to Linear');
      expect(readSchema.properties.action.enum).toEqual([
        'search_issues', 'get_issue', 'list_projects', 'list_teams',
        'get_cycles', 'get_labels', 'get_user',
      ]);
      expect(readSchema.required).toEqual(['action']);
    });

    it('registers write tool with correct name and schema', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const writeCall = mockRegisterCustomTool.mock.calls[1];
      expect(writeCall[0]).toBe('linear-write');

      const writeSchema = JSON.parse(writeCall[1]);
      expect(writeSchema.type).toBe('object');
      expect(writeSchema.description).toContain('Create and update Linear issues');
      expect(writeSchema.description).toContain('No destructive actions');
      expect(writeSchema.properties.action.enum).toEqual([
        'create_issue', 'update_issue', 'add_comment', 'create_project',
      ]);
      expect(writeSchema.required).toEqual(['action']);
    });

    it('read schema includes all expected parameter fields', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      const propKeys = Object.keys(readSchema.properties);
      expect(propKeys).toContain('action');
      expect(propKeys).toContain('query');
      expect(propKeys).toContain('issue_id');
      expect(propKeys).toContain('team_id');
      expect(propKeys).toContain('user_id');
      expect(propKeys).toContain('status');
      expect(propKeys).toContain('limit');
    });

    it('write schema includes all expected parameter fields', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const writeSchema = JSON.parse(mockRegisterCustomTool.mock.calls[1][1]);
      const propKeys = Object.keys(writeSchema.properties);
      expect(propKeys).toContain('action');
      expect(propKeys).toContain('title');
      expect(propKeys).toContain('description');
      expect(propKeys).toContain('team_id');
      expect(propKeys).toContain('issue_id');
      expect(propKeys).toContain('state_id');
      expect(propKeys).toContain('priority');
      expect(propKeys).toContain('assignee_id');
      expect(propKeys).toContain('label_ids');
      expect(propKeys).toContain('project_id');
      expect(propKeys).toContain('cycle_id');
      expect(propKeys).toContain('body');
    });

    it('read schema issue_id and team_id are strings', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      expect(readSchema.properties.issue_id.type).toBe('string');
      expect(readSchema.properties.team_id.type).toBe('string');
      expect(readSchema.properties.user_id.type).toBe('string');
    });

    it('read schema limit is a number', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      expect(readSchema.properties.limit.type).toBe('number');
    });

    it('write schema priority is a number (0-4)', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const writeSchema = JSON.parse(mockRegisterCustomTool.mock.calls[1][1]);
      expect(writeSchema.properties.priority.type).toBe('number');
      expect(writeSchema.properties.priority.description).toContain('0=none');
      expect(writeSchema.properties.priority.description).toContain('1=urgent');
      expect(writeSchema.properties.priority.description).toContain('4=low');
    });

    it('write schema label_ids is an array of strings', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const writeSchema = JSON.parse(mockRegisterCustomTool.mock.calls[1][1]);
      expect(writeSchema.properties.label_ids.type).toBe('array');
      expect(writeSchema.properties.label_ids.items.type).toBe('string');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code - Auth Header Construction
  // ────────────────────────────────────────────────
  describe('Tool Code - Auth and API Construction', () => {
    it('read tool uses API key directly as Authorization header (no Bearer)', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("'Authorization': apiKey");
      // Linear API uses the raw key, not "Bearer" prefix
      expect(code).not.toContain("'Bearer ' + apiKey");
    });

    it('write tool uses API key directly as Authorization header', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("'Authorization': apiKey");
    });

    it('both tools target api.linear.app/graphql', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const readCode = mockRegisterCustomTool.mock.calls[0][4].code;
      const writeCode = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(readCode).toContain("hostname: 'api.linear.app'");
      expect(readCode).toContain("path: '/graphql'");
      expect(writeCode).toContain("hostname: 'api.linear.app'");
      expect(writeCode).toContain("path: '/graphql'");
    });

    it('both tools use POST method for GraphQL', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const readCode = mockRegisterCustomTool.mock.calls[0][4].code;
      const writeCode = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(readCode).toContain("method: 'POST'");
      expect(writeCode).toContain("method: 'POST'");
    });

    it('read tool reads config from linear-read.config.json', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("'linear-read.config.json'");
    });

    it('write tool reads config from linear-write.config.json', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("'linear-write.config.json'");
    });

    it('both tools exit gracefully when API key is missing', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const readCode = mockRegisterCustomTool.mock.calls[0][4].code;
      const writeCode = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(readCode).toContain('if (!apiKey)');
      expect(readCode).toContain('Linear API key not configured');
      expect(readCode).toContain('process.exit(0)');
      expect(writeCode).toContain('if (!apiKey)');
      expect(writeCode).toContain('Linear API key not configured');
    });

    it('both tools set a 30-second request timeout', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const readCode = mockRegisterCustomTool.mock.calls[0][4].code;
      const writeCode = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(readCode).toContain('req.setTimeout(30000');
      expect(writeCode).toContain('req.setTimeout(30000');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code - Read Actions
  // ────────────────────────────────────────────────
  describe('Tool Code - Read Actions', () => {
    it('read tool handles search_issues action with GraphQL issueSearch query', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'search_issues':");
      expect(code).toContain('issueSearch');
      expect(code).toContain("if (!query) { result = { error: 'query is required for search_issues' }");
    });

    it('read tool handles get_issue action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_issue':");
      expect(code).toContain('issue(id:');
      expect(code).toContain("if (!issue_id) { result = { error: 'issue_id is required' }");
    });

    it('read tool handles list_projects action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'list_projects':");
      expect(code).toContain('projects(first:');
    });

    it('read tool handles list_teams action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'list_teams':");
      expect(code).toContain('teams(first: 50)');
    });

    it('read tool handles get_cycles action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_cycles':");
      expect(code).toContain("if (!team_id) { result = { error: 'team_id is required for get_cycles' }");
      expect(code).toContain('cycles(first:');
    });

    it('read tool handles get_labels action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_labels':");
      expect(code).toContain('issueLabels');
    });

    it('read tool handles get_user action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_user':");
      expect(code).toContain('user(id:');
      expect(code).toContain("if (!user_id) { result = { error: 'user_id is required' }");
    });

    it('read tool handles unknown action with error', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("'Unknown action: ' + action");
    });

    it('read tool applies limit capping at 50', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain('Math.min(limit || 25, 50)');
    });

    it('read tool supports status filter for search_issues', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain('filter: { state: { name: { eq:');
    });

    it('read tool supports team_id filter for list_projects', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain('accessibleTeams: { id: { eq:');
    });

    it('read tool escapes double quotes in query strings', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain('query.replace(/"/g,');
      expect(code).toContain('issue_id.replace(/"/g,');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code - Write Actions
  // ────────────────────────────────────────────────
  describe('Tool Code - Write Actions', () => {
    it('write tool handles create_issue action with GraphQL mutation', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("case 'create_issue':");
      expect(code).toContain("if (!title || !team_id) { result = { error: 'title and team_id are required for create_issue' }");
      expect(code).toContain('issueCreate(input:');
    });

    it('write tool handles update_issue action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("case 'update_issue':");
      expect(code).toContain("if (!issue_id) { result = { error: 'issue_id is required for update_issue' }");
      expect(code).toContain('issueUpdate(id:');
    });

    it('write tool handles add_comment action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("case 'add_comment':");
      expect(code).toContain("if (!issue_id || !body) { result = { error: 'issue_id and body are required for add_comment' }");
      expect(code).toContain('commentCreate(input:');
    });

    it('write tool handles create_project action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("case 'create_project':");
      expect(code).toContain("if (!title) { result = { error: 'title is required for create_project' }");
      expect(code).toContain('projectCreate(input:');
    });

    it('write tool returns error when no fields to update in update_issue', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("if (fields.length === 0) { result = { error: 'No fields to update' }");
    });

    it('write tool handles unknown action with error', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("'Unknown action: ' + action");
    });

    it('write tool supports optional fields for create_issue (priority, assignee, project, cycle, labels)', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("if (priority !== undefined) fields.push('priority: ' + priority)");
      expect(code).toContain("if (assignee_id) fields.push('assigneeId:");
      expect(code).toContain("if (project_id) fields.push('projectId:");
      expect(code).toContain("if (cycle_id) fields.push('cycleId:");
      expect(code).toContain('if (label_ids && label_ids.length > 0)');
    });

    it('write tool escapes quotes and newlines in description and body', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("description.replace(/\"/g, '\\\\\"')");
      expect(code).toContain("body.replace(/\"/g, '\\\\\"')");
    });
  });

  // ────────────────────────────────────────────────
  // registerLinearTools
  // ────────────────────────────────────────────────
  describe('registerLinearTools', () => {
    it('registers both read and write tools when neither exists', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(2);
      expect(mockGetCustomTool).toHaveBeenCalledWith('linear-read');
      expect(mockGetCustomTool).toHaveBeenCalledWith('linear-write');
    });

    it('passes configJson to both tools', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const expectedConfigJson = JSON.stringify(LINEAR_CONFIG);
      expect(mockRegisterCustomTool.mock.calls[0][4].configJson).toBe(expectedConfigJson);
      expect(mockRegisterCustomTool.mock.calls[1][4].configJson).toBe(expectedConfigJson);
    });

    it('registers read tool with read-only access level', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const readOptions = mockRegisterCustomTool.mock.calls[0][4];
      expect(readOptions.language).toBe('javascript');
      expect(readOptions.autoApprove).toBe(true);
      expect(readOptions.accessLevel).toBe('read-only');
    });

    it('registers write tool with read-write access level', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      const writeOptions = mockRegisterCustomTool.mock.calls[1][4];
      expect(writeOptions.language).toBe('javascript');
      expect(writeOptions.autoApprove).toBe(true);
      expect(writeOptions.accessLevel).toBe('read-write');
    });

    it('passes null as scriptPath and adminUserId correctly', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      expect(mockRegisterCustomTool.mock.calls[0][2]).toBeNull();
      expect(mockRegisterCustomTool.mock.calls[0][3]).toBe('admin-1');
      expect(mockRegisterCustomTool.mock.calls[1][2]).toBeNull();
      expect(mockRegisterCustomTool.mock.calls[1][3]).toBe('admin-1');
    });

    it('skips read tool registration when it already exists', async () => {
      mockGetCustomTool
        .mockResolvedValueOnce({ id: 'existing-read' })
        .mockResolvedValueOnce(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
      expect(mockRegisterCustomTool.mock.calls[0][0]).toBe('linear-write');
    });

    it('skips write tool registration when it already exists', async () => {
      mockGetCustomTool
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing-write' });
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
      expect(mockRegisterCustomTool.mock.calls[0][0]).toBe('linear-read');
    });

    it('skips both when both already exist', async () => {
      mockGetCustomTool.mockResolvedValue({ id: 'existing' });

      await registerLinearTools('admin-1', LINEAR_CONFIG);

      expect(mockRegisterCustomTool).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // updateLinearConfig
  // ────────────────────────────────────────────────
  describe('updateLinearConfig', () => {
    it('updates config for both linear-read and linear-write', async () => {
      mockExecute.mockResolvedValue(undefined);

      const newConfig = { api_key: 'lin_api_new456' };
      await updateLinearConfig(newConfig);

      expect(mockExecute).toHaveBeenCalledWith(
        `UPDATE custom_tools SET config_json = $1 WHERE name IN ('linear-read', 'linear-write')`,
        [JSON.stringify(newConfig)],
      );
    });

    it('serializes config to JSON before saving', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateLinearConfig(LINEAR_CONFIG);

      const savedConfig = mockExecute.mock.calls[0][1][0];
      expect(savedConfig).toBe(JSON.stringify(LINEAR_CONFIG));
      expect(JSON.parse(savedConfig)).toEqual(LINEAR_CONFIG);
    });

    it('calls execute exactly once', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateLinearConfig(LINEAR_CONFIG);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });
});
