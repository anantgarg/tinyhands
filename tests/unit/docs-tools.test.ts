import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../src/config', () => ({
  config: {
    server: { port: 3000, internalSecret: 'test-secret' },
  },
}));

import { manifest } from '../../src/modules/tools/integrations/docs';

const TEST_WORKSPACE_ID = 'W_TEST';

// ── Tests ──

describe('Docs Tools Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────
  // Manifest Properties
  // ────────────────────────────────────────────────
  describe('Manifest Properties', () => {
    it('should have id "docs"', () => {
      expect(manifest.id).toBe('docs');
    });

    it('should have no required config keys', () => {
      expect(manifest.configKeys).toEqual([]);
    });

    it('should have exactly 2 tools', () => {
      expect(manifest.tools).toHaveLength(2);
    });
  });

  // ────────────────────────────────────────────────
  // Read Tool Schema
  // ────────────────────────────────────────────────
  describe('Read Tool (docs-read)', () => {
    it('should have accessLevel read-only', () => {
      const readTool = manifest.tools[0];
      expect(readTool.name).toBe('docs-read');
      expect(readTool.accessLevel).toBe('read-only');
    });

    it('should have a valid schema with correct action enum', () => {
      const readTool = manifest.tools[0];
      const schema = JSON.parse(readTool.schema);
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['action']);
      expect(schema.properties.action.enum).toEqual([
        'list',
        'search',
        'read_doc',
        'read_sheet_tab',
        'read_file',
      ]);
    });

    it('should include document_id and query properties in schema', () => {
      const schema = JSON.parse(manifest.tools[0].schema);
      expect(schema.properties.document_id).toBeDefined();
      expect(schema.properties.query).toBeDefined();
      expect(schema.properties.tab_id).toBeDefined();
      expect(schema.properties.limit).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────
  // Write Tool Schema
  // ────────────────────────────────────────────────
  describe('Write Tool (docs-write)', () => {
    it('should have accessLevel read-write', () => {
      const writeTool = manifest.tools[1];
      expect(writeTool.name).toBe('docs-write');
      expect(writeTool.accessLevel).toBe('read-write');
    });

    it('should have a valid schema with correct action enum', () => {
      const writeTool = manifest.tools[1];
      const schema = JSON.parse(writeTool.schema);
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['action']);
      expect(schema.properties.action.enum).toEqual([
        'create_doc',
        'create_sheet',
        'create_file',
        'update_doc',
        'update_cells',
        'append_rows',
        'create_tab',
        'delete_tab',
        'rename',
        'archive',
      ]);
    });

    it('should include document modification properties in schema', () => {
      const schema = JSON.parse(manifest.tools[1].schema);
      expect(schema.properties.title).toBeDefined();
      expect(schema.properties.content).toBeDefined();
      expect(schema.properties.document_id).toBeDefined();
      expect(schema.properties.cells).toBeDefined();
      expect(schema.properties.rows).toBeDefined();
      expect(schema.properties.csv).toBeDefined();
    });

    it('should include expected_version property for version conflict detection', () => {
      const schema = JSON.parse(manifest.tools[1].schema);
      expect(schema.properties.expected_version).toBeDefined();
      expect(schema.properties.expected_version.type).toBe('number');
    });

    it('should have delete_tab in the write tool code that calls internal DELETE endpoint', () => {
      const writeTool = manifest.tools[1];
      expect(writeTool.code).toContain("case 'delete_tab'");
      expect(writeTool.code).toContain('/internal/docs/sheet/');
      expect(writeTool.code).not.toContain('not yet supported');
    });

    it('should pass expected_version in update_doc action', () => {
      const writeTool = manifest.tools[1];
      expect(writeTool.code).toContain('expected_version');
      expect(writeTool.code).toContain("body.expected_version = input.expected_version");
    });

    it('should return version in create and update responses', () => {
      const writeTool = manifest.tools[1];
      // create_doc response
      expect(writeTool.code).toContain("version: resp.data.version");
    });
  });

  // ────────────────────────────────────────────────
  // Register Function
  // ────────────────────────────────────────────────
  describe('register()', () => {
    it('should call registerCustomTool twice when tools do not exist', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await manifest.register(TEST_WORKSPACE_ID, 'user-1', {});

      expect(mockRegisterCustomTool).toHaveBeenCalledTimes(2);

      const readCall = mockRegisterCustomTool.mock.calls[0];
      expect(readCall[0]).toBe(TEST_WORKSPACE_ID);
      expect(readCall[1]).toBe('docs-read');

      const writeCall = mockRegisterCustomTool.mock.calls[1];
      expect(writeCall[0]).toBe(TEST_WORKSPACE_ID);
      expect(writeCall[1]).toBe('docs-write');
    });

    it('should skip registration when tools already exist', async () => {
      mockGetCustomTool.mockResolvedValue({ id: 'existing' });

      await manifest.register(TEST_WORKSPACE_ID, 'user-1', {});

      expect(mockRegisterCustomTool).not.toHaveBeenCalled();
    });

    it('should include internal_secret in config when available', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await manifest.register(TEST_WORKSPACE_ID, 'user-1', {});

      const readCall = mockRegisterCustomTool.mock.calls[0];
      const configJson = JSON.parse(readCall[5].configJson);
      expect(configJson.internal_secret).toBe('test-secret');
      expect(configJson.api_url).toContain('3000');
    });

    it('should register read tool as read-only and write tool as read-write', async () => {
      mockGetCustomTool.mockResolvedValue(null);
      mockRegisterCustomTool.mockResolvedValue(undefined);

      await manifest.register(TEST_WORKSPACE_ID, 'user-1', {});

      const readCall = mockRegisterCustomTool.mock.calls[0];
      expect(readCall[5].accessLevel).toBe('read-only');

      const writeCall = mockRegisterCustomTool.mock.calls[1];
      expect(writeCall[5].accessLevel).toBe('read-write');
    });
  });
});
