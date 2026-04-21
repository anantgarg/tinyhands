/**
 * Outbound Slack notifications for wiki ingest events.
 *
 * No new slash commands. Just post a short summary to the workspace's
 * configured KB or Documents channel (workspace_settings keys
 * `kb.notify_channel` / `docs.notify_channel`). When unconfigured we
 * fall back to the platform's default tinyhands channel.
 */
import { queryOne } from '../../db';
import { logger } from '../../utils/logger';
import { postMessage } from '../../slack';
import type { WikiNamespace } from '../../types';

const FALLBACK_CHANNEL = process.env.TINYHANDS_CHANNEL_ID || 'tinyhands';

export interface IngestNotice {
  workspaceId: string;
  namespace: WikiNamespace;
  pagesTouched: string[];
  parser: string;
  sourceLabel?: string;
  jobId: string;
}

export async function notifyIngestSuccess(notice: IngestNotice): Promise<void> {
  if (notice.pagesTouched.length === 0) return;
  const channel = await getNotifyChannel(notice.workspaceId, notice.namespace);
  const surface = notice.namespace === 'kb' ? 'KB' : 'Documents';
  const text = `:books: ${surface} wiki updated — ${notice.pagesTouched.length} page${notice.pagesTouched.length === 1 ? '' : 's'} touched (parser: ${notice.parser})${notice.sourceLabel ? ` for *${notice.sourceLabel}*` : ''}.`;
  try {
    await postMessage(channel, text);
  } catch (err: any) {
    logger.warn('Wiki notify failed', { workspaceId: notice.workspaceId, channel, error: err.message });
  }
}

export async function notifyIngestFailure(notice: { workspaceId: string; namespace: WikiNamespace; jobId: string; error: string; sourceLabel?: string }): Promise<void> {
  const channel = await getNotifyChannel(notice.workspaceId, notice.namespace);
  const surface = notice.namespace === 'kb' ? 'KB' : 'Documents';
  const text = `:warning: ${surface} wiki ingest failed${notice.sourceLabel ? ` for *${notice.sourceLabel}*` : ''}: ${notice.error.slice(0, 200)}\nRetry from the dashboard (job \`${notice.jobId}\`).`;
  try {
    await postMessage(channel, text);
  } catch (err: any) {
    logger.warn('Wiki notify (failure) failed', { workspaceId: notice.workspaceId, channel, error: err.message });
  }
}

async function getNotifyChannel(workspaceId: string, namespace: WikiNamespace): Promise<string> {
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2`,
    [workspaceId, `${namespace}.notify_channel`],
  );
  return row?.value || FALLBACK_CHANNEL;
}
