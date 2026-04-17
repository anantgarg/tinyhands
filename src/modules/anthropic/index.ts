import Anthropic from '@anthropic-ai/sdk';
import { encrypt, decrypt } from '../connections/crypto';
import { getSetting, setSetting } from '../workspace-settings';
import { logger } from '../../utils/logger';

const KEY_NAME = 'anthropic_api_key';
const IV_NAME = 'anthropic_api_key_iv';

// ── Per-workspace Anthropic API key resolution ──
// Keys are stored encrypted in workspace_settings. The runtime never reads
// ANTHROPIC_API_KEY from process.env — that variable is bootstrap-only and
// migrated into workspace 1's settings on the multi-tenant migration.

export class AnthropicKeyMissingError extends Error {
  constructor(public workspaceId: string) {
    super(`Workspace ${workspaceId} has no Anthropic API key configured. Ask an admin to add one in Settings.`);
    this.name = 'AnthropicKeyMissingError';
  }
}

export async function getAnthropicApiKey(workspaceId: string): Promise<string> {
  const [encrypted, iv] = await Promise.all([
    getSetting(workspaceId, KEY_NAME),
    getSetting(workspaceId, IV_NAME),
  ]);
  if (!encrypted || !iv) throw new AnthropicKeyMissingError(workspaceId);
  try {
    return decrypt(encrypted, iv);
  } catch (err: any) {
    logger.error('Failed to decrypt Anthropic key', { workspaceId, error: err.message });
    throw new AnthropicKeyMissingError(workspaceId);
  }
}

export async function setAnthropicApiKey(workspaceId: string, apiKey: string, updatedBy?: string): Promise<void> {
  const { encrypted, iv } = encrypt(apiKey);
  await setSetting(workspaceId, KEY_NAME, encrypted, updatedBy);
  await setSetting(workspaceId, IV_NAME, iv, updatedBy);
  logger.info('Anthropic API key set', { workspaceId, updatedBy });
}

export async function hasAnthropicApiKey(workspaceId: string): Promise<boolean> {
  const key = await getSetting(workspaceId, KEY_NAME);
  return !!key;
}

/**
 * Build an Anthropic SDK client for the given workspace. Throws
 * AnthropicKeyMissingError if the workspace has no key configured. All modules
 * that call the Anthropic API at request time must use this factory rather
 * than `new Anthropic()` — the default constructor falls back to process.env,
 * which would bleed credentials across tenants.
 */
export async function createAnthropicClient(workspaceId: string): Promise<Anthropic> {
  const apiKey = await getAnthropicApiKey(workspaceId);
  return new Anthropic({ apiKey });
}

/**
 * Validate a candidate Anthropic API key by calling /v1/models. Returns ok=true
 * if the key is accepted, ok=false with a friendly reason otherwise. Never
 * throws on rejection — the caller wants a message to show the admin.
 */
export async function testAnthropicApiKey(apiKey: string): Promise<{ ok: boolean; reason?: string }> {
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    return { ok: false, reason: 'Key does not look like an Anthropic API key (should start with sk-ant-).' };
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, reason: 'Anthropic rejected the key (401 Unauthorized).' };
    if (res.status === 403) return { ok: false, reason: 'Key lacks permission to list models (403).' };
    return { ok: false, reason: `Anthropic returned ${res.status}. Check the key and try again.` };
  } catch (err: any) {
    return { ok: false, reason: `Network error reaching Anthropic: ${err.message}` };
  }
}
