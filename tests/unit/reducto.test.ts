import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  getReductoStatus,
  getReductoApiKey,
  setReductoApiKey,
  setReductoEnabled,
  isReductoEnabledAndConfigured,
  testReductoApiKey,
  parseWithReducto,
  REDUCTO_MAX_UPLOAD_BYTES,
} from '../../src/modules/reducto';

function settingMap(map: Record<string, string | null>) {
  return async (_ws: string, key: string) => map[key] ?? null;
}

const enabledWorkspace = () => settingMap({
  reducto_api_key: 'enc.tag',
  reducto_api_key_iv: 'iv-hex',
  reducto_enabled: 'true',
});

describe('Reducto config', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getReductoStatus returns configured=false and enabled=false when nothing is set', async () => {
    mockGetSetting.mockImplementation(settingMap({}));
    const status = await getReductoStatus('W1');
    expect(status).toEqual({ configured: false, enabled: false });
  });

  it('getReductoStatus surfaces configured=true when key is present but enabled=false until the toggle is on', async () => {
    mockGetSetting.mockImplementation(settingMap({ reducto_api_key: 'enc.tag' }));
    expect(await getReductoStatus('W1')).toEqual({ configured: true, enabled: false });

    mockGetSetting.mockImplementation(settingMap({ reducto_api_key: 'enc.tag', reducto_enabled: 'true' }));
    expect(await getReductoStatus('W1')).toEqual({ configured: true, enabled: true });
  });

  it('isReductoEnabledAndConfigured requires both a key AND the toggle on', async () => {
    mockGetSetting.mockImplementation(settingMap({ reducto_enabled: 'true' })); // no key
    expect(await isReductoEnabledAndConfigured('W1')).toBe(false);

    mockGetSetting.mockImplementation(settingMap({ reducto_api_key: 'x' })); // no toggle
    expect(await isReductoEnabledAndConfigured('W1')).toBe(false);

    mockGetSetting.mockImplementation(settingMap({ reducto_api_key: 'x', reducto_enabled: 'true' }));
    expect(await isReductoEnabledAndConfigured('W1')).toBe(true);
  });

  it('setReductoApiKey encrypts and stores key + iv under workspace settings', async () => {
    mockEncrypt.mockReturnValue({ encrypted: 'enc.tag', iv: 'iv-hex' });
    await setReductoApiKey('W1', 'my-reducto-key', 'admin1');
    expect(mockSetSetting).toHaveBeenCalledWith('W1', 'reducto_api_key', 'enc.tag', 'admin1');
    expect(mockSetSetting).toHaveBeenCalledWith('W1', 'reducto_api_key_iv', 'iv-hex', 'admin1');
  });

  it('setReductoEnabled writes the boolean toggle as a string', async () => {
    await setReductoEnabled('W1', true, 'admin1');
    expect(mockSetSetting).toHaveBeenCalledWith('W1', 'reducto_enabled', 'true', 'admin1');
    await setReductoEnabled('W1', false, 'admin1');
    expect(mockSetSetting).toHaveBeenCalledWith('W1', 'reducto_enabled', 'false', 'admin1');
  });

  it('getReductoApiKey returns null if no key is stored and returns decrypted key when present', async () => {
    mockGetSetting.mockImplementation(settingMap({}));
    expect(await getReductoApiKey('W1')).toBeNull();

    mockGetSetting.mockImplementation(settingMap({ reducto_api_key: 'enc.tag', reducto_api_key_iv: 'iv-hex' }));
    mockDecrypt.mockReturnValue('real-reducto-key');
    expect(await getReductoApiKey('W1')).toBe('real-reducto-key');
  });

  it('getReductoApiKey returns null (not throw) if decrypt fails — admin should re-enter the key', async () => {
    mockGetSetting.mockImplementation(settingMap({ reducto_api_key: 'enc.tag', reducto_api_key_iv: 'iv-hex' }));
    mockDecrypt.mockImplementation(() => { throw new Error('bad cipher'); });
    expect(await getReductoApiKey('W1')).toBeNull();
  });
});

describe('Reducto testReductoApiKey', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('rejects empty or obviously-short keys without hitting the network', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy;
    expect((await testReductoApiKey('')).ok).toBe(false);
    expect((await testReductoApiKey('abc')).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns ok=true on 2xx from /upload — does NOT call /parse (which would burn credits)', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    globalThis.fetch = spy;
    expect((await testReductoApiKey('reducto-xxxxxxxxx')).ok).toBe(true);
    const [url] = spy.mock.calls[0];
    expect(String(url)).toContain('/upload');
    expect(String(url)).not.toContain('/parse');
  });

  it('returns ok=false with friendly reason on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);
    const result = await testReductoApiKey('reducto-xxxxxxxxx');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unauthorized/i);
  });
});

