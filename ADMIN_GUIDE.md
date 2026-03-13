# TinyHands Admin Guide

This guide covers setup, configuration, and ongoing management of TinyHands for workspace administrators (superadmins).

---

## Initial Setup

### Becoming the First Superadmin

The first person to run any slash command in the TinyHands bot DM automatically becomes the superadmin. From there you can add additional superadmins.

### Adding More Superadmins

DM the TinyHands bot and type:

```
add @username as superadmin
```

Only existing superadmins can add new ones. There must always be at least one superadmin.

---

## Integration & Tool Management

DM the TinyHands bot and type `/tools` to open the integration dashboard. This is superadmin-only.

### Registering an Integration

1. Open `/tools` in the bot DM
2. Under **Available Integrations**, click **Register** next to the integration you want
3. Fill in the required credentials in the modal (API keys, tokens, etc.)
4. Submit — the integration's tools are now available to agents

### Supported Integrations

| Integration | Required Config | Tools Provided |
|-------------|----------------|----------------|
| **Zendesk** | Subdomain, email, API token | Search/create tickets, add comments, update tags/priority/assignee |
| **Linear** | API key | Search/create issues, manage projects/cycles, update status |
| **PostHog** | API key, team ID, personal API key | Query events, feature flags, user analytics (read-only) |
| **HubSpot** | API key | Search/manage contacts, deals, companies |
| **SerpAPI** | API key | Track search rankings across Google, Bing, Yahoo (read-only) |
| **Chargebee** | API key, site name | List customers, subscriptions, invoices, plans (read-only) |

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
- **Visibility**: public or private
- **Channel**: existing channel or create a new one
- **Members**: (for private agents) select who can access it

### Agent Configuration

Each agent has these settings (viewable via `/agents` → overflow → View Config):

| Setting | Options |
|---------|---------|
| **Status** | active, paused, archived |
| **Model** | haiku, sonnet, opus |
| **Effort level** | Low (1-2 turns), Medium (10-25), High (50), Max (100+) |
| **Memory** | Enabled or disabled |
| **Visibility** | Public (org-wide) or Private (members only) |
| **Response mode** | All messages or mentions only |
| **Tools** | Built-in + custom integrations |
| **System prompt** | Auto-generated or custom |

### Updating Agents

DM the bot and type `/update-agent`, then select the agent to update. You can modify the system prompt, tools, model, effort, channels, visibility, and members via conversation.

### Pausing and Deleting

From `/agents`, use the overflow menu to pause (stop responding), resume, or delete agents.

---

## Private Agents & Access Control

### Private Agent Visibility

Private agents are invisible to non-members. They:
- Only appear in `/agents` for members and superadmins
- Silently ignore messages from non-members in shared channels
- Are accessible via DM only to members

### Member Management

From `/agents`, click the overflow menu on a private agent → **Members** to open the member picker and add users.

To remove members, type `remove member @user` in the agent's channel.

### Agent Roles

| Role | Permissions |
|------|-------------|
| **Owner** | Full control — modify agent, manage members, delete |
| **Admin** | Modify agent, manage members |
| **Member** | Send messages to the agent only |

The agent creator automatically becomes the owner.

---

## Triggers

Triggers are configured during agent creation based on the "When should it run?" description. Types include:

- **Channel messages** — agent responds when messages appear in its channel
- **Scheduled** — agent runs on a cron schedule (e.g., "Every Monday at 9am")
- **External events** — agent triggers on webhooks from Linear, Zendesk, etc.

Triggers can be paused and resumed from `/agents`.

---

## Admin Notifications

Superadmins receive notifications when:
- An agent requests a read-write tool that needs approval
- An agent needs a tool that doesn't exist yet (feature request)

These notifications include the agent name, requested tool, and the user who created the agent, with options to approve or configure.

---

## Quick Reference

| Command | Where | Who | What it does |
|---------|-------|-----|--------------|
| `/agents` | Bot DM | All users | View and manage agents |
| `/update-agent` | Bot DM | Agent owners/admins | Update an agent via conversation |
| `/tools` | Bot DM | Superadmins | Manage integrations and tools |
| `/kb` | Bot DM | Superadmins | KB dashboard (sources, entries, API keys) |
| `/kb search <query>` | Bot DM | All users | Search the knowledge base |
| `/kb add` | Bot DM | All users | Submit a KB entry (pending approval if non-admin) |
| `add @user as superadmin` | Bot DM | Superadmins | Grant superadmin access |

---

## Tips

- Set up integrations (`/tools`) and knowledge sources (`/kb`) before creating agents — agents auto-select tools based on their goal.
- Use read-only access levels for integrations unless agents genuinely need write access.
- Enable auto-sync on knowledge sources to keep agent context up to date.
- Use private agents for team-specific workflows (e.g., engineering-only, sales-only).
- Start with medium effort level — increase to high or max only for agents doing deep research.
