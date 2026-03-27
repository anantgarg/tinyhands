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

import { manifest as hubspotManifest } from '../../src/modules/tools/integrations/hubspot';

const TEST_WORKSPACE_ID = 'W_TEST_123';
const registerHubSpotTools = (userId: string, config: Record<string, string>) => hubspotManifest.register(TEST_WORKSPACE_ID, userId, config);
const updateHubSpotConfig = (config: Record<string, string>) => hubspotManifest.updateConfig(TEST_WORKSPACE_ID, config);

// ── Helpers ──

const HUBSPOT_CONFIG = {
  access_token: 'pat-na1-abc123def456',
};

// ── Tests ──

describe('HubSpot Tools Module', () => {
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

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readCall = mockRegisterCustomTool.mock.calls[0];
      expect(readCall[1]).toBe('hubspot-read');

      const readSchema = JSON.parse(readCall[2]);
      expect(readSchema.type).toBe('object');
      expect(readSchema.description).toContain('Read-only access to HubSpot CRM');
      expect(readSchema.properties.action.enum).toEqual([
        'search_contacts', 'filter_contacts', 'search_deals', 'get_contact', 'get_deal',
        'list_pipelines', 'get_company', 'search_companies', 'get_contact_activity',
      ]);
      expect(readSchema.required).toEqual(['action']);
    });

    it('registers write tool with correct name and schema', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const writeCall = mockRegisterCustomTool.mock.calls[1];
      expect(writeCall[1]).toBe('hubspot-write');

      const writeSchema = JSON.parse(writeCall[2]);
      expect(writeSchema.type).toBe('object');
      expect(writeSchema.description).toContain('Create and update HubSpot CRM records');
      expect(writeSchema.description).toContain('No destructive actions');
      expect(writeSchema.properties.action.enum).toEqual([
        'create_contact', 'update_contact', 'create_deal', 'update_deal',
        'create_task', 'add_note', 'create_company',
      ]);
      expect(writeSchema.required).toEqual(['action']);
    });

    it('read schema includes all expected parameter fields', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][2]);
      const propKeys = Object.keys(readSchema.properties);
      expect(propKeys).toContain('action');
      expect(propKeys).toContain('query');
      expect(propKeys).toContain('contact_id');
      expect(propKeys).toContain('deal_id');
      expect(propKeys).toContain('company_id');
      expect(propKeys).toContain('properties');
      expect(propKeys).toContain('limit');
      expect(propKeys).toContain('after');
    });

    it('write schema includes all expected parameter fields', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const writeSchema = JSON.parse(mockRegisterCustomTool.mock.calls[1][2]);
      const propKeys = Object.keys(writeSchema.properties);
      expect(propKeys).toContain('action');
      expect(propKeys).toContain('contact_id');
      expect(propKeys).toContain('deal_id');
      expect(propKeys).toContain('company_id');
      expect(propKeys).toContain('properties');
      expect(propKeys).toContain('pipeline_id');
      expect(propKeys).toContain('stage_id');
      expect(propKeys).toContain('note_body');
      expect(propKeys).toContain('task_subject');
      expect(propKeys).toContain('task_body');
      expect(propKeys).toContain('task_due_date');
    });

    it('read schema properties field is an array of strings', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][2]);
      expect(readSchema.properties.properties.type).toBe('array');
      expect(readSchema.properties.properties.items.type).toBe('string');
    });

    it('write schema properties field is an object', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const writeSchema = JSON.parse(mockRegisterCustomTool.mock.calls[1][2]);
      expect(writeSchema.properties.properties.type).toBe('object');
    });

    it('read schema contact_id, deal_id, company_id are strings', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][2]);
      expect(readSchema.properties.contact_id.type).toBe('string');
      expect(readSchema.properties.deal_id.type).toBe('string');
      expect(readSchema.properties.company_id.type).toBe('string');
    });

    it('read schema limit is a number', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][2]);
      expect(readSchema.properties.limit.type).toBe('number');
    });

    it('read schema after is a string (pagination cursor)', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][2]);
      expect(readSchema.properties.after.type).toBe('string');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code - Auth Header Construction
  // ────────────────────────────────────────────────
  describe('Tool Code - Auth and URL Construction', () => {
    it('both tools use Bearer token authorization', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readCode = mockRegisterCustomTool.mock.calls[0][5].code;
      const writeCode = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(readCode).toContain("'Authorization': 'Bearer ' + token");
      expect(writeCode).toContain("'Authorization': 'Bearer ' + token");
    });

    it('both tools target api.hubapi.com', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readCode = mockRegisterCustomTool.mock.calls[0][5].code;
      const writeCode = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(readCode).toContain("hostname: 'api.hubapi.com'");
      expect(writeCode).toContain("hostname: 'api.hubapi.com'");
    });

    it('read tool reads config from hubspot-read.config.json', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("'hubspot-read.config.json'");
    });

    it('write tool reads config from hubspot-write.config.json', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("'hubspot-write.config.json'");
    });

    it('both tools exit gracefully when access token is missing', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readCode = mockRegisterCustomTool.mock.calls[0][5].code;
      const writeCode = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(readCode).toContain('if (!token)');
      expect(readCode).toContain('HubSpot access token not configured');
      expect(readCode).toContain('process.exit(0)');
      expect(writeCode).toContain('if (!token)');
      expect(writeCode).toContain('HubSpot access token not configured');
    });

    it('both tools set a 30-second request timeout', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readCode = mockRegisterCustomTool.mock.calls[0][5].code;
      const writeCode = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(readCode).toContain('req.setTimeout(30000');
      expect(writeCode).toContain('req.setTimeout(30000');
    });

    it('both tools set Content-Length header when payload exists', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readCode = mockRegisterCustomTool.mock.calls[0][5].code;
      const writeCode = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(readCode).toContain("if (payload) options.headers['Content-Length']");
      expect(writeCode).toContain("if (payload) options.headers['Content-Length']");
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code - Read Actions
  // ────────────────────────────────────────────────
  describe('Tool Code - Read Actions', () => {
    it('read tool handles search_contacts action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("case 'search_contacts':");
      expect(code).toContain("if (!input.query) { result = { error: 'query is required for search_contacts' }");
      expect(code).toContain('/crm/v3/objects/contacts/search');
    });

    it('read tool handles search_deals action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("case 'search_deals':");
      expect(code).toContain("if (!input.query) { result = { error: 'query is required for search_deals' }");
      expect(code).toContain('/crm/v3/objects/deals/search');
    });

    it('read tool handles get_contact action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("case 'get_contact':");
      expect(code).toContain("if (!input.contact_id) { result = { error: 'contact_id is required' }");
      expect(code).toContain('/crm/v3/objects/contacts/');
    });

    it('read tool handles get_deal action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("case 'get_deal':");
      expect(code).toContain("if (!input.deal_id) { result = { error: 'deal_id is required' }");
      expect(code).toContain('/crm/v3/objects/deals/');
    });

    it('read tool handles list_pipelines action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("case 'list_pipelines':");
      expect(code).toContain('/crm/v3/pipelines/deals');
    });

    it('read tool handles get_company action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("case 'get_company':");
      expect(code).toContain("if (!input.company_id) { result = { error: 'company_id is required' }");
      expect(code).toContain('/crm/v3/objects/companies/');
    });

    it('read tool handles search_companies action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("case 'search_companies':");
      expect(code).toContain("if (!input.query) { result = { error: 'query is required for search_companies' }");
      expect(code).toContain('/crm/v3/objects/companies/search');
    });

    it('read tool handles get_contact_activity action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("case 'get_contact_activity':");
      expect(code).toContain("if (!input.contact_id) { result = { error: 'contact_id is required for get_contact_activity' }");
      expect(code).toContain('/associations/engagements');
      expect(code).toContain('/associations/notes');
      expect(code).toContain('/associations/tasks');
      expect(code).toContain('contact_analytics');
      expect(code).toContain('total_engagements');
    });

    it('read tool handles unknown action with error', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("'Unknown action: ' + a");
    });

    it('read tool caps limit at 100', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain('Math.min(input.limit || 10, 100)');
    });

    it('read tool uses default properties when none provided for search_contacts', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("['email', 'firstname', 'lastname', 'phone', 'company']");
    });

    it('read tool uses default properties when none provided for search_deals', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain("['dealname', 'amount', 'dealstage', 'pipeline', 'closedate']");
    });

    it('read tool uses default properties when none provided for get_contact', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain('properties=email,firstname,lastname,phone,company,lifecyclestage');
    });

    it('read tool supports pagination with after parameter', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain('if (input.after) body.after = input.after');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code - Write Actions
  // ────────────────────────────────────────────────
  describe('Tool Code - Write Actions', () => {
    it('write tool handles create_contact action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("case 'create_contact':");
      expect(code).toContain("if (!input.properties) { result = { error: 'properties are required for create_contact' }");
      expect(code).toContain("'/crm/v3/objects/contacts', 'POST'");
    });

    it('write tool handles update_contact action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("case 'update_contact':");
      expect(code).toContain("if (!input.contact_id || !input.properties) { result = { error: 'contact_id and properties are required' }");
      expect(code).toContain("'PATCH'");
    });

    it('write tool handles create_deal action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("case 'create_deal':");
      expect(code).toContain("if (!input.properties) { result = { error: 'properties are required for create_deal' }");
      expect(code).toContain("'/crm/v3/objects/deals', 'POST'");
    });

    it('write tool handles update_deal action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("case 'update_deal':");
      expect(code).toContain("if (!input.deal_id || !input.properties) { result = { error: 'deal_id and properties are required' }");
      expect(code).toContain("'PATCH'");
    });

    it('write tool handles create_task action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("case 'create_task':");
      expect(code).toContain("if (!input.task_subject) { result = { error: 'task_subject is required for create_task' }");
      expect(code).toContain('/crm/v3/objects/tasks');
      expect(code).toContain('hs_task_subject');
      expect(code).toContain("hs_task_status: 'NOT_STARTED'");
    });

    it('write tool handles add_note action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("case 'add_note':");
      expect(code).toContain("if (!input.note_body) { result = { error: 'note_body is required for add_note' }");
      expect(code).toContain('/crm/v3/objects/notes');
      expect(code).toContain('hs_note_body');
      expect(code).toContain('hs_timestamp');
    });

    it('write tool handles create_company action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("case 'create_company':");
      expect(code).toContain("if (!input.properties) { result = { error: 'properties are required for create_company' }");
      expect(code).toContain("'/crm/v3/objects/companies', 'POST'");
    });

    it('write tool handles unknown action with error', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("'Unknown action: ' + a");
    });

    it('write tool creates associations for deals with contacts and companies', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("if (input.contact_id) await associate('deals', dealId, 'contacts', input.contact_id)");
      expect(code).toContain("if (input.company_id) await associate('deals', dealId, 'companies', input.company_id)");
    });

    it('write tool creates associations for tasks with contacts, deals, and companies', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("if (input.contact_id) await associate('tasks', taskId, 'contacts', input.contact_id)");
      expect(code).toContain("if (input.deal_id) await associate('tasks', taskId, 'deals', input.deal_id)");
      expect(code).toContain("if (input.company_id) await associate('tasks', taskId, 'companies', input.company_id)");
    });

    it('write tool creates associations for notes with contacts, deals, and companies', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain("if (input.contact_id) await associate('notes', noteId, 'contacts', input.contact_id)");
      expect(code).toContain("if (input.deal_id) await associate('notes', noteId, 'deals', input.deal_id)");
      expect(code).toContain("if (input.company_id) await associate('notes', noteId, 'companies', input.company_id)");
    });

    it('write tool associate function uses CRM v4 associations API', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain('/crm/v4/objects/');
      expect(code).toContain('/associations/');
      expect(code).toContain("associationCategory: 'HUBSPOT_DEFINED'");
      expect(code).toContain('associationTypeId: 0');
    });

    it('write tool merges pipeline_id and stage_id into deal properties', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain('if (input.pipeline_id) dealProps.pipeline = input.pipeline_id');
      expect(code).toContain('if (input.stage_id) dealProps.dealstage = input.stage_id');
    });

    it('write tool only creates associations when status is < 300', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(code).toContain('if (result.status < 300 && result.data && result.data.id)');
    });
  });

  // ────────────────────────────────────────────────
  // registerHubSpotTools
  // ────────────────────────────────────────────────
  describe('registerHubSpotTools', () => {
    it('registers both read and write tools when neither exists', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(2);
      expect(mockGetCustomTool).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'hubspot-read');
      expect(mockGetCustomTool).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'hubspot-write');
    });

    it('passes configJson to both tools', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const expectedConfigJson = JSON.stringify(HUBSPOT_CONFIG);
      expect(mockRegisterCustomTool.mock.calls[0][5].configJson).toBe(expectedConfigJson);
      expect(mockRegisterCustomTool.mock.calls[1][5].configJson).toBe(expectedConfigJson);
    });

    it('registers read tool with read-only access level', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const readOptions = mockRegisterCustomTool.mock.calls[0][5];
      expect(readOptions.language).toBe('javascript');
      expect(readOptions.autoApprove).toBe(true);
      expect(readOptions.accessLevel).toBe('read-only');
    });

    it('registers write tool with read-write access level', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      const writeOptions = mockRegisterCustomTool.mock.calls[1][5];
      expect(writeOptions.language).toBe('javascript');
      expect(writeOptions.autoApprove).toBe(true);
      expect(writeOptions.accessLevel).toBe('read-write');
    });

    it('passes null as scriptPath and adminUserId correctly', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      expect(mockRegisterCustomTool.mock.calls[0][3]).toBeNull();
      expect(mockRegisterCustomTool.mock.calls[0][4]).toBe('admin-1');
      expect(mockRegisterCustomTool.mock.calls[1][3]).toBeNull();
      expect(mockRegisterCustomTool.mock.calls[1][4]).toBe('admin-1');
    });

    it('skips read tool registration when it already exists', async () => {
      mockGetCustomTool
        .mockResolvedValueOnce({ id: 'existing-read' })
        .mockResolvedValueOnce(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
      expect(mockRegisterCustomTool.mock.calls[0][1]).toBe('hubspot-write');
    });

    it('skips write tool registration when it already exists', async () => {
      mockGetCustomTool
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing-write' });
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
      expect(mockRegisterCustomTool.mock.calls[0][1]).toBe('hubspot-read');
    });

    it('skips both when both already exist', async () => {
      mockGetCustomTool.mockResolvedValue({ id: 'existing' });

      await registerHubSpotTools('admin-1', HUBSPOT_CONFIG);

      expect(mockRegisterCustomTool).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // updateHubSpotConfig
  // ────────────────────────────────────────────────
  describe('updateHubSpotConfig', () => {
    it('updates config for both hubspot-read and hubspot-write', async () => {
      mockExecute.mockResolvedValue(undefined);

      const newConfig = { access_token: 'pat-na1-new789' };
      await updateHubSpotConfig(newConfig);

      expect(mockExecute).toHaveBeenCalledWith(
        `UPDATE custom_tools SET config_json = $1 WHERE workspace_id = $2 AND name = ANY($3)`,
        [JSON.stringify(newConfig), TEST_WORKSPACE_ID, ['hubspot-read', 'hubspot-write']],
      );
    });

    it('serializes config to JSON before saving', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateHubSpotConfig(HUBSPOT_CONFIG);

      const savedConfig = mockExecute.mock.calls[0][1][0];
      expect(savedConfig).toBe(JSON.stringify(HUBSPOT_CONFIG));
      expect(JSON.parse(savedConfig)).toEqual(HUBSPOT_CONFIG);
    });

    it('calls execute exactly once', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateHubSpotConfig(HUBSPOT_CONFIG);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });
});
