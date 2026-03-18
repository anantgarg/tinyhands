import { query, queryOne, execute } from '../../db';
import type { WorkspaceSetting } from '../../types';

export async function getSetting(workspaceId: string, key: string): Promise<string | null> {
  const row = await queryOne<WorkspaceSetting>(
    'SELECT * FROM workspace_settings WHERE workspace_id = $1 AND key = $2',
    [workspaceId, key]
  );
  return row?.value ?? null;
}

export async function setSetting(workspaceId: string, key: string, value: string, updatedBy?: string): Promise<void> {
  await execute(
    `INSERT INTO workspace_settings (workspace_id, key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [workspaceId, key, value, updatedBy || null]
  );
}

export async function getAllSettings(workspaceId: string): Promise<WorkspaceSetting[]> {
  return query<WorkspaceSetting>(
    'SELECT * FROM workspace_settings WHERE workspace_id = $1',
    [workspaceId]
  );
}
