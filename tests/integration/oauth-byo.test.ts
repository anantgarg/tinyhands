import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

// Exercises the BYO Google OAuth app flow end-to-end: the credential store
// writes per-workspace rows, the OAuth URL resolver reads them, and two
// workspaces stay isolated from one another.

let container: StartedTestContainer;
let pool: Pool;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS workspace_oauth_apps (
    workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret_encrypted TEXT NOT NULL,
    client_secret_iv TEXT NOT NULL,
    publishing_status TEXT,
    configured_by_user_id TEXT,
    configured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, provider)
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    redirect_channel_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
  );
`;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'test',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const url = `postgresql://test:test@${host}:${port}/test`;

  pool = new Pool({ connectionString: url });
  await pool.query(SCHEMA);

  // Point our db module at this container BEFORE we import anything that uses
  // the pool. We lazily configure via env var — the db module reads
  // DATABASE_URL on first call.
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY = 'test-encryption-key-aaaaaaaaaaaaaaaaaaaaaa';
  process.env.OAUTH_REDIRECT_BASE_URL = 'http://localhost:3000';
}, 60000);

afterAll(async () => {
  await pool.end();
  await container.stop();
});

describe('BYO OAuth app end-to-end', () => {
  it('writes workspace creds, resolves them into OAuth URLs, isolates between workspaces', async () => {
    // Dynamic imports so env vars land before the db module initializes.
    const { initDb } = await import('../../src/db');
    await initDb();

    const {
      setOAuthAppCredentials,
      hasOAuthAppConfigured,
      getOAuthAppCredentials,
    } = await import('../../src/modules/workspace-oauth-apps');
    const { getOAuthUrl, OAuthAppNotConfiguredError } = await import('../../src/modules/connections/oauth');

    const W1 = 'workspace-1';
    const W2 = 'workspace-2';

    // Workspace 1 has no creds yet — URL generation should throw.
    await expect(getOAuthUrl('google_drive', W1, 'U1')).rejects.toBeInstanceOf(OAuthAppNotConfiguredError);
    expect(await hasOAuthAppConfigured(W1, 'google')).toBe(false);

    // Configure W1 with its own Google OAuth app.
    await setOAuthAppCredentials(W1, 'google', {
      clientId: '111-w1client.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-workspace-one-secret-val',
      publishingStatus: 'internal',
      userId: 'U1',
    });
    expect(await hasOAuthAppConfigured(W1, 'google')).toBe(true);

    // Configure W2 with a different Google OAuth app.
    await setOAuthAppCredentials(W2, 'google', {
      clientId: '222-w2client.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-workspace-two-secret-val',
      publishingStatus: 'internal',
      userId: 'U2',
    });

    // Each workspace's OAuth URL includes its own client ID, never the other's.
    const { url: url1 } = await getOAuthUrl('google_drive', W1, 'U1');
    const { url: url2 } = await getOAuthUrl('google_drive', W2, 'U2');

    expect(url1).toContain('client_id=111-w1client.apps.googleusercontent.com');
    expect(url1).not.toContain('222-w2client');
    expect(url2).toContain('client_id=222-w2client.apps.googleusercontent.com');
    expect(url2).not.toContain('111-w1client');

    // Credentials round-trip cleanly through encryption.
    const creds1 = await getOAuthAppCredentials(W1, 'google');
    expect(creds1).toEqual({
      clientId: '111-w1client.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-workspace-one-secret-val',
    });

    // Replacing creds for W1 updates the row and propagates into fresh OAuth URLs.
    await setOAuthAppCredentials(W1, 'google', {
      clientId: '333-w1replaced.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-workspace-one-replaced-1',
      publishingStatus: 'external_testing',
      userId: 'U1',
    });
    const { url: url1b } = await getOAuthUrl('google_drive', W1, 'U1');
    expect(url1b).toContain('client_id=333-w1replaced.apps.googleusercontent.com');
  }, 30000);
});
