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

import { manifest as posthogManifest } from '../../src/modules/tools/integrations/posthog';
const registerPostHogTools = (userId: string, config: Record<string, string>) => posthogManifest.register(userId, config);
const updatePostHogConfig = (config: Record<string, string>) => posthogManifest.updateConfig(config);

// ── Helpers ──

const POSTHOG_CONFIG = {
  api_key: 'phx_test123abc',
  project_id: '12345',
};

const POSTHOG_CONFIG_WITH_HOST = {
  api_key: 'phx_test123abc',
  project_id: '12345',
  host: 'https://posthog.mycompany.com',
};

// ── Tests ──

describe('PostHog Tools Module', () => {
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

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const readCall = mockRegisterCustomTool.mock.calls[0];
      expect(readCall[0]).toBe('posthog-read');

      const readSchema = JSON.parse(readCall[1]);
      expect(readSchema.type).toBe('object');
      expect(readSchema.description).toContain('Read-only access to PostHog analytics');
      expect(readSchema.properties.action.enum).toEqual([
        'query_events', 'get_person', 'list_feature_flags',
        'get_insight', 'list_insights', 'get_cohorts',
      ]);
      expect(readSchema.required).toEqual(['action']);
    });

    it('schema includes all expected parameter fields', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      const propKeys = Object.keys(readSchema.properties);
      expect(propKeys).toContain('action');
      expect(propKeys).toContain('event_name');
      expect(propKeys).toContain('person_id');
      expect(propKeys).toContain('insight_id');
      expect(propKeys).toContain('date_from');
      expect(propKeys).toContain('date_to');
      expect(propKeys).toContain('properties');
      expect(propKeys).toContain('limit');
      expect(propKeys).toContain('offset');
    });

    it('schema event_name and person_id are strings', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      expect(readSchema.properties.event_name.type).toBe('string');
      expect(readSchema.properties.person_id.type).toBe('string');
    });

    it('schema insight_id is a number', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      expect(readSchema.properties.insight_id.type).toBe('number');
    });

    it('schema limit and offset are numbers', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      expect(readSchema.properties.limit.type).toBe('number');
      expect(readSchema.properties.offset.type).toBe('number');
    });

    it('schema date_from and date_to are strings', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      expect(readSchema.properties.date_from.type).toBe('string');
      expect(readSchema.properties.date_to.type).toBe('string');
      expect(readSchema.properties.date_from.description).toContain('-7d');
    });

    it('schema properties field is an object (for filter key-value pairs)', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const readSchema = JSON.parse(mockRegisterCustomTool.mock.calls[0][1]);
      expect(readSchema.properties.properties.type).toBe('object');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code - Auth Header Construction
  // ────────────────────────────────────────────────
  describe('Tool Code - Auth and URL Construction', () => {
    it('uses Bearer token authorization', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("'Authorization': 'Bearer ' + apiKey");
    });

    it('defaults host to app.posthog.com when not configured', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("config.host || 'https://app.posthog.com'");
    });

    it('strips trailing slash from host', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("hostRaw.replace(/\\/$/, '')");
    });

    it('reads config from posthog-read.config.json', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("'posthog-read.config.json'");
    });

    it('exits gracefully when api_key or project_id is missing', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain('if (!apiKey || !projectId)');
      expect(code).toContain('PostHog credentials not configured');
      expect(code).toContain('process.exit(0)');
    });

    it('sets a 30-second request timeout', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain('req.setTimeout(30000');
    });

    it('constructs API paths with project_id prefix', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("var prefix = '/api/projects/' + projectId");
    });

    it('falls back to app.posthog.com if host URL parsing fails', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("url = new URL('https://app.posthog.com' + reqPath)");
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code - Read Actions
  // ────────────────────────────────────────────────
  describe('Tool Code - Read Actions', () => {
    it('handles query_events action with event filtering', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'query_events':");
      expect(code).toContain("/events/?limit=");
      expect(code).toContain("if (input.event_name) p += '&event=' + encodeURIComponent(input.event_name)");
    });

    it('handles query_events with date range filters', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("if (input.date_from) p += '&after=' + encodeURIComponent(input.date_from)");
      expect(code).toContain("if (input.date_to) p += '&before=' + encodeURIComponent(input.date_to)");
    });

    it('handles query_events with property filters', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("if (input.properties) p += '&properties=' + encodeURIComponent(JSON.stringify(input.properties))");
    });

    it('handles get_person action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_person':");
      expect(code).toContain("if (!input.person_id) { result = { error: 'person_id (distinct_id) is required' }");
      expect(code).toContain("/persons/?distinct_id=");
    });

    it('handles list_feature_flags action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'list_feature_flags':");
      expect(code).toContain("/feature_flags/?limit=");
    });

    it('handles get_insight action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_insight':");
      expect(code).toContain("if (!input.insight_id) { result = { error: 'insight_id is required' }");
      expect(code).toContain("/insights/");
    });

    it('handles list_insights action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'list_insights':");
      expect(code).toContain("/insights/?limit=");
    });

    it('handles get_cohorts action', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("case 'get_cohorts':");
      expect(code).toContain("/cohorts/?limit=");
    });

    it('handles unknown action with error', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("'Unknown action: ' + a");
    });

    it('caps limit at 1000 with default of 100', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain('Math.min(input.limit || 100, 1000)');
    });

    it('supports offset parameter with default 0', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain('var offset = input.offset || 0');
    });

    it('includes offset in pagination for query_events', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      expect(code).toContain("'&offset=' + offset");
    });

    it('includes offset in pagination for list_feature_flags', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][4].code;
      // list_feature_flags uses offset
      expect(code).toContain("'/feature_flags/?limit=' + lim + '&offset=' + offset");
    });
  });

  // ────────────────────────────────────────────────
  // registerPostHogTools (only read tool)
  // ────────────────────────────────────────────────
  describe('registerPostHogTools', () => {
    it('registers only one tool (read-only, no write tool)', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
      expect(mockGetCustomTool).toHaveBeenCalledWith('posthog-read');
      expect(mockRegisterCustomTool.mock.calls[0][0]).toBe('posthog-read');
    });

    it('passes configJson with api_key and project_id', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const expectedConfigJson = JSON.stringify(POSTHOG_CONFIG);
      expect(mockRegisterCustomTool.mock.calls[0][4].configJson).toBe(expectedConfigJson);
    });

    it('passes configJson with optional host', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG_WITH_HOST);

      const expectedConfigJson = JSON.stringify(POSTHOG_CONFIG_WITH_HOST);
      expect(mockRegisterCustomTool.mock.calls[0][4].configJson).toBe(expectedConfigJson);
    });

    it('registers with read-only access level', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      const options = mockRegisterCustomTool.mock.calls[0][4];
      expect(options.language).toBe('javascript');
      expect(options.autoApprove).toBe(true);
      expect(options.accessLevel).toBe('read-only');
    });

    it('passes null as scriptPath and adminUserId correctly', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      expect(mockRegisterCustomTool.mock.calls[0][2]).toBeNull();
      expect(mockRegisterCustomTool.mock.calls[0][3]).toBe('admin-1');
    });

    it('skips registration when tool already exists', async () => {
      mockGetCustomTool.mockResolvedValue({ id: 'existing-posthog' });

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      expect(mockRegisterCustomTool).not.toHaveBeenCalled();
    });

    it('registers tool when getCustomTool returns null', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerPostHogTools('admin-1', POSTHOG_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────────
  // updatePostHogConfig
  // ────────────────────────────────────────────────
  describe('updatePostHogConfig', () => {
    it('updates config for posthog-read only (no write tool)', async () => {
      mockExecute.mockResolvedValue(undefined);

      const newConfig = { api_key: 'phx_new456', project_id: '67890' };
      await updatePostHogConfig(newConfig);

      expect(mockExecute).toHaveBeenCalledWith(
        `UPDATE custom_tools SET config_json = $1 WHERE name = ANY($2)`,
        [JSON.stringify(newConfig), ['posthog-read']],
      );
    });

    it('updates config with optional host parameter', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updatePostHogConfig(POSTHOG_CONFIG_WITH_HOST);

      const savedConfig = mockExecute.mock.calls[0][1][0];
      const parsed = JSON.parse(savedConfig);
      expect(parsed.host).toBe('https://posthog.mycompany.com');
      expect(parsed.api_key).toBe('phx_test123abc');
      expect(parsed.project_id).toBe('12345');
    });

    it('serializes config to JSON before saving', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updatePostHogConfig(POSTHOG_CONFIG);

      const savedConfig = mockExecute.mock.calls[0][1][0];
      expect(savedConfig).toBe(JSON.stringify(POSTHOG_CONFIG));
      expect(JSON.parse(savedConfig)).toEqual(POSTHOG_CONFIG);
    });

    it('calls execute exactly once', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updatePostHogConfig(POSTHOG_CONFIG);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('uses ANY with array of tool names in WHERE clause', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updatePostHogConfig(POSTHOG_CONFIG);

      const sql = mockExecute.mock.calls[0][0];
      expect(sql).toContain('WHERE name = ANY($2)');
      expect(mockExecute.mock.calls[0][1][1]).toEqual(['posthog-read']);
    });
  });
});
