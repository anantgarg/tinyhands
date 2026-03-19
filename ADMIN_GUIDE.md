# TinyHands Admin Guide

This guide covers setup, configuration, and ongoing management of TinyHands for workspace administrators (superadmins).

---

## Initial Setup

### Platform Roles

TinyHands uses a three-tier platform role system:

| Role | Permissions |
|------|-------------|
| **Superadmin** | Full platform control — manage all agents, tools, KB, roles, audit log |
| **Admin** | Manage tools, KB, and agents — cannot change platform roles |
| **Member** | Create and use agents (configurable via workspace settings) |

### Becoming the First Superadmin

The first person to run any slash command in the TinyHands bot DM automatically becomes the superadmin. From there you can add additional platform admins.

### Managing Platform Roles

DM the TinyHands bot and type:

```
add @username as superadmin
```

Only existing superadmins can change platform roles. There must always be at least one superadmin.

---

## Integration & Tool Management

DM the TinyHands bot and type `/tools` to open the integration dashboard. The `/tools` command is now accessible to **all users**, showing three sections: Shared Tools, My Connections, and Available integrations. Admins see additional management options (register, configure, delete).

### Registering an Integration

1. Open `/tools` in the bot DM
2. Under **Available** integrations, click **Register** next to the integration you want (admin only)
3. Fill in the required credentials in the modal (API keys, tokens, etc.)
4. Submit — the credentials are encrypted (AES-256-GCM) and stored as a **team connection**, and the integration's tools become available to agents

Registration now automatically creates an encrypted team connection. This means credentials are never stored in plain text — they are encrypted at rest and decrypted only at execution time.

### Supported Integrations

| Integration | Required Config | Connection Model | Tools Provided |
|-------------|----------------|-----------------|----------------|
| **Zendesk** | Subdomain, email, API token | Team | Search/create tickets, add comments, update tags/priority/assignee |
| **Linear** | API key | Team | Search/create issues, manage projects/cycles, update status |
| **PostHog** | API key, team ID, personal API key | Team | Query events, feature flags, user analytics (read-only) |
| **HubSpot** | API key | Team | Search/manage contacts, deals, companies |
| **SerpAPI** | API key | Team | Track search rankings across Google, Bing, Yahoo (read-only) |
| **Chargebee** | API key, site name | Team | List customers, subscriptions, invoices, plans (read-only) |
| **Google** | OAuth | Personal/Hybrid | Drive, Sheets, Gmail access |
| **Notion** | OAuth | Personal/Hybrid | Workspace access |
| **GitHub** | OAuth | Personal/Hybrid | Repository access |

Each integration manifest declares a `connectionModel` property: `team` (shared creds only), `personal` (each user connects individually), or `hybrid` (supports both team and personal).

### Managing Tools

From the `/tools` dashboard, use the overflow menu on any tool to:

| Action | Description |
|--------|-------------|
| **Configure** | Add or update API credentials and config values |
| **Change Access Level** | Toggle between read-only and read-write |
| **Add to Agent** | Attach the tool to a specific agent |
| **Approve** | Approve tools that are pending admin approval |
| **Delete** | Remove the tool from the system |

### Tool Access Levels

- **Read-only**: Safe for any agent — cannot modify external data
- **Read-write**: Can create/update/delete external data — requires admin approval before agents can use it

### Credential Resolution

When an agent runs and needs tool credentials, the system resolves them in this order based on the tool's connection mode on that agent:

1. **Team mode** — uses the encrypted team connection registered by an admin
2. **Delegated mode** — uses the agent owner's personal connection
3. **Runtime mode** — uses the invoking user's personal connection

If the required credential is missing at execution time, the agent pauses and DMs the user with a prompt to connect. Once the user completes the connection (OAuth or API key), the agent automatically retries the action.

### Agent Tool Connection Editing

After an agent is created, admins and owners can change how each tool resolves credentials. From `/agents` → overflow menu → **View Config**, the tool connections section shows each tool's current connection mode with an **Edit** button. Clicking Edit opens a modal where you can switch between team, delegated, and runtime modes for that tool on that agent.

---

## Knowledge Base Management

DM the TinyHands bot and type `/kb` to open the knowledge base dashboard. Regular users only have access to `/kb search` and `/kb add`.

### The KB Dashboard

