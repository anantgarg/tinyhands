import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();

vi.mock('../../src/modules/workspace-settings', () => ({
  getSetting: (...args: any[]) => mockGetSetting(...args),
  setSetting: (...args: any[]) => mockSetSetting(...args),
}));

vi.mock('../../src/modules/connections/crypto', () => ({
  encrypt: (plaintext: string) => mockEncrypt(plaintext),
  decrypt: (ciphertext: string, iv: string) => mockDecrypt(ciphertext, iv),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getAnthropicApiKey,
  setAnthropicApiKey,
  hasAnthropicApiKey,
  testAnthropicApiKey,
  AnthropicKeyMissingError,
} from '../../src/modules/anthropic';

describe('Anthropic key resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws AnthropicKeyMissingError when workspace has no key', async () => {
    mockGetSetting.mockResolvedValue(null);
    await expect(getAnthropicApiKey('W_NO_KEY')).rejects.toBeInstanceOf(AnthropicKeyMissingError);
  });

  it('returns decrypted key when workspace has one set', async () => {
    mockGetSetting.mockImplementation(async (_ws: string, key: string) =>
      key === 'anthropic_api_key' ? 'cipher.tag' : 'iv-hex',
    );
    mockDecrypt.mockReturnValue('sk-ant-real-key');

    const key = await getAnthropicApiKey('W_WITH_KEY');
    expect(key).toBe('sk-ant-real-key');
    expect(mockDecrypt).toHaveBeenCalledWith('cipher.tag', 'iv-hex');
  });

  it('throws AnthropicKeyMissingError when decrypt fails', async () => {
    mockGetSetting.mockResolvedValue('garbage');
    mockDecrypt.mockImplementation(() => { throw new Error('bad cipher'); });
    await expect(getAnthropicApiKey('W_CORRUPT')).rejects.toBeInstanceOf(AnthropicKeyMissingError);
  });

  it('setAnthropicApiKey encrypts and persists key + IV', async () => {
    mockEncrypt.mockReturnValue({ encrypted: 'enc.tag', iv: 'iv-hex' });
    await setAnthropicApiKey('W1', 'sk-ant-abc', 'me');

    expect(mockSetSetting).toHaveBeenCalledWith('W1', 'anthropic_api_key', 'enc.tag', 'me');
    expect(mockSetSetting).toHaveBeenCalledWith('W1', 'anthropic_api_key_iv', 'iv-hex', 'me');
  });

  it('hasAnthropicApiKey is true when setting exists', async () => {
    mockGetSetting.mockResolvedValue('cipher.tag');
    expect(await hasAnthropicApiKey('W1')).toBe(true);
    mockGetSetting.mockResolvedValue(null);
    expect(await hasAnthropicApiKey('W1')).toBe(false);
  });

  it('testAnthropicApiKey rejects keys that do not look right', async () => {
    const result = await testAnthropicApiKey('not-a-real-key');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Anthropic API key/);
  });

  it('testAnthropicApiKey validates via Anthropic API', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    const result = await testAnthropicApiKey('sk-ant-test-key-12345');
    expect(result.ok).toBe(true);
    globalThis.fetch = originalFetch;
  });

  it('testAnthropicApiKey surfaces 401 as an admin-friendly reason', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);
    const result = await testAnthropicApiKey('sk-ant-invalid-00000');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('401');
    globalThis.fetch = originalFetch;
  });
});
