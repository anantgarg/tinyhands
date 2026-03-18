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

vi.mock('../../src/config', () => ({
  config: {
    server: {
      port: 3000,
      internalSecret: 'test-secret',
    },
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { manifest as kbManifest } from '../../src/modules/tools/integrations/kb';

const TEST_WORKSPACE_ID = 'W_TEST_123';

// ── Tests ──

describe('KB Tools Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────
  // Manifest static properties
  // ────────────────────────────────────────────────
  describe('Manifest properties', () => {
    it('has correct id, label, icon, and description', () => {
      expect(kbManifest.id).toBe('kb');
      expect(kbManifest.label).toBe('Knowledge Base');
      expect(kbManifest.icon).toBe(':books:');
      expect(kbManifest.description).toContain('knowledge base');
    });

    it('has no required config keys', () => {
      expect(kbManifest.configKeys).toEqual([]);
    });

    it('has one tool: kb-search', () => {
      expect(kbManifest.tools).toHaveLength(1);
      expect(kbManifest.tools[0].name).toBe('kb-search');
      expect(kbManifest.tools[0].accessLevel).toBe('read-only');
      expect(kbManifest.tools[0].displayName).toBe('Searching knowledge base');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Schema
  // ────────────────────────────────────────────────
  describe('Tool Schema', () => {
    it('has correct actions in the schema', () => {
      const schema = JSON.parse(kbManifest.tools[0].schema);
      expect(schema.type).toBe('object');
      expect(schema.properties.action.enum).toEqual(['search', 'list', 'categories']);
      expect(schema.required).toEqual(['action']);
    });

    it('has query, category, and limit properties', () => {
      const schema = JSON.parse(kbManifest.tools[0].schema);
      expect(schema.properties.query).toBeDefined();
      expect(schema.properties.query.type).toBe('string');
      expect(schema.properties.category).toBeDefined();
      expect(schema.properties.category.type).toBe('string');
      expect(schema.properties.limit).toBeDefined();
      expect(schema.properties.limit.type).toBe('number');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code Verification
  // ────────────────────────────────────────────────
  describe('Tool Code', () => {
    it('loads config from kb-search.config.json', () => {
      const code = kbManifest.tools[0].code;
      expect(code).toContain("'kb-search.config.json'");
    });

    it('uses http (not https) for internal API calls', () => {
      const code = kbManifest.tools[0].code;
      expect(code).toContain("var http = require('http')");
    });

    it('defaults to host.docker.internal:3000', () => {
      const code = kbManifest.tools[0].code;
      expect(code).toContain("cfg.api_url || 'http://host.docker.internal:3000'");
    });

    it('sends X-Internal-Secret header when configured', () => {
      const code = kbManifest.tools[0].code;
      expect(code).toContain("'X-Internal-Secret'");
    });

    it('handles search action', () => {
      const code = kbManifest.tools[0].code;
      expect(code).toContain("case 'search':");
      expect(code).toContain('/internal/kb/search');
    });

    it('handles list action', () => {
      const code = kbManifest.tools[0].code;
      expect(code).toContain("case 'list':");
      expect(code).toContain('/internal/kb/list');
    });

    it('handles categories action', () => {
      const code = kbManifest.tools[0].code;
      expect(code).toContain("case 'categories':");
      expect(code).toContain('/internal/kb/categories');
    });

    it('sets 15-second timeout', () => {
      const code = kbManifest.tools[0].code;
      expect(code).toContain('req.setTimeout(15000');
    });

    it('caps limit at 20', () => {
      const code = kbManifest.tools[0].code;
      expect(code).toContain('Math.min(input.limit || 10, 20)');
    });
  });

  // ────────────────────────────────────────────────
  // register
  // ────────────────────────────────────────────────
  describe('register', () => {
    it('registers kb-search tool when it does not exist', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await kbManifest.register(TEST_WORKSPACE_ID, 'system', {});

      expect(mockGetCustomTool).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'kb-search');
      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
      expect(mockRegisterCustomTool.mock.calls[0][0]).toBe(TEST_WORKSPACE_ID);
      expect(mockRegisterCustomTool.mock.calls[0][1]).toBe('kb-search');
      expect(mockRegisterCustomTool.mock.calls[0][4]).toBe('system');
    });

    it('passes correct options to registerCustomTool', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await kbManifest.register(TEST_WORKSPACE_ID, 'system', {});

      const options = mockRegisterCustomTool.mock.calls[0][5];
      expect(options.language).toBe('javascript');
      expect(options.autoApprove).toBe(true);
      expect(options.accessLevel).toBe('read-only');
    });

    it('includes api_url and internal_secret in config', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await kbManifest.register(TEST_WORKSPACE_ID, 'system', {});

      const options = mockRegisterCustomTool.mock.calls[0][5];
      const configJson = JSON.parse(options.configJson);
      expect(configJson.api_url).toBe('http://host.docker.internal:3000');
      expect(configJson.internal_secret).toBe('test-secret');
    });

    it('skips registration when kb-search already exists', async () => {
      mockGetCustomTool.mockResolvedValue({ id: 'existing-kb' });

      await kbManifest.register(TEST_WORKSPACE_ID, 'system', {});

      expect(mockRegisterCustomTool).not.toHaveBeenCalled();
    });

    it('passes null as scriptPath', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await kbManifest.register(TEST_WORKSPACE_ID, 'system', {});

      expect(mockRegisterCustomTool.mock.calls[0][3]).toBeNull();
    });

    it('passes schema as second argument', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await kbManifest.register(TEST_WORKSPACE_ID, 'system', {});

      const schemaArg = mockRegisterCustomTool.mock.calls[0][2];
      const parsed = JSON.parse(schemaArg);
      expect(parsed.type).toBe('object');
      expect(parsed.properties.action).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────
  // updateConfig
  // ────────────────────────────────────────────────
  describe('updateConfig', () => {
    it('is a no-op (KB config derived from app config)', async () => {
      await kbManifest.updateConfig(TEST_WORKSPACE_ID, {});

      expect(mockExecute).not.toHaveBeenCalled();
    });
  });
});
