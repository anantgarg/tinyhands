import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
}));

import { getSetting, setSetting, getAllSettings } from '../../src/modules/workspace-settings';

describe('workspace-settings module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getSetting', () => {
    it('should return the value when setting exists', async () => {
      mockQueryOne.mockResolvedValue({ workspace_id: 'W1', key: 'theme', value: 'dark', updated_by: 'U1', updated_at: '2024-01-01' });

      const result = await getSetting('W1', 'theme');

      expect(result).toBe('dark');
      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT * FROM workspace_settings WHERE workspace_id = $1 AND key = $2',
        ['W1', 'theme'],
      );
    });

    it('should return null when setting does not exist', async () => {
      mockQueryOne.mockResolvedValue(null);

      const result = await getSetting('W1', 'missing-key');

      expect(result).toBeNull();
    });

    it('should return null when row exists but value is undefined', async () => {
      mockQueryOne.mockResolvedValue({ workspace_id: 'W1', key: 'empty', value: undefined });

      const result = await getSetting('W1', 'empty');

      expect(result).toBeNull();
    });
  });

  describe('setSetting', () => {
    it('should upsert setting with updatedBy', async () => {
      await setSetting('W1', 'theme', 'light', 'U_ADMIN');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO workspace_settings'),
        ['W1', 'theme', 'light', 'U_ADMIN'],
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.any(Array),
      );
    });

    it('should upsert setting without updatedBy', async () => {
      await setSetting('W1', 'theme', 'dark');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO workspace_settings'),
        ['W1', 'theme', 'dark', null],
      );
    });
  });

  describe('getAllSettings', () => {
    it('should return all settings for workspace', async () => {
      const settings = [
        { workspace_id: 'W1', key: 'theme', value: 'dark', updated_by: 'U1', updated_at: '2024-01-01' },
        { workspace_id: 'W1', key: 'locale', value: 'en', updated_by: 'U2', updated_at: '2024-01-02' },
      ];
      mockQuery.mockResolvedValue(settings);

      const result = await getAllSettings('W1');

      expect(result).toEqual(settings);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM workspace_settings WHERE workspace_id = $1',
        ['W1'],
      );
    });

    it('should return empty array when no settings exist', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getAllSettings('W1');

      expect(result).toEqual([]);
    });
  });
});
