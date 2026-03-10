/**
 * KB Source management — CRUD for sources and API keys, sync orchestration.
 */
import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { logger } from '../../utils/logger';
import type { KBSource, KBApiKey, KBConnectorType, KBProviderType, KBSourceStatus } from '../../types';
import { getProviderForConnector } from './connectors';

// ── API Key Management ──

export async function getApiKey(provider: KBProviderType): Promise<KBApiKey | null> {
  const row = await queryOne<KBApiKey>('SELECT * FROM kb_api_keys WHERE provider = $1', [provider]);
  return row || null;
}

export async function setApiKey(
  provider: KBProviderType,
  configJson: Record<string, string>,
  userId: string,
): Promise<KBApiKey> {
  const existing = await getApiKey(provider);
  const config = JSON.stringify(configJson);
  const setupComplete = Object.values(configJson).every(v => v && v.trim().length > 0);

  if (existing) {
    await execute(
      `UPDATE kb_api_keys SET config_json = $1, setup_complete = $2, updated_at = NOW() WHERE provider = $3`,
      [config, setupComplete, provider],
    );
    logger.info('KB API key updated', { provider, userId, setupComplete });
    return { ...existing, config_json: config, setup_complete: setupComplete };
  }

  const id = uuid();
  await execute(
    `INSERT INTO kb_api_keys (id, provider, config_json, setup_complete, created_by) VALUES ($1, $2, $3, $4, $5)`,
    [id, provider, config, setupComplete, userId],
  );
  logger.info('KB API key created', { provider, userId, setupComplete });
  return { id, provider, config_json: config, setup_complete: setupComplete, created_by: userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

export async function setApiKeyField(
  provider: KBProviderType,
  key: string,
  value: string,
  userId: string,
): Promise<Record<string, string>> {
  const existing = await getApiKey(provider);
  const config = existing ? JSON.parse(existing.config_json) : {};
  config[key] = value;

  await setApiKey(provider, config, userId);
  return config;
}

export async function removeApiKeyField(
  provider: KBProviderType,
  key: string,
  userId: string,
): Promise<Record<string, string>> {
  const existing = await getApiKey(provider);
  if (!existing) throw new Error(`No API key configured for ${provider}`);
  const config = JSON.parse(existing.config_json);
  delete config[key];

  await setApiKey(provider, config, userId);
  return config;
}

export async function isProviderConfigured(provider: KBProviderType): Promise<boolean> {
  const key = await getApiKey(provider);
  return key?.setup_complete === true;
}

export async function listApiKeys(): Promise<KBApiKey[]> {
  return query<KBApiKey>('SELECT * FROM kb_api_keys ORDER BY provider');
}

export async function deleteApiKey(provider: KBProviderType, userId: string): Promise<void> {
  await execute('DELETE FROM kb_api_keys WHERE provider = $1', [provider]);
  logger.info('KB API key deleted', { provider, userId });
}

// ── Source Management ──

export async function createSource(params: {
  name: string;
  sourceType: KBConnectorType;
  config: Record<string, string>;
  createdBy: string;
}): Promise<KBSource> {
  const id = uuid();
  const provider = getProviderForConnector(params.sourceType);
  const providerConfigured = await isProviderConfigured(provider);

  const source: KBSource = {
    id,
    name: params.name,
    source_type: params.sourceType,
    config_json: JSON.stringify(params.config),
    status: providerConfigured ? 'active' : 'needs_setup',
    auto_sync: false,
    sync_interval_hours: 24,
    last_sync_at: null,
    entry_count: 0,
    error_message: null,
    created_by: params.createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await execute(
    `INSERT INTO kb_sources (id, name, source_type, config_json, status, auto_sync, sync_interval_hours, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [source.id, source.name, source.source_type, source.config_json, source.status, source.auto_sync, source.sync_interval_hours, source.created_by],
  );

  logger.info('KB source created', { sourceId: id, name: params.name, type: params.sourceType });
  return source;
}

export async function getSource(id: string): Promise<KBSource | null> {
  const row = await queryOne<KBSource>('SELECT * FROM kb_sources WHERE id = $1', [id]);
  return row || null;
}

export async function listSources(): Promise<KBSource[]> {
  return query<KBSource>('SELECT * FROM kb_sources ORDER BY created_at DESC');
}

export async function updateSource(id: string, updates: Partial<Pick<KBSource, 'name' | 'config_json' | 'status' | 'auto_sync' | 'sync_interval_hours' | 'error_message' | 'entry_count' | 'last_sync_at'>>): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;

  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      sets.push(`${key} = $${idx}`);
      vals.push(val);
      idx++;
    }
  }

  if (sets.length === 0) return;

  sets.push(`updated_at = NOW()`);
  vals.push(id);
  await execute(`UPDATE kb_sources SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
}

export async function deleteSource(id: string, userId: string): Promise<void> {
  // Remove linked KB entries
  await execute('DELETE FROM kb_chunks WHERE entry_id IN (SELECT id FROM kb_entries WHERE kb_source_id = $1)', [id]);
  await execute('DELETE FROM kb_entries WHERE kb_source_id = $1', [id]);
  await execute('DELETE FROM kb_sources WHERE id = $1', [id]);
  logger.info('KB source deleted', { sourceId: id, userId });
}

export async function toggleAutoSync(id: string, enabled: boolean): Promise<void> {
  await execute('UPDATE kb_sources SET auto_sync = $1, updated_at = NOW() WHERE id = $2', [enabled, id]);
  logger.info('KB source auto-sync toggled', { sourceId: id, enabled });
}

export async function updateSourceStatus(id: string, status: KBSourceStatus, errorMessage?: string): Promise<void> {
  await execute(
    'UPDATE kb_sources SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
    [status, errorMessage || null, id],
  );
}

// ── Sync Operations ──

export async function startSync(sourceId: string): Promise<void> {
  const source = await getSource(sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found`);

  const provider = getProviderForConnector(source.source_type);
  const providerConfigured = await isProviderConfigured(provider);
  if (!providerConfigured) {
    throw new Error(`Provider ${provider} is not configured. Set up API keys first.`);
  }

  await updateSourceStatus(sourceId, 'syncing');
  logger.info('KB source sync started', { sourceId, type: source.source_type });

  // TODO: Dispatch actual sync job to worker queue
  // For now, just mark as syncing — the worker will pick it up
}

export async function flushAndResync(sourceId: string, userId: string): Promise<void> {
  const source = await getSource(sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found`);

  // Remove all entries from this source
  await execute('DELETE FROM kb_chunks WHERE entry_id IN (SELECT id FROM kb_entries WHERE kb_source_id = $1)', [sourceId]);
  await execute('DELETE FROM kb_entries WHERE kb_source_id = $1', [sourceId]);
  await updateSource(sourceId, { entry_count: 0 });

  logger.info('KB source flushed', { sourceId, userId });

  // Start fresh sync
  await startSync(sourceId);
}

// ── Sources Needing Auto-Sync ──

export async function getSourcesDueForSync(): Promise<KBSource[]> {
  return query<KBSource>(`
    SELECT * FROM kb_sources
    WHERE auto_sync = TRUE
      AND status IN ('active', 'error')
      AND (last_sync_at IS NULL OR last_sync_at < NOW() - (sync_interval_hours || ' hours')::INTERVAL)
    ORDER BY last_sync_at ASC NULLS FIRST
  `);
}