describe('parseWithReducto gating', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  const baseInput = () => ({
    bytes: Buffer.from('binary'),
    filename: 'doc.pdf',
    mimeType: 'application/pdf',
    workspaceId: 'W1',
  });

  it('throws if no key is configured — no network call', async () => {
    mockGetSetting.mockImplementation(settingMap({}));
    const spy = vi.fn();
    globalThis.fetch = spy;
    await expect(parseWithReducto(baseInput())).rejects.toThrow(/not configured/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws if key is present but toggle is off — no network call', async () => {
    mockGetSetting.mockImplementation(settingMap({
      reducto_api_key: 'enc.tag',
      reducto_api_key_iv: 'iv-hex',
      reducto_enabled: 'false',
    }));
    mockDecrypt.mockReturnValue('real-key');
    const spy = vi.fn();
    globalThis.fetch = spy;
    await expect(parseWithReducto(baseInput())).rejects.toThrow(/not enabled/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects files larger than Reducto's 100 MB direct-upload cap without hitting the network", async () => {
    mockGetSetting.mockImplementation(enabledWorkspace());
    mockDecrypt.mockReturnValue('real-key');
    const spy = vi.fn();
    globalThis.fetch = spy;
    const big = { ...baseInput(), bytes: Buffer.alloc(REDUCTO_MAX_UPLOAD_BYTES + 1) };
    await expect(parseWithReducto(big)).rejects.toThrow(/100 MB|direct-upload cap/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('runs upload → parse and returns extracted text when enabled', async () => {
    mockGetSetting.mockImplementation(enabledWorkspace());
    mockDecrypt.mockReturnValue('real-key');
    const spy = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ file_id: 'reducto://abc' }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          result: { chunks: [{ content: 'reducto extracted' }, { content: 'more content' }] },
          usage: { credits: 1 },
        }),
        text: async () => '',
      } as any);
    globalThis.fetch = spy;

    const result = await parseWithReducto(baseInput());
    expect(result.text).toContain('reducto extracted');
    expect(result.text).toContain('more content');
    expect(result.metadata.parser).toBe('reducto');
    expect((result.metadata as any).reductoUsage).toEqual({ credits: 1 });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[0][0])).toContain('/upload');
    expect(String(spy.mock.calls[1][0])).toContain('/parse');
    // Both calls must carry the bearer token.
    for (const call of spy.mock.calls) {
      const init = call[1] as any;
      expect(init.headers.Authorization).toBe('Bearer real-key');
    }
  });

  it('throws with a useful error on /upload 5xx so the dispatcher can fall back to the local parser', async () => {
    mockGetSetting.mockImplementation(enabledWorkspace());
    mockDecrypt.mockReturnValue('real-key');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server blew up',
    } as any);
    await expect(parseWithReducto(baseInput())).rejects.toThrow(/upload.*500/i);
  });

  it('throws when Reducto returns empty text — treated as a parse failure, not a success', async () => {
    mockGetSetting.mockImplementation(enabledWorkspace());
    mockDecrypt.mockReturnValue('real-key');
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ file_id: 'reducto://abc' }), text: async () => '' } as any)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: { chunks: [] } }), text: async () => '' } as any);
    await expect(parseWithReducto(baseInput())).rejects.toThrow(/empty/);
  });

  it('falls back from sync /parse to /parse_async + polling when sync parse aborts', async () => {
    mockGetSetting.mockImplementation(enabledWorkspace());
    mockDecrypt.mockReturnValue('real-key');

    const abortErr = new Error('aborted');
    (abortErr as any).name = 'AbortError';

    globalThis.fetch = vi.fn()
      // /upload → file_id
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ file_id: 'reducto://abc' }), text: async () => '' } as any)
      // /parse → abort (simulates 60s timeout)
      .mockRejectedValueOnce(abortErr)
      // /parse_async → job_id
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ job_id: 'job-1' }), text: async () => '' } as any)
      // /job → Pending
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'Pending' }), text: async () => '' } as any)
      // /job → Completed
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ status: 'Completed', result: { result: { chunks: [{ content: 'late but good' }] } } }),
        text: async () => '',
      } as any);

    // Speed up the poll loop — don't actually wait 3s between polls.
    vi.useFakeTimers();
    const promise = parseWithReducto(baseInput());
    // Drain any pending microtasks, then advance past the poll sleep twice.
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.text).toBe('late but good');
    expect(result.metadata.parser).toBe('reducto');
  });
});
