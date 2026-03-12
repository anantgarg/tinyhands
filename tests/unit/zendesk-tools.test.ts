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

import { registerZendeskTools, updateZendeskConfig } from '../../src/modules/tools/zendesk';

// ── Helpers ──

const ZENDESK_CONFIG = {
  subdomain: 'testcompany',
  email: 'admin@testcompany.com',
  api_token: 'zd-api-token-abc123',
};

// ── Tests ──

describe('Zendesk Tools Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────
  // Tool Schema Definitions
  // ────────────────────────────────────────────────
  describe('Tool Schema Definitions', () => {
    it('registers read tool with correct name and schema properties', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      // First call is the read tool
      const readCall = mockRegisterCustomTool.mock.calls[0];
      expect(readCall[0]).toBe('zendesk-read');

      const readSchema = JSON.parse(readCall[1]);
      expect(readSchema.type).toBe('object');
      expect(readSchema.description).toContain('Read-only access to Zendesk');
      expect(readSchema.properties.action.enum).toEqual([
        'search', 'get_ticket', 'get_ticket_comments', 'get_user',
        'get_organization', 'list_views', 'get_view_tickets',
        'get_ticket_metrics', 'get_satisfaction_ratings',
      ]);
      expect(readSchema.required).toEqual(['action']);
    });

    it('registers write tool with correct name and schema properties', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      // Second call is the write tool
      const writeCall = mockRegisterCustomTool.mock.calls[1];
      expect(writeCall[0]).toBe('zendesk-write');

      const writeSchema = JSON.parse(writeCall[1]);
      expect(writeSchema.type).toBe('object');
      expect(writeSchema.description).toContain('Create and respond to Zendesk tickets');
      expect(writeSchema.description).toContain('No destructive actions');
      expect(writeSchema.properties.action.enum).toEqual([
        'create_ticket', 'add_comment', 'update_ticket_tags',
        'update_ticket_priority', 'update_ticket_assignee',
      ]);
      expect(writeSchema.required).toEqual(['action']);
    });

    it('read schema includes all expected parameter fields', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      const propKeys = Object.keys(readSchema.properties);
      expect(propKeys).toContain('action');
      expect(propKeys).toContain('query');
      expect(propKeys).toContain('ticket_id');
      expect(propKeys).toContain('user_id');
      expect(propKeys).toContain('organization_id');
      expect(propKeys).toContain('view_id');
      expect(propKeys).toContain('page');
      expect(propKeys).toContain('per_page');
      expect(propKeys).toContain('sort_by');
      expect(propKeys).toContain('sort_order');
    });

    it('write schema includes all expected parameter fields', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const writeSchema = JSON.parse(mockRegisterCustomTool.mock.calls[1][1]);
      const propKeys = Object.keys(writeSchema.properties);
      expect(propKeys).toContain('action');
      expect(propKeys).toContain('subject');
      expect(propKeys).toContain('body');
      expect(propKeys).toContain('ticket_id');
      expect(propKeys).toContain('requester_email');
      expect(propKeys).toContain('tags');
      expect(propKeys).toContain('priority');
      expect(propKeys).toContain('assignee_id');
      expect(propKeys).toContain('public_reply');
    });

    it('read schema sort_order enum is asc/desc', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      expect(readSchema.properties.sort_order.enum).toEqual(['asc', 'desc']);
    });

    it('write schema priority enum includes all Zendesk levels', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const writeSchema = JSON.parse(mockRegisterCustomTool.mock.calls[1][1]);
      expect(writeSchema.properties.priority.enum).toEqual(['low', 'normal', 'high', 'urgent']);
    });

    it('read schema ticket_id and user_id are numbers', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      expect(readSchema.properties.ticket_id.type).toBe('number');
      expect(readSchema.properties.user_id.type).toBe('number');
      expect(readSchema.properties.organization_id.type).toBe('number');
      expect(readSchema.properties.view_id.type).toBe('number');
    });

    it('write schema tags is an array of strings', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const writeSchema = JSON.parse(mockRegisterCustomTool.mock.calls[1][1]);
      expect(writeSchema.properties.tags.type).toBe('array');
      expect(writeSchema.properties.tags.items.type).toBe('string');
    });

    it('write schema public_reply is a boolean', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const writeSchema = JSON.parse(mockRegisterCustomTool.mock.calls[1][1]);
      expect(writeSchema.properties.public_reply.type).toBe('boolean');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code - Auth Header Construction
  // ────────────────────────────────────────────────
  describe('Tool Code - Auth and URL Construction', () => {
    it('read tool code uses Basic auth with email/token format', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const readOptions = mockRegisterCustomTool.mock.calls[0][4];
      const code = readOptions.code;
      // Auth is constructed as: Buffer.from(email + '/token:' + apiToken).toString('base64')
      expect(code).toContain("Buffer.from(email + '/token:' + apiToken).toString('base64')");
      expect(code).toContain("'Authorization': 'Basic ' + auth");
    });

    it('write tool code uses Basic auth with email/token format', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const writeOptions = mockRegisterCustomTool.mock.calls[1][4];
      const code = writeOptions.code;
      expect(code).toContain("Buffer.from(email + '/token:' + apiToken).toString('base64')");
      expect(code).toContain("'Authorization': 'Basic ' + auth");
    });

    it('read tool code constructs URL with subdomain', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const readOptions = mockRegisterCustomTool.mock.calls[0][4];
      const code = readOptions.code;
      expect(code).toContain("'https://' + subdomain + '.zendesk.com' + path");
    });

    it('write tool code constructs URL with subdomain', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const writeOptions = mockRegisterCustomTool.mock.calls[1][4];
      const code = writeOptions.code;
      expect(code).toContain("'https://' + subdomain + '.zendesk.com' + path");
    });

    it('read tool reads config from zendesk-read.config.json', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const readOptions = mockRegisterCustomTool.mock.calls[0][4];
      expect(readOptions.code).toContain("'zendesk-read.config.json'");
    });

    it('write tool reads config from zendesk-write.config.json', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const writeOptions = mockRegisterCustomTool.mock.calls[1][4];
      expect(writeOptions.code).toContain("'zendesk-write.config.json'");
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code - Read Actions
  // ────────────────────────────────────────────────
  describe('Tool Code - Read Actions', () => {
    it('read tool code handles search action with query parameter', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'search':");
      expect(code).toContain('/api/v2/search.json?query=');
      expect(code).toContain("if (!query) { result = { error: 'query is required for search' }");
    });

    it('read tool code handles get_ticket action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_ticket':");
      expect(code).toContain('/api/v2/tickets/');
      expect(code).toContain("if (!ticket_id) { result = { error: 'ticket_id is required' }");
    });

    it('read tool code handles get_ticket_comments action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_ticket_comments':");
      expect(code).toContain('/comments.json');
    });

    it('read tool code handles get_user action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_user':");
      expect(code).toContain('/api/v2/users/');
    });

    it('read tool code handles get_organization action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_organization':");
      expect(code).toContain('/api/v2/organizations/');
    });

    it('read tool code handles list_views action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'list_views':");
      expect(code).toContain('/api/v2/views.json');
    });

    it('read tool code handles get_view_tickets action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_view_tickets':");
      expect(code).toContain('/tickets.json');
    });

    it('read tool code handles get_ticket_metrics action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_ticket_metrics':");
      expect(code).toContain('/metrics.json');
    });

    it('read tool code handles get_satisfaction_ratings action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_satisfaction_ratings':");
      expect(code).toContain('/api/v2/satisfaction_ratings.json');
    });

    it('read tool code handles unknown action with error message', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("'Unknown action: ' + action");
    });

    it('read tool code handles pagination parameters', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain('const pageParam = page || 1');
      expect(code).toContain('Math.min(per_page || 100, 100)');
    });

    it('read tool code handles sorting parameters', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("if (sort_by) path += '&sort_by='");
      expect(code).toContain("if (sort_order) path += '&sort_order='");
    });

    it('read tool code exits gracefully when credentials missing', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain('if (!subdomain || !email || !apiToken)');
      expect(code).toContain('Zendesk credentials not configured');
      expect(code).toContain('process.exit(0)');
    });

    it('read tool code sets a 30-second request timeout', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain('req.setTimeout(30000');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code - Write Actions
  // ────────────────────────────────────────────────
  describe('Tool Code - Write Actions', () => {
    it('write tool code handles create_ticket action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("case 'create_ticket':");
      expect(code).toContain("if (!subject || !body) { result = { error: 'subject and body are required for create_ticket' }");
      expect(code).toContain("'/api/v2/tickets.json', 'POST'");
    });

    it('write tool code handles add_comment action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("case 'add_comment':");
      expect(code).toContain("if (!ticket_id || !body) { result = { error: 'ticket_id and body are required for add_comment' }");
      expect(code).toContain("'PUT'");
    });

    it('write tool code handles update_ticket_tags action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("case 'update_ticket_tags':");
      expect(code).toContain("if (!ticket_id || !tags) { result = { error: 'ticket_id and tags are required' }");
    });

    it('write tool code handles update_ticket_priority action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("case 'update_ticket_priority':");
      expect(code).toContain("if (!ticket_id || !priority) { result = { error: 'ticket_id and priority are required' }");
    });

    it('write tool code handles update_ticket_assignee action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("case 'update_ticket_assignee':");
      expect(code).toContain("if (!ticket_id || !assignee_id) { result = { error: 'ticket_id and assignee_id are required' }");
    });

    it('write tool code defaults public_reply to true', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain('const isPublic = public_reply !== false');
    });

    it('write tool code supports requester_email for create_ticket', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain('if (requester_email) ticket.ticket.requester = { email: requester_email }');
    });

    it('write tool code sets default priority to normal for create_ticket', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("priority: priority || 'normal'");
    });

    it('write tool code handles unknown action with error', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][4].code;
      expect(code).toContain("'Unknown action: ' + action");
    });
  });

  // ────────────────────────────────────────────────
  // registerZendeskTools
  // ────────────────────────────────────────────────
  describe('registerZendeskTools', () => {
    it('registers both read and write tools when neither exists', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(2);
      expect(mockGetCustomTool).toHaveBeenCalledWith('zendesk-read');
      expect(mockGetCustomTool).toHaveBeenCalledWith('zendesk-write');
    });

    it('passes configJson to both tools', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const expectedConfigJson = JSON.stringify(ZENDESK_CONFIG);
      expect(mockRegisterCustomTool.mock.calls[0][4].configJson).toBe(expectedConfigJson);
      expect(mockRegisterCustomTool.mock.calls[1][4].configJson).toBe(expectedConfigJson);
    });

    it('registers read tool with correct options', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const readOptions = mockRegisterCustomTool.mock.calls[0][4];
      expect(readOptions.language).toBe('javascript');
      expect(readOptions.autoApprove).toBe(true);
      expect(readOptions.accessLevel).toBe('read-only');
    });

    it('registers write tool with correct options', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      const writeOptions = mockRegisterCustomTool.mock.calls[1][4];
      expect(writeOptions.language).toBe('javascript');
      expect(writeOptions.autoApprove).toBe(true);
      expect(writeOptions.accessLevel).toBe('read-write');
    });

    it('passes null as scriptPath for both tools', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      expect(mockRegisterCustomTool.mock.calls[0][2]).toBeNull();
      expect(mockRegisterCustomTool.mock.calls[1][2]).toBeNull();
    });

    it('passes adminUserId for both tools', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      expect(mockRegisterCustomTool.mock.calls[0][3]).toBe('admin-user-1');
      expect(mockRegisterCustomTool.mock.calls[1][3]).toBe('admin-user-1');
    });

    it('skips read tool registration when it already exists', async () => {
      mockGetCustomTool
        .mockResolvedValueOnce({ id: 'existing-read' }) // zendesk-read exists
        .mockResolvedValueOnce(null); // zendesk-write does not exist
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
      expect(mockRegisterCustomTool.mock.calls[0][0]).toBe('zendesk-write');
    });

    it('skips write tool registration when it already exists', async () => {
      mockGetCustomTool
        .mockResolvedValueOnce(null) // zendesk-read does not exist
        .mockResolvedValueOnce({ id: 'existing-write' }); // zendesk-write exists
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
      expect(mockRegisterCustomTool.mock.calls[0][0]).toBe('zendesk-read');
    });

    it('skips both when both already exist', async () => {
      mockGetCustomTool.mockResolvedValue({ id: 'existing' });

      await registerZendeskTools('admin-user-1', ZENDESK_CONFIG);

      expect(mockRegisterCustomTool).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // updateZendeskConfig
  // ────────────────────────────────────────────────
  describe('updateZendeskConfig', () => {
    it('updates config for both zendesk-read and zendesk-write', async () => {
      mockExecute.mockResolvedValue(undefined);

      const newConfig = { subdomain: 'newco', email: 'new@example.com', api_token: 'new-token' };
      await updateZendeskConfig(newConfig);

      expect(mockExecute).toHaveBeenCalledWith(
        `UPDATE custom_tools SET config_json = $1 WHERE name IN ('zendesk-read', 'zendesk-write')`,
        [JSON.stringify(newConfig)],
      );
    });

    it('serializes config to JSON before saving', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateZendeskConfig(ZENDESK_CONFIG);

      const savedConfig = mockExecute.mock.calls[0][1][0];
      expect(savedConfig).toBe(JSON.stringify(ZENDESK_CONFIG));
      // Verify it round-trips
      expect(JSON.parse(savedConfig)).toEqual(ZENDESK_CONFIG);
    });

    it('calls execute exactly once', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateZendeskConfig(ZENDESK_CONFIG);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });
});
