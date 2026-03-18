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

import { manifest as chargebeeManifest } from '../../src/modules/tools/integrations/chargebee';

const TEST_WORKSPACE_ID = 'W_TEST_123';
const registerChargebeeTools = (userId: string, config: Record<string, string>) => chargebeeManifest.register(TEST_WORKSPACE_ID, userId, config);
const updateChargebeeConfig = (config: Record<string, string>) => chargebeeManifest.updateConfig(TEST_WORKSPACE_ID, config);

// ── Helpers ──

const CHARGEBEE_CONFIG = {
  api_key: 'live_test123',
  site: 'test-site',
};

// ── Tests ──

describe('Chargebee Tools Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────
  // Manifest static properties
  // ────────────────────────────────────────────────
  describe('Manifest properties', () => {
    it('has correct id, label, icon, and description', () => {
      expect(chargebeeManifest.id).toBe('chargebee');
      expect(chargebeeManifest.label).toBe('Chargebee');
      expect(chargebeeManifest.icon).toBe(':credit_card:');
      expect(chargebeeManifest.description).toContain('customers');
    });

    it('requires api_key and site config keys', () => {
      expect(chargebeeManifest.configKeys).toEqual(['api_key', 'site']);
    });

    it('has configPlaceholders', () => {
      expect(chargebeeManifest.configPlaceholders).toBeDefined();
      expect(chargebeeManifest.configPlaceholders!.api_key).toContain('live_');
      expect(chargebeeManifest.configPlaceholders!.site).toContain('subdomain');
    });

    it('has two tools: chargebee-read and chargebee-write', () => {
      expect(chargebeeManifest.tools).toHaveLength(2);
      expect(chargebeeManifest.tools[0].name).toBe('chargebee-read');
      expect(chargebeeManifest.tools[0].accessLevel).toBe('read-only');
      expect(chargebeeManifest.tools[0].displayName).toBe('Checking Chargebee');
      expect(chargebeeManifest.tools[1].name).toBe('chargebee-write');
      expect(chargebeeManifest.tools[1].accessLevel).toBe('read-write');
      expect(chargebeeManifest.tools[1].displayName).toBe('Updating Chargebee');
    });
  });

  // ────────────────────────────────────────────────
  // Tool Schema Definitions
  // ────────────────────────────────────────────────
  describe('Tool Schema Definitions', () => {
    it('read schema has correct actions', () => {
      const readSchema = JSON.parse(chargebeeManifest.tools[0].schema);
      expect(readSchema.type).toBe('object');
      expect(readSchema.properties.action.enum).toEqual([
        'list_customers', 'get_customer', 'search_customers',
        'list_subscriptions', 'get_subscription',
        'list_invoices', 'get_invoice',
        'list_plans', 'list_item_prices',
        'list_coupons',
      ]);
      expect(readSchema.required).toEqual(['action']);
    });

    it('write schema has correct actions', () => {
      const writeSchema = JSON.parse(chargebeeManifest.tools[1].schema);
      expect(writeSchema.type).toBe('object');
      expect(writeSchema.properties.action.enum).toEqual([
        'create_customer', 'update_customer',
        'create_subscription', 'update_subscription',
        'cancel_subscription',
        'add_charge', 'apply_coupon',
      ]);
      expect(writeSchema.required).toEqual(['action']);
    });
  });

  // ────────────────────────────────────────────────
  // Tool Code Verification
  // ────────────────────────────────────────────────
  describe('Tool Code', () => {
    it('read tool loads config from chargebee-read.config.json', () => {
      const code = chargebeeManifest.tools[0].code;
      expect(code).toContain("'chargebee-read.config.json'");
    });

    it('write tool loads config from chargebee-write.config.json', () => {
      const code = chargebeeManifest.tools[1].code;
      expect(code).toContain("'chargebee-write.config.json'");
    });

    it('both tools use Basic auth with api_key', () => {
      const readCode = chargebeeManifest.tools[0].code;
      const writeCode = chargebeeManifest.tools[1].code;
      expect(readCode).toContain("Buffer.from(apiKey + ':').toString('base64')");
      expect(writeCode).toContain("Buffer.from(apiKey + ':').toString('base64')");
    });

    it('both tools set 30-second timeout', () => {
      const readCode = chargebeeManifest.tools[0].code;
      const writeCode = chargebeeManifest.tools[1].code;
      expect(readCode).toContain('req.setTimeout(30000');
      expect(writeCode).toContain('req.setTimeout(30000');
    });

    it('read tool handles all actions', () => {
      const code = chargebeeManifest.tools[0].code;
      expect(code).toContain("case 'list_customers':");
      expect(code).toContain("case 'get_customer':");
      expect(code).toContain("case 'search_customers':");
      expect(code).toContain("case 'list_subscriptions':");
      expect(code).toContain("case 'get_subscription':");
      expect(code).toContain("case 'list_invoices':");
      expect(code).toContain("case 'get_invoice':");
      expect(code).toContain("case 'list_plans':");
      expect(code).toContain("case 'list_item_prices':");
      expect(code).toContain("case 'list_coupons':");
    });

    it('write tool handles all actions', () => {
      const code = chargebeeManifest.tools[1].code;
      expect(code).toContain("case 'create_customer':");
      expect(code).toContain("case 'update_customer':");
      expect(code).toContain("case 'create_subscription':");
      expect(code).toContain("case 'update_subscription':");
      expect(code).toContain("case 'cancel_subscription':");
      expect(code).toContain("case 'add_charge':");
      expect(code).toContain("case 'apply_coupon':");
    });
  });

  // ────────────────────────────────────────────────
  // registerChargebeeTools
  // ────────────────────────────────────────────────
  describe('registerChargebeeTools', () => {
    it('registers both read and write tools when neither exists', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerChargebeeTools('admin-1', CHARGEBEE_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(2);
      expect(mockGetCustomTool).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'chargebee-read');
      expect(mockGetCustomTool).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'chargebee-write');
    });

    it('passes configJson to both tools', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerChargebeeTools('admin-1', CHARGEBEE_CONFIG);

      const expectedConfigJson = JSON.stringify(CHARGEBEE_CONFIG);
      expect(mockRegisterCustomTool.mock.calls[0][5].configJson).toBe(expectedConfigJson);
      expect(mockRegisterCustomTool.mock.calls[1][5].configJson).toBe(expectedConfigJson);
    });

    it('registers read tool with read-only access level', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerChargebeeTools('admin-1', CHARGEBEE_CONFIG);

      const readOptions = mockRegisterCustomTool.mock.calls[0][5];
      expect(readOptions.language).toBe('javascript');
      expect(readOptions.autoApprove).toBe(true);
      expect(readOptions.accessLevel).toBe('read-only');
    });

    it('registers write tool with read-write access level', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerChargebeeTools('admin-1', CHARGEBEE_CONFIG);

      const writeOptions = mockRegisterCustomTool.mock.calls[1][5];
      expect(writeOptions.language).toBe('javascript');
      expect(writeOptions.autoApprove).toBe(true);
      expect(writeOptions.accessLevel).toBe('read-write');
    });

    it('passes null as scriptPath and userId correctly', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerChargebeeTools('admin-1', CHARGEBEE_CONFIG);

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

      await registerChargebeeTools('admin-1', CHARGEBEE_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
      expect(mockRegisterCustomTool.mock.calls[0][1]).toBe('chargebee-write');
    });

    it('skips write tool registration when it already exists', async () => {
      mockGetCustomTool
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing-write' });
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerChargebeeTools('admin-1', CHARGEBEE_CONFIG);

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(1);
      expect(mockRegisterCustomTool.mock.calls[0][1]).toBe('chargebee-read');
    });

    it('skips both when both already exist', async () => {
      mockGetCustomTool.mockResolvedValue({ id: 'existing' });

      await registerChargebeeTools('admin-1', CHARGEBEE_CONFIG);

      expect(mockRegisterCustomTool).not.toHaveBeenCalled();
    });

    it('passes tool code in options', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await registerChargebeeTools('admin-1', CHARGEBEE_CONFIG);

      const readCode = mockRegisterCustomTool.mock.calls[0][5].code;
      const writeCode = mockRegisterCustomTool.mock.calls[1][5].code;
      expect(readCode).toContain('chargebeeRequest');
      expect(writeCode).toContain('chargebeeRequest');
    });
  });

  // ────────────────────────────────────────────────
  // updateChargebeeConfig
  // ────────────────────────────────────────────────
  describe('updateChargebeeConfig', () => {
    it('updates config for both chargebee-read and chargebee-write', async () => {
      mockExecute.mockResolvedValue(undefined);

      const newConfig = { api_key: 'live_new456', site: 'new-site' };
      await updateChargebeeConfig(newConfig);

      expect(mockExecute).toHaveBeenCalledWith(
        `UPDATE custom_tools SET config_json = $1 WHERE workspace_id = $2 AND name = ANY($3)`,
        [JSON.stringify(newConfig), TEST_WORKSPACE_ID, ['chargebee-read', 'chargebee-write']],
      );
    });

    it('serializes config to JSON before saving', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateChargebeeConfig(CHARGEBEE_CONFIG);

      const savedConfig = mockExecute.mock.calls[0][1][0];
      expect(savedConfig).toBe(JSON.stringify(CHARGEBEE_CONFIG));
      expect(JSON.parse(savedConfig)).toEqual(CHARGEBEE_CONFIG);
    });

    it('calls execute exactly once', async () => {
      mockExecute.mockResolvedValue(undefined);

      await updateChargebeeConfig(CHARGEBEE_CONFIG);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });
});
