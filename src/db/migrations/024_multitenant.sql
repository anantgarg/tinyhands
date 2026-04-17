-- ── Migration 024: Multi-Tenant Users, Memberships, Platform Admins ──
-- Adds cross-workspace user identity + per-workspace membership + platform-admin concepts.
-- Backfills from existing platform_roles per documented role mapping:
--   superadmin → workspace_memberships(admin) + platform_admins row
--   admin      → workspace_memberships(admin)
--   member     → workspace_memberships(member)
-- The existing platform_roles table is retained read-only for one release.

-- ── Users (global identity, keyed by Slack user_id within a workspace) ──

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                          -- synthetic UUID-like id
  slack_user_id TEXT NOT NULL,                  -- user id as returned by Slack
  home_workspace_id TEXT REFERENCES workspaces(id),
  display_name TEXT,
  email TEXT,
  avatar_url TEXT,
  active_workspace_id TEXT REFERENCES workspaces(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slack_user_id, home_workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_users_slack_id ON users(slack_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── Workspace Memberships ──
-- Replaces platform_roles conceptually. Roles: admin | member (no superadmin).

CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ws_memberships_user ON workspace_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_ws_memberships_ws ON workspace_memberships(workspace_id);

-- ── Platform Admins ──
-- Operators of the hosted TinyHands deployment. No cross-workspace data access
-- beyond health aggregates; just an ops stub.

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Workspace slug (URL-safe, for webhook routing) ──

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS workspace_slug TEXT;

-- Backfill slug: slugify team_name, fallback to lowercased id
UPDATE workspaces
SET workspace_slug = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(COALESCE(team_name, id), '[^A-Za-z0-9]+', '-', 'g'),
    '(^-+|-+$)', '', 'g'
  )
)
WHERE workspace_slug IS NULL;

-- Ensure uniqueness: if two workspaces slugify to the same, suffix with short id
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
  collision INT;
BEGIN
  FOR r IN SELECT id, workspace_slug FROM workspaces LOOP
    candidate := r.workspace_slug;
    SELECT COUNT(*) INTO collision FROM workspaces WHERE workspace_slug = candidate AND id <> r.id;
    IF collision > 0 THEN
      candidate := candidate || '-' || SUBSTR(r.id, 1, 6);
      UPDATE workspaces SET workspace_slug = candidate WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_slug ON workspaces(workspace_slug);

-- ── Backfill users + memberships + platform_admins from platform_roles ──

DO $$
DECLARE
  r RECORD;
  uid TEXT;
BEGIN
  -- Create users rows for every (workspace_id, user_id) in platform_roles if they don't exist.
  FOR r IN SELECT DISTINCT workspace_id, user_id FROM platform_roles LOOP
    -- synthesize deterministic id from slack_user_id + home_workspace_id
    uid := r.workspace_id || ':' || r.user_id;
    INSERT INTO users (id, slack_user_id, home_workspace_id, active_workspace_id)
    VALUES (uid, r.user_id, r.workspace_id, r.workspace_id)
    ON CONFLICT (slack_user_id, home_workspace_id) DO NOTHING;
  END LOOP;

  -- workspace_memberships
  FOR r IN SELECT workspace_id, user_id, role FROM platform_roles LOOP
    uid := r.workspace_id || ':' || r.user_id;
    INSERT INTO workspace_memberships (workspace_id, user_id, role)
    VALUES (
      r.workspace_id,
      uid,
      CASE WHEN r.role = 'member' THEN 'member' ELSE 'admin' END
    )
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET
      role = EXCLUDED.role,
      updated_at = NOW();
  END LOOP;

  -- platform_admins (only for superadmin role)
  FOR r IN SELECT workspace_id, user_id FROM platform_roles WHERE role = 'superadmin' LOOP
    uid := r.workspace_id || ':' || r.user_id;
    INSERT INTO platform_admins (user_id)
    VALUES (uid)
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
END $$;

-- ── Per-workspace Anthropic API key storage ──
-- Stored as encrypted value in workspace_settings with key 'anthropic_api_key'.
-- The IV (initialization vector) is stored as key 'anthropic_api_key_iv'.
-- No schema change needed — uses existing workspace_settings table.

-- ── Webhook URL helper: unique agent_slug per workspace ──
-- Agents already have unique names per workspace; we use a trigram-safe slug index.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_slug TEXT;

UPDATE agents
SET agent_slug = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(name, '[^A-Za-z0-9]+', '-', 'g'),
    '(^-+|-+$)', '', 'g'
  )
)
WHERE agent_slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_ws_slug ON agents(workspace_id, agent_slug);
