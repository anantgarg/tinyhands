process.env.PROCESS_TYPE = 'listener';
import { createSlackApp } from './slack';
import { startWebhookServer } from './server';
import { initDb, upsertWorkspace, setDefaultWorkspaceId, execute } from './db';
import { config } from './config';
import { logger } from './utils/logger';
import { startWatchdog } from './utils/watchdog';
import { ensureBotInAllAgentChannels } from './modules/agents';

async function main(): Promise<void> {
  logger.info('Starting TinyHands...');

  // Initialize database
  await initDb();
  logger.info('Database initialized');

  // Start Slack app (Socket Mode)
  const app = createSlackApp();
  await app.start();
  logger.info('Slack app started (Socket Mode)');

  // Bootstrap workspace from bot token
  const authResult = await app.client.auth.test();
  await upsertWorkspace({
    id: authResult.team_id as string,
    team_name: (authResult.team as string) || 'default',
    bot_token: config.slack.botToken,
    bot_user_id: authResult.user_id as string,
    bot_id: authResult.bot_id as string,
  });
  setDefaultWorkspaceId(authResult.team_id as string);
  logger.info('Workspace bootstrapped', { workspaceId: authResult.team_id });

  // Backfill workspace_id for any existing data that predates multi-tenancy
  try {
    const tables = [
      'agents', 'agent_versions', 'run_history', 'sources', 'source_chunks',
      'agent_memory', 'triggers', 'skills', 'agent_skills', 'kb_entries',
      'kb_chunks', 'custom_tools', 'evolution_proposals', 'authored_skills',
      'mcp_configs', 'code_artifacts', 'tool_versions', 'tool_runs',
      'workflow_definitions', 'workflow_runs', 'side_effects_log',
      'superadmins', 'agent_admins', 'team_runs', 'sub_agent_runs',
      'agent_members', 'dm_conversations', 'pending_confirmations',
      'kb_sources', 'kb_api_keys',
    ];
    for (const table of tables) {
      try {
        await execute(
          `UPDATE ${table} SET workspace_id = $1 WHERE workspace_id IS NULL`,
          [authResult.team_id as string],
        );
      } catch { /* table may not exist */ }
    }
  } catch (err: any) {
    logger.warn('Workspace backfill failed', { error: err.message });
  }

  // Re-encrypt any credentials left by the backfill migration (016)
  import('./modules/connections').then(({ reEncryptMigratedCredentials }) =>
    reEncryptMigratedCredentials()
  ).catch(err =>
    logger.warn('Credential re-encryption failed', { error: err.message })
  );

  // Ensure bot is a member of all agent channels (for receiving events)
  ensureBotInAllAgentChannels().catch(err =>
    logger.warn('Auto-join agent channels failed', { error: err.message })
  );

  // Register built-in tools (KB, etc.)
  try {
    const { getIntegration } = await import('./modules/tools/integrations');
    const kb = getIntegration('kb');
    if (kb) await kb.register(authResult.team_id as string, 'system', {});
  } catch (err: any) {
    logger.warn('KB tool registration failed', { error: err.message });
  }

  // Start webhook server (Express)
  startWebhookServer();

  // Start event loop watchdog — restarts process if main thread is blocked for >60s
  startWatchdog();

  logger.info('TinyHands listener ready');
}

main().catch(err => {
  logger.error('Failed to start TinyHands', { error: err.message });
  process.exit(1);
});