The superadmin dashboard shows:
- Connected knowledge sources with sync status
- Pending KB entries awaiting approval
- Recent approved entries
- Statistics (total entries, pending count, categories, sources)
- API key management

### Connecting a Knowledge Source

1. Open `/kb` in the bot DM
2. Click **Add Source**
3. Choose the source type and enter the required configuration

#### Supported Source Types

| Source | Setup Requirements | Config Options |
|--------|-------------------|----------------|
| **Google Drive** | OAuth 2.0 credentials (Client ID, Secret, Refresh Token) | Folder ID, file types (doc, pdf, sheet, etc.). Supports OCR for PDFs/images |
| **Zendesk Help Center** | Zendesk API token | Category ID (optional), locale |
| **Website / Docs (Firecrawl)** | Firecrawl API key (firecrawl.dev) | URL, max pages, include/exclude paths |
| **GitHub** | Fine-grained GitHub token | Repository (owner/repo), branch, paths, content type (docs, mintlify, source_code) |
| **HubSpot KB** | HubSpot private app access token | Portal ID, article state filter |
| **Linear Docs** | Linear API key | Team key (optional), include issues/projects flags |

### Managing Sources

From the `/kb` dashboard, use the overflow menu on any source to:

| Action | Description |
|--------|-------------|
| **Configure** | Update source-specific settings (folder ID, URL, etc.) |
| **Sync Now** | Run an immediate one-time sync |
| **Flush & Re-sync** | Delete all indexed entries and re-sync from scratch |
| **Toggle Auto-sync** | Enable/disable periodic syncing (24-hour intervals) |
| **Remove** | Delete the source and all its associated entries |

Source status indicators:
- Green = active
- Arrows = currently syncing
- Warning = needs setup
- Red = error

### Managing KB Entries

- Entries added by superadmins are auto-approved
- Entries added by regular users via `/kb add` are submitted for approval
- Pending entries appear in the dashboard — click to approve or delete
- Synced entries from connected sources are automatically approved

### KB Categories

Entries can be organized into: General, Engineering, Product, Support, Sales, HR, Legal, Finance, Operations.

### API Key Management

Click the **API Keys** button in the `/kb` dashboard to manage credentials for all KB providers in one place. The dashboard shows which providers are configured, incomplete, or not yet set up.

---

## Agent Management

### Creating Agents

DM the TinyHands bot, type `/agents`, and click **+ New Agent**. The guided flow asks:

1. **What should this agent do?** — Describe the goal in plain English
2. **When should it run?** — Describe the trigger (channel messages, schedule, or external events)

TinyHands auto-configures: name, avatar, system prompt, model, tools, effort level, memory, response mode, and channel.

You'll see a confirmation screen where you can adjust:
- **Model**: haiku, sonnet, or opus
- **Effort level**: low, medium, high, or max
- **Default Access**: none, viewer, or member
- **Write Policy**: auto, confirm, admin_confirm, or deny
- **Channel**: existing channel or create a new one

### Agent Configuration

Each agent has these settings (viewable via `/agents` → overflow → View Config):

| Setting | Options |
|---------|---------|
| **Status** | active, paused, archived |
| **Model** | haiku, sonnet, opus |
| **Effort level** | Low (1-2 turns), Medium (10-25), High (50), Max (100+) |
| **Memory** | Enabled or disabled |
| **Default Access** | None (hidden), Viewer (read-only), Member (full) |
| **Write Policy** | Auto, Confirm, Admin Confirm, Deny |
| **Response mode** | All messages or mentions only |
| **Tools** | Built-in + custom integrations |
| **System prompt** | Auto-generated or custom |

### Updating Agents

DM the bot and type `/update-agent`, then select the agent to update. You can modify the system prompt, tools, model, effort, channels, visibility, and members via conversation.

### Pausing and Deleting

From `/agents`, use the overflow menu to pause (stop responding), resume, or delete agents.

---

## Agent Access Control

### Agent Access Levels

Each agent has a **default access level** that determines what unenrolled users can do:

| Default Access | Behavior for users without explicit role |
|---------------|------------------------------------------|
| **None** | Agent is hidden — only explicitly granted users can see/use it |
| **Viewer** | Can see the agent, but write actions trigger upgrade requests |
| **Member** | Can fully interact with the agent |

