-- Platform roles (replaces superadmins)
CREATE TABLE IF NOT EXISTS platform_roles (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  granted_by TEXT NOT NULL DEFAULT 'system',
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_roles_user ON platform_roles(user_id);

-- Agent roles (replaces agent_admins + agent_members)
CREATE TABLE IF NOT EXISTS agent_roles (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  PRIMARY KEY (agent_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_roles_user ON agent_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_roles_ws ON agent_roles(workspace_id);

-- Agent default_access + write_policy columns
ALTER TABLE agents ADD COLUMN IF NOT EXISTS default_access TEXT NOT NULL DEFAULT 'viewer';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS write_policy TEXT NOT NULL DEFAULT 'auto';

-- Workspace settings
CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, key)
);

-- Data migration: superadmins -> platform_roles
INSERT INTO platform_roles (workspace_id, user_id, role, granted_by, granted_at)
SELECT workspace_id, user_id, 'superadmin', granted_by, granted_at
FROM superadmins WHERE workspace_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Data migration: agent_admins -> agent_roles
INSERT INTO agent_roles (agent_id, user_id, role, granted_by, granted_at, workspace_id)
SELECT aa.agent_id, aa.user_id, aa.role, aa.granted_by, aa.granted_at,
       COALESCE(aa.workspace_id, a.workspace_id)
FROM agent_admins aa JOIN agents a ON a.id = aa.agent_id
WHERE COALESCE(aa.workspace_id, a.workspace_id) IS NOT NULL
ON CONFLICT DO NOTHING;

-- Data migration: agent_members -> agent_roles (as 'member')
INSERT INTO agent_roles (agent_id, user_id, role, granted_by, granted_at, workspace_id)
SELECT am.agent_id, am.user_id, 'member', am.added_by, am.added_at,
       COALESCE(am.workspace_id, a.workspace_id)
FROM agent_members am JOIN agents a ON a.id = am.agent_id
WHERE COALESCE(am.workspace_id, a.workspace_id) IS NOT NULL
ON CONFLICT (agent_id, user_id) DO NOTHING;

-- Data migration: creators -> agent_roles as 'owner'
INSERT INTO agent_roles (agent_id, user_id, role, granted_by, granted_at, workspace_id)
SELECT id, created_by, 'owner', created_by, created_at, workspace_id
FROM agents WHERE workspace_id IS NOT NULL
ON CONFLICT (agent_id, user_id) DO UPDATE SET role = 'owner';

-- Data migration: visibility -> default_access
UPDATE agents SET default_access = CASE
  WHEN visibility = 'private' THEN 'none'
  ELSE 'viewer'
END;

-- Default workspace setting
INSERT INTO workspace_settings (workspace_id, key, value)
SELECT id, 'members_can_create_agents', 'true' FROM workspaces
ON CONFLICT DO NOTHING;
