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

import { manifest as serpapiManifest } from '../../src/modules/tools/integrations/serpapi';

const TEST_WORKSPACE_ID = 'W_TEST_123';
const registerSerpAPITools = (userId: string, config: Record<string, string>) => serpapiManifest.register(TEST_WORKSPACE_ID, userId, config);
const updateSerpAPIConfig = (config: Record<string, string>) => serpapiManifest.updateConfig(TEST_WORKSPACE_ID, config);

// ── Helpers ──

const SERPAPI_CONFIG = {
  api_key: 'test-serpapi-key-123',
};

// ── Tests ──

describe('SerpAPI Tools Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────
  // Manifest static properties
  // ────────────────────────────────────────────────
  describe('Manifest properties', () => {
    it('has correct id, label, icon, and description', () => {
      expect(serpapiManifest.id).toBe('serpapi');
      expect(serpapiManifest.label).toBe('SerpAPI');
      expect(serpapiManifest.icon).toBe(':mag:');
      expect(serpapiManifest.description).toContain('SERP');
    });

    it('requires api_key config key', () => {
      expect(serpapiManifest.configKeys).toEqual(['api_key']);
    });

    it('has configPlaceholders', () => {
      expect(serpapiManifest.configPlaceholders).toBeDefined();
      expect(serpapiManifest.configPlaceholders!.api_key).toContain('serpapi.com');
    });

    it('has one tool: serpapi-read', () => {
      expect(serpapiManifest.tools).toHaveLength(1);
      expect(serpapiManifest.tools[0].name).toBe('serpapi-read');
      expect(serpapiManifest.tools[0].accessLevel).toBe('read-only');
      expect(serpapiManifest.tools[0].displayName).toBe('Searching SerpAPI');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Schema
  // ────────────────────────────────────────────────
  describe('Tool Schema', () => {
    it('has correct actions in the schema', () => {
      const schema = JSON.parse(serpapiManifest.tools[0].schema);
      expect(schema.type).toBe('object');
      expect(schema.properties.action.enum).toEqual(['search', 'batch_search']);
      expect(schema.required).toEqual(['action']);
    });

    it('has keyword, keywords, engine, location, device, and num properties', () => {
      const schema = JSON.parse(serpapiManifest.tools[0].schema);
      expect(schema.properties.keyword.type).toBe('string');
      expect(schema.properties.keywords.type).toBe('array');
      expect(schema.properties.engine.enum).toEqual(['google', 'bing', 'yahoo']);
      expect(schema.properties.location.type).toBe('string');
      expect(schema.properties.device.enum).toEqual(['desktop', 'mobile', 'tablet']);
      expect(schema.properties.num.type).toBe('number');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code Verification
  // ────────────────────────────────────────────────
  describe('Tool Code', () => {
    it('loads config from serpapi-read.config.json', () => {
      const code = serpapiManifest.tools[0].code;
      expect(code).toContain("'serpapi-read.config.json'");
    });

    it('targets serpapi.com', () => {
      const code = serpapiManifest.tools[0].code;
      expect(code).toContain("hostname: 'serpapi.com'");
    });

    it('sets 30-second timeout', () => {
      const code = serpapiManifest.tools[0].code;
      expect(code).toContain('req.setTimeout(30000');
    });

    it('handles search action', () => {
      const code = serpapiManifest.tools[0].code;
      expect(code).toContain("case 'search':");
      expect(code).toContain("if (!input.keyword)");
    });

    it('handles batch_search action', () => {
      const code = serpapiManifest.tools[0].code;
      expect(code).toContain("case 'batch_search':");
      expect(code).toContain("if (!input.keywords || !input.keywords.length)");
    });

    it('caps num at 100', () => {
      const code = serpapiManifest.tools[0].code;
      expect(code).toContain('Math.min(input.num || 10, 100)');
    });

    it('extracts organic results', () => {
      const code = serpapiManifest.tools[0].code;
      expect(code).toContain('extractResults');
      expect(code).toContain('organic_results');
    });
  });

  // ────────────────────────────────────────────────
  // registerSerpAPITools
  // ────────────────────────────────────────────────
  describe('registerSerpAPITools', () => {
    it('registers serpapi-read tool when it does not exist', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerSerpAPITools('admin-1', SERPAPI_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
      expect(mockGetCustomTool).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'serpapi-read');
    });

    it('passes configJson to the tool', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerSerpAPITools('admin-1', SERPAPI_CONFIG);

      const expectedConfigJson = JSON.stringify(SERPAPI_CONFIG);
      expect(mockRegisterCustomTool.mock.calls[0][5].configJson).toBe(expectedConfigJson);
    });

    it('registers with read-only access level', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerSerpAPITools('admin-1', SERPAPI_CONFIG);

      const options = mockRegisterCustomTool.mock.calls[0][5];
      expect(options.language).toBe('javascript');
      expect(options.autoApprove).toBe(true);
      expect(options.accessLevel).toBe('read-only');
    });

    it('passes null as scriptPath and userId correctly', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerSerpAPITools('admin-1', SERPAPI_CONFIG);

      expect(mockRegisterCustomTool.mock.calls[0][1]).toBe('serpapi-read');
      expect(mockRegisterCustomTool.mock.calls[0][3]).toBeNull();
      expect(mockRegisterCustomTool.mock.calls[0][4]).toBe('admin-1');
    });

    it('skips registration when serpapi-read already exists', async () => {
      mockGetCustomTool.mockResolvedValue({ id: 'existing' });

      await registerSerpAPITools('admin-1', SERPAPI_CONFIG);

      expect(mockRegisterCustomTool).not.toHaveBeenCalled();
    });

    it('passes tool code in options', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerSerpAPITools('admin-1', SERPAPI_CONFIG);

      const code = mockRegisterCustomTool.mock.calls[0][5].code;
      expect(code).toContain('serpRequest');
    });
  });

  // ────────────────────────────────────────────────
  // updateSerpAPIConfig
  // ────────────────────────────────────────────────
  describe('updateSerpAPIConfig', () => {
    it('updates config for serpapi-read', async () => {
      mockExecute.mockResolvedValue(undefined);

      const newConfig = { api_key: 'new-key-456' };
      await updateSerpAPIConfig(newConfig);

      expect(mockExecute).toHaveBeenCalledWith(
        `UPDATE custom_tools SET config_json = $1 WHERE workspace_id = $2 AND name = ANY($3)`,
        [JSON.stringify(newConfig), TEST_WORKSPACE_ID, ['serpapi-read']],
      );
    });

    it('serializes config to JSON before saving', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateSerpAPIConfig(SERPAPI_CONFIG);

      const savedConfig = mockExecute.mock.calls[0][1][0];
      expect(savedConfig).toBe(JSON.stringify(SERPAPI_CONFIG));
      expect(JSON.parse(savedConfig)).toEqual(SERPAPI_CONFIG);
    });

    it('calls execute exactly once', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateSerpAPIConfig(SERPAPI_CONFIG);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });
});