Individual users can be granted specific roles that override the default:

| Role | Permissions |
|------|-------------|
| **Owner** | Full control — modify agent, manage roles, delete, approve upgrades |
| **Member** | Full interaction — read and write tool actions |
| **Viewer** | Read-only — write actions trigger an automatic upgrade request |

The agent creator automatically becomes the owner. Platform admins (superadmin/admin) have owner-level access to all agents.

### Write Policies

Each agent has a **write policy** controlling how write tool actions are handled at runtime:

| Policy | Behavior |
|--------|----------|
| **Auto** | Write actions execute immediately for members |
| **Confirm** | Agent pauses and DMs the requesting user with action details and Approve/Deny buttons |
| **Admin Confirm** | Agent pauses and DMs the agent owner with action details and Approve/Deny buttons |
| **Deny** | Write actions are blocked — the agent receives an error and cannot perform writes |

Approval gates are enforced at runtime via Redis-backed state. When an approval request is created, the agent's execution is suspended until the approver responds. If approved, execution resumes and the write action completes. If denied, the requesting user receives a DM notification explaining which action was blocked.

Approval requests expire after a configurable timeout. Expired requests are treated as denied.

### Auto-Upgrade Requests

When a viewer attempts a write action on an agent (and write_policy is not "deny"):
1. The system creates an upgrade request
2. All agent owners are notified via DM
3. The viewer is told their request has been sent
4. If approved, the viewer gets member access and is notified to re-run their request
5. If denied, no notification is sent

### Managing Agent Roles

From `/agents`, click the overflow menu on an agent → **Members** to manage roles. You can grant owner, member, or viewer access to specific users.

---

## Tool Connections

### Connection Modes

Each tool on an agent can be configured with a connection mode:

| Mode | Description |
|------|-------------|
| **Team** | Single shared credential for the whole workspace |
| **Delegated** | Owner's personal credential shared through the agent |
| **Runtime** | Each user brings their own credential (prompted to `/connect` if missing) |

### Personal Connections

Users connect their personal accounts via `/tools` or `/connect`:
1. Run `/tools` in a bot DM — the **Available** section shows integrations that support personal connections
2. Click **Connect** next to the desired service
3. Complete the OAuth flow in the browser, or enter an API key in the modal
4. Credentials are encrypted with AES-256-GCM and stored securely

Users can also run `/connect` as a shortcut for the same flow.

Connected services appear in the **My Connections** section of `/tools`, where users can disconnect at any time.

Supported personal connection types:
- **Google** — Drive, Sheets, Gmail (OAuth)
- **Notion** — Workspace access (OAuth)
- **GitHub** — Personal repository access (OAuth)
- **API key integrations** — Any integration with `connectionModel: "personal"` or `"hybrid"` that accepts API keys

### Setting Up OAuth (Admin)

To enable personal connections, configure these environment variables:

```env
# Generate with: openssl rand -base64 32
ENCRYPTION_KEY=<at least 32 characters>

# From Google Cloud Console → APIs & Services → Credentials → OAuth 2.0
GOOGLE_OAUTH_CLIENT_ID=<your-client-id>
GOOGLE_OAUTH_CLIENT_SECRET=<your-client-secret>

# From notion.so/my-integrations → Create integration → OAuth
NOTION_OAUTH_CLIENT_ID=<your-client-id>
NOTION_OAUTH_CLIENT_SECRET=<your-client-secret>

# From github.com/settings/developers → OAuth Apps → New
GITHUB_OAUTH_CLIENT_ID=<your-client-id>
GITHUB_OAUTH_CLIENT_SECRET=<your-client-secret>

# Your server's public URL (for OAuth callbacks)
OAUTH_REDIRECT_BASE_URL=https://your-domain.com
```

OAuth callbacks are handled at `GET /auth/callback/:integration` on the Express server.

### SSL / Nginx Setup for OAuth

OAuth providers (Google, GitHub, Notion) require HTTPS callback URLs. TinyHands ships with an Nginx reverse proxy and automatic Let's Encrypt SSL certificates for Docker Compose deployments.

#### Required Environment Variables

Add these to your `.env` file:

