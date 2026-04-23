/**
 * KB Source management — CRUD for sources and API keys, sync orchestration.
 */
import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { logger } from '../../utils/logger';
import type { KBSource, KBApiKey, KBConnectorType, KBProviderType, KBSourceStatus } from '../../types';
import { getProviderForConnector } from './connectors';
import { syncSource } from './sync-handlers';

// ── API Key Management ──

export async function getApiKey(workspaceId: string, provider: KBProviderType): Promise<KBApiKey | null> {
  const row = await queryOne<KBApiKey>('SELECT * FROM kb_api_keys WHERE provider = $1 AND workspace_id = $2', [provider, workspaceId]);
  return row || null;
}

export async function setApiKey(
  workspaceId: string,
  provider: KBProviderType,
  configJson: Record<string, string>,
  userId: string,
): Promise<KBApiKey> {
  const existing = await getApiKey(workspaceId, provider);
  const config = JSON.stringify(configJson);
  const setupComplete = Object.values(configJson).every(v => v && v.trim().length > 0);

  if (existing) {
    await execute(
      `UPDATE kb_api_keys SET config_json = $1, setup_complete = $2, updated_at = NOW() WHERE provider = $3 AND workspace_id = $4`,
      [config, setupComplete, provider, workspaceId],
    );
    logger.info('KB API key updated', { provider, userId, setupComplete });
    return { ...existing, config_json: config, setup_complete: setupComplete };
  }

  const id = uuid();
  await execute(
    `INSERT INTO kb_api_keys (id, workspace_id, provider, config_json, setup_complete, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, workspaceId, provider, config, setupComplete, userId],
  );
  logger.info('KB API key created', { provider, userId, setupComplete });
  return { id, provider, config_json: config, setup_complete: setupComplete, created_by: userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

export async function setApiKeyField(
  workspaceId: string,
  provider: KBProviderType,
  key: string,
  value: string,
  userId: string,
): Promise<Record<string, string>> {
  const existing = await getApiKey(workspaceId, provider);
  const config = existing ? JSON.parse(existing.config_json) : {};
  config[key] = value;

  await setApiKey(workspaceId, provider, config, userId);
  return config;
}

export async function removeApiKeyField(
  workspaceId: string,
  provider: KBProviderType,
  key: string,
  userId: string,
): Promise<Record<string, string>> {
  const existing = await getApiKey(workspaceId, provider);
  if (!existing) throw new Error(`No API key configured for ${provider}`);
  const config = JSON.parse(existing.config_json);
  delete config[key];

  await setApiKey(workspaceId, provider, config, userId);
  return config;
}

export async function isProviderConfigured(workspaceId: string, provider: KBProviderType): Promise<boolean> {
  // Google Drive KB sync resolves credentials via the new connections path
  // (admin's personal Google OAuth). If any active Google Drive personal
  // connection exists in the workspace, the provider is "configured" for KB
  // purposes — regardless of whether a legacy kb_api_keys row exists.
  if (provider === 'google') {
    const { getAnyPersonalConnection } = await import('../connections');
    const conn = await getAnyPersonalConnection(workspaceId, 'google-drive');
    if (conn) return true;
  }
  const key = await getApiKey(workspaceId, provider);
  return key?.setup_complete === true;
}

export async function listApiKeys(workspaceId: string): Promise<KBApiKey[]> {
  return query<KBApiKey>('SELECT * FROM kb_api_keys WHERE workspace_id = $1 ORDER BY provider', [workspaceId]);
}

export async function deleteApiKey(workspaceId: string, provider: KBProviderType, userId: string): Promise<void> {
  await execute('DELETE FROM kb_api_keys WHERE provider = $1 AND workspace_id = $2', [provider, workspaceId]);
  logger.info('KB API key deleted', { provider, userId });
}

// ── Source Management ──

export async function createSource(workspaceId: string, params: {
  name: string;
  sourceType: KBConnectorType;
  config: Record<string, any>;
  createdBy: string;
}): Promise<KBSource> {
  const id = uuid();
  const provider = getProviderForConnector(params.sourceType);
  const providerConfigured = await isProviderConfigured(workspaceId, provider);

  // Pull schedule controls out of the generic config blob so they land in
  // their own columns and aren't mirrored in config_json.
  const { autoSync: autoSyncIn, syncIntervalHours: intervalIn, ...restConfig } = params.config ?? {};
  const auto_sync = autoSyncIn === true || autoSyncIn === 'true';
  const sync_interval_hours =
    typeof intervalIn === 'number' && intervalIn > 0 ? Math.round(intervalIn) : 24;

  const source: KBSource = {
    id,
    workspace_id: workspaceId,
    name: params.name,
    source_type: params.sourceType,
    config_json: JSON.stringify(restConfig),
    status: providerConfigured ? 'active' : 'needs_setup',
    auto_sync,
    sync_interval_hours,
    last_sync_at: null,
    entry_count: 0,
    error_message: null,
    last_sync_warnings: null,
    created_by: params.createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await execute(
    `INSERT INTO kb_sources (id, workspace_id, name, source_type, config_json, status, auto_sync, sync_interval_hours, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [source.id, workspaceId, source.name, source.source_type, source.config_json, source.status, source.auto_sync, source.sync_interval_hours, source.created_by],
  );

  logger.info('KB source created', { sourceId: id, name: params.name, type: params.sourceType, autoSync: auto_sync, intervalHours: sync_interval_hours });
  return source;
}

export async function getSource(workspaceId: string, id: string): Promise<KBSource | null> {
  const row = await queryOne<KBSource>('SELECT * FROM kb_sources WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
  return row || null;
}

export async function listSources(workspaceId: string): Promise<KBSource[]> {
  const rows = await query<KBSource>(
    `SELECT s.*, COALESCE(e.cnt, 0)::int AS entry_count
     FROM kb_sources s
     LEFT JOIN (SELECT kb_source_id, COUNT(*) AS cnt FROM kb_entries WHERE workspace_id = $1 GROUP BY kb_source_id) e
       ON e.kb_source_id = s.id
     WHERE s.workspace_id = $1
     ORDER BY s.created_at DESC`,
    [workspaceId]
  );

  // Auto-heal: sources marked 'needs_setup' before the provider was connected
  // should flip to 'pending' (ready, never synced) as soon as the provider
  // becomes configured — otherwise the UI keeps asking users to set up
  // something that's already set up.
  const providerCheckCache = new Map<string, boolean>();
  for (const row of rows) {
    if (row.status !== 'needs_setup') continue;
    const provider = getProviderForConnector(row.source_type);
    let configured = providerCheckCache.get(provider);
    if (configured === undefined) {
      configured = await isProviderConfigured(workspaceId, provider);
      providerCheckCache.set(provider, configured);
    }
    if (configured) {
      row.status = 'active';
      await execute(
        "UPDATE kb_sources SET status = 'active', updated_at = NOW() WHERE id = $1 AND workspace_id = $2 AND status = 'needs_setup'",
        [row.id, workspaceId]
      );
    }
  }
  return rows;
}

export async function updateSource(workspaceId: string, id: string, updates: Partial<Pick<KBSource, 'name' | 'config_json' | 'status' | 'auto_sync' | 'sync_interval_hours' | 'error_message' | 'entry_count' | 'last_sync_at' | 'last_sync_warnings'>>): Promise<void> {
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
  vals.push(id, workspaceId);
  await execute(`UPDATE kb_sources SET ${sets.join(', ')} WHERE id = $${idx} AND workspace_id = $${idx + 1}`, vals);
}

export async function deleteSource(workspaceId: string, id: string, userId: string): Promise<void> {
  // Remove linked KB entries + skip log. The FK on kb_source_skip_log also
  // cascades, but being explicit keeps behavior consistent across DB setups
  // where the FK may not have been created (older self-hosted installs that
  // skipped migration 029).
  await execute('DELETE FROM kb_chunks WHERE entry_id IN (SELECT id FROM kb_entries WHERE kb_source_id = $1 AND workspace_id = $2)', [id, workspaceId]);
  await execute('DELETE FROM kb_entries WHERE kb_source_id = $1 AND workspace_id = $2', [id, workspaceId]);
  await execute('DELETE FROM kb_source_skip_log WHERE kb_source_id = $1 AND workspace_id = $2', [id, workspaceId]);
  await execute('DELETE FROM kb_sources WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
  logger.info('KB source deleted', { sourceId: id, userId });
}

export async function toggleAutoSync(workspaceId: string, id: string, enabled: boolean): Promise<void> {
  await execute('UPDATE kb_sources SET auto_sync = $1, updated_at = NOW() WHERE id = $2 AND workspace_id = $3', [enabled, id, workspaceId]);
  logger.info('KB source auto-sync toggled', { sourceId: id, enabled });
}

export async function updateSourceStatus(workspaceId: string, id: string, status: KBSourceStatus, errorMessage?: string): Promise<void> {
  await execute(
    'UPDATE kb_sources SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3 AND workspace_id = $4',
    [status, errorMessage || null, id, workspaceId],
  );
}

// ── Sync Operations ──

export async function startSync(workspaceId: string, sourceId: string): Promise<void> {
  const source = await getSource(workspaceId, sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found`);

  const provider = getProviderForConnector(source.source_type);
  const providerConfigured = await isProviderConfigured(workspaceId, provider);
  if (!providerConfigured) {
    throw new Error(`Provider ${provider} is not configured. Set up API keys first.`);
  }

  // Run sync in the background — don't block the caller
  syncSource(workspaceId, source).catch(err => {
    logger.error('Background sync failed', { sourceId, error: err.message });
  });
}

export async function flushAndResync(workspaceId: string, sourceId: string, userId: string): Promise<void> {
  const source = await getSource(workspaceId, sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found`);

  // Remove all entries from this source
  await execute('DELETE FROM kb_chunks WHERE entry_id IN (SELECT id FROM kb_entries WHERE kb_source_id = $1 AND workspace_id = $2)', [sourceId, workspaceId]);
  await execute('DELETE FROM kb_entries WHERE kb_source_id = $1 AND workspace_id = $2', [sourceId, workspaceId]);
  await updateSource(workspaceId, sourceId, { entry_count: 0 });

  logger.info('KB source flushed', { sourceId, userId });

  // Start fresh sync
  await startSync(workspaceId, sourceId);
}

// ── Sources Needing Auto-Sync (CROSS-WORKSPACE) ──

export async function getSourcesDueForSync(): Promise<KBSource[]> {
  return query<KBSource>(`
    SELECT * FROM kb_sources
    WHERE auto_sync = TRUE
      AND status IN ('active', 'error')
      AND (last_sync_at IS NULL OR last_sync_at < NOW() - (sync_interval_hours || ' hours')::INTERVAL)
    ORDER BY last_sync_at ASC NULLS FIRST
  `);
}

// Rows stuck in 'syncing' for longer than this window are treated as orphaned
// (the process that started them almost certainly died) and reset to 'error'
// so the next auto-sync tick picks them up.
const STUCK_SYNC_THRESHOLD_MINUTES = 30;

export async function resetStuckSyncingSources(): Promise<number> {
  const rows = await query<{ id: string; workspace_id: string; name: string }>(
    `UPDATE kb_sources
        SET status = 'error',
            error_message = 'Sync was interrupted (process restart). Will retry on next auto-sync.',
            updated_at = NOW()
      WHERE status = 'syncing'
        AND updated_at < NOW() - ($1 || ' minutes')::INTERVAL
      RETURNING id, workspace_id, name`,
    [String(STUCK_SYNC_THRESHOLD_MINUTES)],
  );
  if (rows.length > 0) {
    logger.warn('KB sources reset from stuck syncing state', {
      count: rows.length,
      sources: rows.map(r => ({ id: r.id, workspaceId: r.workspace_id, name: r.name })),
    });
  }
  return rows.length;
}