```env
# Your server's public domain (e.g., tinyhands.example.com)
OAUTH_DOMAIN=your-domain.com

# Email for Let's Encrypt certificate notifications
LETSENCRYPT_EMAIL=you@example.com

# Set your OAuth callback URL to use HTTPS
OAUTH_REDIRECT_BASE_URL=https://your-domain.com
```

#### Initial SSL Setup

Before starting for the first time (or after setting `OAUTH_DOMAIN`), run the bootstrap script to obtain SSL certificates:

```bash
./deploy/init-letsencrypt.sh
```

This script:
1. Creates a temporary self-signed certificate so Nginx can start
2. Starts the Nginx container
3. Requests a real certificate from Let's Encrypt using certbot
4. Reloads Nginx with the valid certificate

You can also pass the domain and email as arguments:

```bash
./deploy/init-letsencrypt.sh tinyhands.example.com you@example.com
```

#### How It Works

The Docker Compose setup includes:

- **Nginx** (`nginx:alpine`) — listens on ports 80 and 443, redirects HTTP to HTTPS, proxies HTTPS traffic to the TinyHands app on port 3000
- **Certbot** (`certbot/certbot`) — automatically renews certificates every 12 hours

The Nginx configuration template at `nginx/default.conf.template` uses the `OAUTH_DOMAIN` environment variable for `server_name` and SSL certificate paths. The `nginx:alpine` image automatically substitutes environment variables in template files.

#### DNS Requirements

Before running the SSL setup, ensure your domain's DNS A record points to your server's public IP address. Let's Encrypt validates domain ownership via HTTP, so the domain must resolve to your server.

#### Certificate Renewal

Certificates are renewed automatically by the certbot service. No manual intervention is required. Certbot checks for renewal every 12 hours and renews certificates that are within 30 days of expiration.

---

## Triggers

Triggers are configured during agent creation based on the "When should it run?" description. Types include:

- **Channel messages** — agent responds when messages appear in its channel
- **Scheduled** — agent runs on a cron schedule (e.g., "Every Monday at 9am")
- **External events** — agent triggers on webhooks from Linear, Zendesk, etc.

Triggers can be paused and resumed from `/agents`.

---

## Audit Log

Platform admins can view a comprehensive audit trail of all actions via `/audit`. The audit log tracks:

- Role changes (platform and agent level)
- Agent creation, updates, and deletion
- Tool invocations with user context
- Connection creation and deletion
- Upgrade request approvals and denials

The audit log has forever retention and is indexed by workspace, agent, user, and timestamp.

### Viewing the Audit Log

1. Run `/audit` in a bot DM (platform admin only)
2. Filter by agent, user, action type, or date range
3. Results show actor, action, target, and timestamp

---

## Admin Notifications

Platform admins receive notifications when:
- A viewer requests an upgrade to member access
- An agent needs a tool that doesn't exist yet (feature request)

Agent owners receive notifications when:
- A viewer on their agent requests a member upgrade (with approve/deny buttons)

These notifications include the agent name, requesting user, and context, with options to approve or configure.

---

## Quick Reference

| Command | Where | Who | What it does |
|---------|-------|-----|--------------|
| `/agents` | Bot DM | All users | View and manage agents |
| `/update-agent` | Bot DM | Agent owners/admins | Update an agent via conversation |
| `/tools` | Bot DM | All users (admin actions restricted) | Browse tools, manage personal connections, register integrations (admin) |
| `/kb` | Bot DM | Platform admins | KB dashboard (sources, entries, API keys) |
| `/kb search <query>` | Bot DM | All users | Search the knowledge base |
| `/kb add` | Bot DM | All users | Submit a KB entry (pending approval if non-admin) |
| `/connect` | Bot DM | All users | Manage personal tool connections |
| `/audit` | Bot DM | Platform admins | View action audit log |
| `add @user as superadmin` | Bot DM | Superadmins | Grant superadmin access |

---

## Tips

- Set up integrations (`/tools`) and knowledge sources (`/kb`) before creating agents — agents auto-select tools based on their goal.
- Use read-only access levels for integrations unless agents genuinely need write access.
- Enable auto-sync on knowledge sources to keep agent context up to date.
- Use default access "none" for team-specific agents (e.g., engineering-only, sales-only).
- Set write policy to "admin_confirm" for agents that modify external systems.
- Use "runtime" connection mode for tools that should use each user's own credentials.
- Start with medium effort level — increase to high or max only for agents doing deep research.
