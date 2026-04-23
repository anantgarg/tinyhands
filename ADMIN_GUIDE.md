# TinyHands Admin Guide

This guide covers setup, configuration, and ongoing management of TinyHands for workspace administrators.

---

## Multi-Tenant Overview

A single TinyHands deployment hosts many Slack workspaces. TinyHands (the operator running this deployment) owns the Slack app, database, Redis, and hosting. Each workspace admin owns their workspace's Claude API key, tool connections, agents, knowledge base, triggers, and audit log. Data never crosses workspace boundaries.

- **Sign in with Slack** — Users sign in with Slack OAuth. Users who belong to multiple Slack workspaces see a workspace switcher in the dashboard header.
- **Installing in a new Slack workspace** — Admins click "Add to Slack" (`/api/v1/auth/slack/install`) to OAuth-install the bot into their Slack workspace. This creates a new TinyHands workspace automatically; no manual database edits are required.
- **Workspace settings** — Each workspace admin sets their own Anthropic API key under **Workspace Settings → Claude API key** (with a **Test key** button that validates against Anthropic before saving).
- **Document parsing (optional)** — Workspace admins can optionally configure **Reducto** under **Workspace Settings → Document Parsing** for higher-fidelity PDF and scanned-document extraction during Knowledge Base syncs. See the [Reducto Setup](#reducto-setup-optional) section.

## Upgrading to Multi-Tenant

If you are upgrading an existing single-tenant deployment, the multi-tenant migration runs automatically on first boot after the upgrade. It is idempotent — safe to run multiple times.

What it does, for workspace 1 (your existing workspace):
1. Reads `ANTHROPIC_API_KEY` from the environment and stores it encrypted in `workspace_settings`. After this, the env var is no longer read at runtime.
2. Creates `users`, `workspace_memberships`, and `platform_admins` rows from your existing `platform_roles` table, using this role mapping:
   - `superadmin` → `workspace_memberships(role=admin)` AND a row in `platform_admins`
   - `admin` → `workspace_memberships(role=admin)`
   - `member` → `workspace_memberships(role=member)`
3. Generates a `workspace_slug` for each workspace from its team name.

The old `platform_roles` table is retained read-only for one release as a safety net and will be dropped in a follow-up migration.

**After migration you can delete `ANTHROPIC_API_KEY` from your `.env`** — it is ignored at runtime. Workspace admins manage their own keys in the dashboard.

## Initial Setup

### Workspace Roles

Each workspace has its own roles (stored in `workspace_memberships`):

| Role | Permissions |
|------|-------------|
| **Admin** | Full control over this workspace — agents, tools, KB, settings, roles |
| **Member** | View and interact with agents (cannot create agents or manage integrations) |

The person who installs TinyHands into a Slack workspace is automatically an admin of that workspace.

### Platform Admins

**Platform admins** are the operators running the TinyHands deployment. They can view per-workspace health aggregates at `/platform` (runs in the last 24 hours, error rate, whether a Claude key is configured). Platform admins cannot read any workspace's data — no impersonation, no cross-workspace search. It is an operational stub.

On upgrade, any prior `superadmin` in the legacy `platform_roles` table becomes a platform admin.

### Becoming the First Superadmin

The first person to run any slash command in the TinyHands bot DM automatically becomes the superadmin. From there you can add additional platform admins.

### Managing Platform Roles

DM the TinyHands bot and type:

```
add @username as superadmin
```

Only existing superadmins can change platform roles. There must always be at least one superadmin.

### Non-Admin Restrictions

Members (non-admin users) have the following restrictions:

- Cannot create new agents (the "New Agent" button is hidden; navigating to the create page redirects to the agents list)
- Cannot access the Tools & Integrations page (shown an "Admin Access Required" message)
- Cannot manage KB sources or API keys (only search and add entries)
- Can only edit or delete agents they own
- When the AI goal analyzer runs for a non-admin, it restricts tool suggestions to read-only tools and does not propose new tools

---

## Web Dashboard

TinyHands includes a web dashboard for managing agents, tools, connections, and knowledge base. The `/agents` Slack command provides a direct link to the dashboard.

### Dashboard URL Configuration

Set the `WEB_DASHBOARD_URL` environment variable to your dashboard's public URL. This URL is used in Slack messages that link to the dashboard. If not set, it falls back to `OAUTH_REDIRECT_BASE_URL` or `http://localhost:3000`.

```env
WEB_DASHBOARD_URL=https://dashboard.yourdomain.com
```

---

## Integration & Tool Management

Open the **Tools & Integrations** page in the web dashboard. This page is accessible to admins only. Non-admin users see an "Admin Access Required" message.

### Registering an Integration

1. Open the Tools & Integrations page
2. Under **Available** integrations, click **Connect** next to the integration you want
3. Fill in the required credentials in the dialog (API keys, tokens, etc.)
4. Submit -- the credentials are encrypted (AES-256-GCM) and stored as a **team connection**, and the integration's tools become available to agents

For OAuth integrations (Google, Notion, GitHub), clicking Connect opens a browser-based authorization flow instead of a credential dialog.

### Supported Integrations

| Integration | Required Config | Connection Model | Tools Provided |
|-------------|----------------|-----------------|----------------|
| **Zendesk** | Subdomain, email, API token | Team | Search/create tickets, add comments, update tags/priority/assignee |
| **Linear** | API key | Team | Search/create issues, manage projects/cycles, update status |
| **PostHog** | API key, team ID, personal API key | Team | Query events, feature flags, user analytics (read-only) |
| **HubSpot** | API key | Team | Search/manage contacts, deals, companies |
| **SerpAPI** | API key | Team | Track search rankings across Google, Bing, Yahoo (read-only) |
| **Chargebee** | API key, site name | Team | List customers, subscriptions, invoices, plans |
| **Google Drive** | OAuth | Personal | Search, browse, download files; create folders, move files, upload |
| **Google Sheets** | OAuth | Personal | Read sheet data; create, update, append spreadsheets |
| **Google Docs** | OAuth | Personal | Read documents; create and update documents |
| **Gmail** | OAuth | Personal | Search and read emails; send and reply to emails |
| **Notion** | OAuth | Personal | Workspace access |
| **GitHub** | OAuth | Personal | Repository access |

The four Google integrations (Drive, Sheets, Docs, Gmail) all share a single OAuth configuration. One Google OAuth connection gives access to all four services. Which services an agent can use depends on which tools are enabled for that agent.

A legacy "Google Workspace" integration exists for backward compatibility but registers no new tools. Migration 019 cleans up legacy `google-read`/`google-write` tools from existing agents.

Each integration manifest declares a `connectionModel` property: `team` (shared creds only), `personal` (each user connects individually), or `hybrid` (supports both team and personal).

### Managing Tools

From the Tools & Integrations page, connected integrations show:

| Action | Description |
|--------|-------------|
| **Edit** | Update API credentials and config values (for team-credential integrations) |
| **Disconnect** | Remove the integration and revoke agent access |

Tool access levels are displayed using the labels "Can view data" and "Can make changes" to indicate read-only and read-write capabilities respectively.

### Agent-Created Tools

Agents can create tools during execution. These appear in the "Agent-Created Tools" section and require admin approval before other agents can use them. From the overflow menu you can approve or delete individual tools.

### Credential Resolution

When an agent runs and needs tool credentials, the system resolves them based on the tool's connection mode on that agent:

1. **Team mode** -- uses the encrypted team connection registered by an admin
2. **Delegated mode** -- uses the agent owner's personal connection
3. **Runtime mode** -- uses the invoking user's personal connection

If no credential mode is set for a tool (missing `agent_tool_connections` entry), the run fails with a "credentials not configured" error. There is no silent fallback to team credentials.

If the required credential is missing at execution time, the agent posts a role-aware error message in the thread and fails the run. The message tells the user exactly what happened and who can fix it:

| Mode | Runner Role | Message |
|------|------------|---------|
| Not configured | Admin/Owner | "Credentials haven't been configured for this agent yet. Open agent settings." |
| Not configured | Others | "Credentials haven't been configured. Let @owner know." |
| Team | Admin | "Shared credentials haven't been set up. Go to the Connections page in the dashboard." |
| Team | Agent owner | "Ask a workspace admin to connect the tool in the Connections page." |
| Team | Regular user | "Let @owner or a workspace admin know." |
| Delegated | Agent owner | "You haven't connected yet." + Connect button |
| Delegated | Others | "The owner's credentials aren't set up. Let @owner know." |
| Runtime | Anyone | "I need your credentials to proceed." + Connect button |

For runtime and delegated-owner cases, a **Connect** button is included. After the user completes the connection, the agent automatically retries.

**Important:** The system never silently falls back to stale or empty credentials. If a connection mode is configured but the credentials are missing, the run fails with a clear error rather than proceeding with potentially broken config.

### Agent Tool Connection Editing

After an agent is created, admins and owners can change how each tool resolves credentials. On the agent's detail page, the **Tools** tab shows each tool's current connection mode. You can switch between team, delegated, and runtime modes for any tool on that agent.

---

## Knowledge Base Management

Open the **Knowledge Base** page in the web dashboard.

### The KB Page

The knowledge base page shows:
- Statistics: total entries, pending review, categories, sources
- Source cards for browsing by source (click a source to see its entries)
- A "Manual Entries" card for hand-written content
- A search bar for searching across all entries
- Tabs for Published and Pending Review entries (when viewing manual entries or search results)

Admins can add manual entries, edit non-synced entries, approve pending entries, and delete entries. Auto-synced entries from connected sources cannot be edited (noted in the detail dialog).

### KB Sources

Click the **Sources** button on the Knowledge Base page to manage data sources and API keys.

#### Supported Source Types

| Source | Setup Requirements | Config Options |
|--------|-------------------|----------------|
| **GitHub** | GitHub API token (configured via KB API keys) | Repository (owner/name), branch, path filter |
| **Google Drive** | Google OAuth connection | Folder ID (browsable via folder picker), optional "Include sub-folders" toggle |
| **Zendesk Help Center** | Zendesk API token (configured via KB API keys) | Subdomain, category ID (optional) |
| **Website / Docs (Web Crawl)** | Firecrawl API key (configured via KB API keys) | Start URL, max pages, URL pattern filter |
| **Notion** | Notion OAuth connection | Root page ID |

#### Adding a Source

The "Add Source" button opens a four-step wizard:

1. **Choose Source Type** -- Select from GitHub, Google Drive, Zendesk, Web Crawl, or Notion
2. **Configure** -- Enter the source name and type-specific settings. For Google Drive sources, a folder picker lets you browse and select folders from your connected Google account, and a **Include sub-folders** switch (off by default) makes the sync walk every nested folder under the root at any depth. Deep trees mean more Drive API calls per sync.
3. **Sync Settings** -- Toggle auto-sync (periodic 24-hour syncing) and optionally assign a category
4. **Review & Create** -- Confirm all settings and create the source

#### Managing Sources

From the Sources page, each source has action buttons:

| Action | Description |
|--------|-------------|
| **Edit** | Update source name and configuration |
| **Sync** | Run an immediate one-time sync |
| **Delete** | Delete the source and all its associated entries |

#### API Keys

The Sources page also manages API keys for external KB access. Click **New API Key** to generate a key. Keys are shown once at creation -- copy them immediately.

#### Google Drive File Type Coverage

Connecting a Drive folder indexes both Google-native formats (Docs, Sheets, Slides) and uploaded files: Word (`.docx`/`.doc`), Excel (`.xlsx`/`.xls`), PowerPoint (`.pptx`/`.ppt`), PDF, OpenDocument (`.odt`/`.ods`/`.odp`), RTF, HTML, plain text (txt, md, csv, tsv, json), and JPG/PNG images. JPG and PNG images are OCR'd via Reducto — without Reducto enabled, image files are listed in the skip log with the reason "Image OCR requires Reducto" instead of being silently dropped. Other image formats (GIF, WebP, SVG, TIFF, HEIC), video, and audio are not supported and are skipped with the standard "File format not supported" reason. By default only the direct children of the configured folder are synced — enable **Include sub-folders** on the source (off by default; settable in the Add Source wizard and the Edit Source dialog) to walk nested folders at any depth. Toggling it off later tombstones previously-synced nested files on the next sync. Unsupported or unparseable files are recorded in a per-source **skip log**; on the KB Sources page each row shows an orange ⚠ icon with a count when there are failures, and clicking it opens a modal listing every skipped file with a plain-English reason, file size, and the last-attempted time. One bad file never fails the whole crawl.

**Per-file size cap**: Downloads are capped at **250 MB** by default (set `KB_MAX_FILE_BYTES` in the deployment environment to override). Files above the cap are torn down before full download and recorded in the skip log with reason `too_large`.

**Re-parse control**: After turning Reducto on or off, click the ✨ icon on a source's row to re-parse every already-synced file with current settings. This does not happen implicitly because it can use Reducto credits.

#### Reducto Setup (Optional)

Reducto is an optional per-workspace upgrade for higher-fidelity PDF and scanned-document extraction, and the only OCR engine available for JPG/PNG image files in Google Drive sources. It is opt-in — no bytes are sent to the vendor unless you have both pasted a key and flipped the toggle on. **If you want image OCR, you must enable Reducto.**

1. **Get a Reducto API key** at [reducto.ai](https://reducto.ai) (create an account, generate a key in your Reducto dashboard).
2. In TinyHands, open **Workspace Settings**. You'll see a **Document Parsing** card below the Claude API key card.
3. Paste your Reducto key, click **Test** to verify it with Reducto (a tiny probe file is uploaded — no `/parse` credits are spent on the test), then click **Save**.
4. Flip the **Use Reducto for better PDF extraction** toggle **On**. The next KB sync will route PDFs and Office documents through Reducto.

**Cost implications**: Reducto bills per page parsed. It is invoked for PDFs and Office files (Word / Excel / PowerPoint) when enabled, and as a fallback for any file whose local parser fails or returns empty text. Each Drive sync's Reducto call count and reported `usage` credits are logged with the sync run — monitor your usage on the Reducto dashboard.

**Fallback safety**: If Reducto returns an error, times out, or you revoke the key, the sync silently falls back to the local parser and records a per-file warning. Your KB never breaks because Reducto is unreachable.

**Disabling**: Flip the toggle off. The key stays stored (so you can re-enable without re-pasting), but no further bytes are sent to Reducto until you turn it back on.

---

## Document Management

Open the **Documents** page in the web dashboard to manage all documents.

### The Documents Page

The documents page shows:
- Statistics: total documents, docs, sheets, files
- Type filter tabs: All, Docs, Sheets, Files
- Search bar for searching across titles and content
- Create dropdown: New Document, New Spreadsheet, Upload File, Import CSV, Import DOCX

### Document Types

| Type | Description | Storage | Agent Format |
|------|-------------|---------|-------------|
| Doc | Rich text document | Slate JSON | Markdown |
| Sheet | Spreadsheet with tabs | Sparse cell JSONB | CSV |
| File | Any uploaded file | PostgreSQL BYTEA | Text extraction |

### Agent Editability

Each document has an **Allow agents to edit** toggle (default: on). When disabled, agents can still read the document but cannot modify it. The toggle is available in each document's editor toolbar.

### Version History

All document edits create version snapshots. Documents retain up to 50 versions, files up to 10. Restore any version from the History dialog.

### File Upload Limits

- Maximum file size: 25 MB
- Blocked file types: .exe, .sh, .bat, .dll, .so, .cmd, .com, .msi, .scr
- File storage uses PostgreSQL BYTEA (can be swapped to S3 via StorageProvider interface)

### Database Tables

Migration `022_docs.sql` creates: `documents`, `document_versions`, `sheet_tabs`, `document_files`, `document_search`.

### Dependencies

The documents feature requires these npm packages:
- `multer` — file upload handling
- `pdf-parse` — PDF text extraction for search indexing
- `mammoth` — DOCX import/conversion

---

## Agent Management

### Creating Agents

Open the **Agents** page in the dashboard and click **New Agent**. Any workspace user can create agents.

The four-step wizard works as follows:

1. **Describe** -- Enter a plain-English description of what the agent should do. TinyHands uses AI (the goal analyzer) to automatically generate a complete configuration: name, emoji, instructions, model, tools, effort level, memory setting, and response mode. The AI considers which integrations are available and configured. For non-admin users, the analyzer restricts suggestions to read-only tools.

2. **Identity** -- Review and customize the agent name, emoji avatar, and instructions.

3. **Settings** -- Adjust model, effort, Slack activation mode, access level, action approval policy, and memory toggle.

4. **Tools** -- Select which connected services the agent can use. Each service shows two checkboxes:
   - "Can view data" (read-only access)
   - "Can make changes" (read-write access; automatically enables view access)

### Agent Detail Page

Each agent's detail page has six tabs:

| Tab | Contents |
|-----|----------|
| **Overview** | Editable instructions with rich text editor, model/effort dropdowns (auto-save on change), version history with preview and restore |
| **Tools** | Action approval policy, list of enabled tools with connection modes, add/remove tools |
| **Runs** | Paginated execution history with status, user, duration, tokens, cost |
| **Memory** | Stored memories with category, content, and delete capability |
| **Triggers** | Schedule and event triggers with add, edit, pause, and delete |
| **Access** | Default access level, user roles, upgrade requests with approve/deny |

### Version History

Every configuration change creates a new version entry. Version history tracks changes to:
- Instructions (system prompt)
- Model
- Tools
- Effort (max turns)
- Memory enabled/disabled
- Mentions only / respond to all
- Default access level
- Write policy

Each version shows the change note, who made the change, and when. You can preview any version to see its full configuration snapshot, and restore it to revert the agent.

This is powered by migration 020 which added columns for model, tools, max_turns, memory_enabled, mentions_only, respond_to_all, default_access, and write_policy to the `agent_versions` table.

### Pausing and Deleting

From the agent detail page header, use the Pause/Resume button or the overflow menu to delete. From the Agents list, use the row overflow menu.

---

## Agent Access Control

### Agent Access Levels

Each agent has a **default access level** that determines what unenrolled users can do:

| Default Access | Dashboard Label | Behavior for users without explicit role |
|---------------|-----------------|------------------------------------------|
| **None** | Invite Only | Agent is hidden -- only explicitly granted users can see/use it |
| **Viewer** | Limited Access | Can see the agent, but write actions trigger upgrade requests |
| **Member** | Full Access | Can fully interact with the agent |

Individual users can be granted specific roles that override the default:

| Role | Permissions |
|------|-------------|
| **Owner** | Full control -- modify agent, manage roles, delete, approve upgrades |
| **Member** | Full interaction -- read and write tool actions |
| **Viewer** | Read-only -- write actions trigger an automatic upgrade request |

The agent creator automatically becomes the owner. Platform admins (superadmin/admin) have owner-level access to all agents.

### Action Approval (Write Policies)

Each agent has an **action approval** setting controlling how write tool actions are handled at runtime:

| Setting | Dashboard Label | Behavior |
|---------|----------------|----------|
| **auto** | Automatic | Write actions execute immediately for members |
| **confirm** | Ask User First | Agent pauses and DMs the requesting user with action details and Approve/Deny buttons |
| **admin_confirm** | Ask Owner/Admins | Agent pauses and DMs the agent owner with action details and Approve/Deny buttons |

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

On the agent's detail page, go to the **Access** tab to manage roles. You can grant owner, member, or viewer access to specific users.

---

## Tool Connections

### Connection Modes

Each tool on an agent can be configured with a connection mode:

| Mode | Description |
|------|-------------|
| **Team** | Single shared credential for the whole workspace |
| **Delegated** | Owner's personal credential shared through the agent |
| **Runtime** | Each user brings their own credential (prompted to connect if missing) |

### Personal Connections

Users connect their personal accounts from the **Connections** page in the dashboard:

1. Go to the Connections page
2. Click **Add Connection**
3. Choose an OAuth service or API key integration from the list
4. Complete the OAuth flow in the browser, or enter credentials in the dialog

Credentials are encrypted with AES-256-GCM and stored securely. Connected services appear in the **Personal Connections** tab, where users can disconnect at any time.

Supported personal connection types:
- **Google** -- Drive, Sheets, Docs, Gmail (single OAuth connection covers all four)
- **Notion** -- Workspace access (OAuth)
- **GitHub** -- Personal repository access (OAuth)
- **API key integrations** -- Any integration with `connectionModel: "personal"` or `"hybrid"` that accepts API keys

### Google Drive Folder Restrictions

For Google connections, users can restrict access to a specific Drive folder. On the Connections page, click **Set Folder** or **Change Folder** next to a Google connection. A folder browser lets you navigate your Drive hierarchy and select a folder. When a folder restriction is set:

- The connection shows the folder name beneath the integration name
- Agents using this connection can only access files within that folder and its subfolders
- Click **Change Folder** to pick a different folder, or clear the restriction for full access

This restriction is stored as `root_folder_id` and `root_folder_name` in the connection's encrypted credentials.

### Setting Up OAuth (Admin)

To enable personal connections via OAuth, configure these environment variables:

```env
# Generate with: openssl rand -base64 32
ENCRYPTION_KEY=<at least 32 characters>

# From notion.so/my-integrations -> Create integration -> OAuth
NOTION_OAUTH_CLIENT_ID=<your-client-id>
NOTION_OAUTH_CLIENT_SECRET=<your-client-secret>

# From github.com/settings/developers -> OAuth Apps -> New
GITHUB_OAUTH_CLIENT_ID=<your-client-id>
GITHUB_OAUTH_CLIENT_SECRET=<your-client-secret>

# Your server's public URL (for OAuth callbacks)
OAUTH_REDIRECT_BASE_URL=https://your-domain.com
```

Google OAuth credentials are **not** configured via env vars. Each workspace brings its own Google Cloud OAuth client via the dashboard — see the next section. `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` only matter as a one-time bootstrap for single-tenant installs (if set on first boot, they're lifted into workspace 1's encrypted credential store and then never read again).

#### Setting up your Google OAuth app (workspace admin, per workspace)

Every workspace owns its own Google Cloud OAuth client — TinyHands is transport only and never holds a Google identity of its own. This is what lets workspaces publish their OAuth app **Internal** (Workspace-scoped), skip Google's CASA audit entirely, and keep any scope including full Drive / Gmail.

One-time setup per workspace, ~20–40 minutes:

1. **Create a Google Cloud project** at [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate). Name it anything (e.g. "Acme TinyHands").
2. **Enable the APIs you need** at [console.cloud.google.com/apis/library](https://console.cloud.google.com/apis/library) — Google Drive API, Google Sheets API, Google Docs API, Gmail API (whichever you plan to use).
3. **Configure the OAuth consent screen** at [console.cloud.google.com/apis/credentials/consent](https://console.cloud.google.com/apis/credentials/consent).
   - **User Type: Internal (strongly recommended)** if every TinyHands user is on your Google Workspace. Internal mode skips Google verification, has no user cap, and supports restricted scopes without an audit. This is the whole reason BYO exists.
   - If you need external users, pick External + Testing (up to 100 test users, no audit) or External + Production (requires CASA audit for restricted scopes).
   - Add your workspace email as a support contact and developer contact.
4. **Create an OAuth 2.0 Client ID** at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials). Application type = Web application. Under "Authorized redirect URIs", add the exact redirect URI shown on your TinyHands dashboard (Settings → Integrations → Google connection app) — it looks like `https://your-tinyhands-domain.com/auth/callback/google`.
5. **Paste the Client ID and Client Secret** into the TinyHands dashboard on the same page. Click **Test connection** — a green check means Google accepts your credentials and your redirect URI is registered correctly. Click **Save**.

Once configured, any workspace member can go to Connections → Personal and click Connect on Google Drive / Sheets / Docs / Gmail. The consent screen they see will be named after your Google project, not TinyHands.

The redirect URI is workspace-agnostic (the same for all customers) — the per-workspace identification happens via the signed OAuth `state` parameter. You don't need a separate redirect URI per workspace.

Required Google API scopes (requested automatically during OAuth):
- `https://www.googleapis.com/auth/drive` (Drive access)
- `https://www.googleapis.com/auth/spreadsheets` (Sheets access)
- `https://www.googleapis.com/auth/documents` (Docs access)
- `https://mail.google.com/` (Gmail access)

All Google OAuth flows use a single callback path `/auth/callback/google` regardless of which Google integration initiated the flow. The system stores the original integration ID (e.g., `google-drive`, `gmail`) in the OAuth state and creates the connection for the correct integration after the callback completes.

#### OAuth Callback Handling

OAuth callbacks are handled at `GET /auth/callback/:integration` on the Express server. The callback path determines the redirect URI that must match what's registered with the OAuth provider:

- Google: `/auth/callback/google` (all four Google integrations share this)
- Notion: `/auth/callback/notion`
- GitHub: `/auth/callback/github`

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

- **Nginx** (`nginx:alpine`) -- listens on ports 80 and 443, redirects HTTP to HTTPS, proxies HTTPS traffic to the TinyHands app on port 3000
- **Certbot** (`certbot/certbot`) -- automatically renews certificates every 12 hours

The Nginx configuration template at `nginx/default.conf.template` uses the `OAUTH_DOMAIN` environment variable for `server_name` and SSL certificate paths. The `nginx:alpine` image automatically substitutes environment variables in template files.

#### DNS Requirements

Before running the SSL setup, ensure your domain's DNS A record points to your server's public IP address. Let's Encrypt validates domain ownership via HTTP, so the domain must resolve to your server.

#### Certificate Renewal

Certificates are renewed automatically by the certbot service. No manual intervention is required. Certbot checks for renewal every 12 hours and renews certificates that are within 30 days of expiration.

---

## Triggers

Triggers are configured on the agent's Triggers tab in the dashboard. Types include:

- **Channel messages** -- agent responds when messages appear in its channel
- **Scheduled** -- agent runs on a cron schedule (e.g., "Every Monday at 9am")
- **External events** -- agent triggers on webhooks from Linear, Zendesk, Intercom, or GitHub

Triggers can be paused and resumed from the Triggers tab.

---

## Audit Log

Platform admins can view a comprehensive audit trail of all actions via the web dashboard audit log. The `/audit` Slack command redirects to the dashboard. The audit log tracks:

- Role changes (platform and agent level)
- Agent creation, updates, and deletion
- Tool invocations with user context
- Connection creation and deletion
- Upgrade request approvals and denials

The audit log has forever retention and is indexed by workspace, agent, user, and timestamp.

### Viewing the Audit Log

1. Open the **Audit Log** page in the web dashboard (or run `/audit` in Slack to get a link)
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

## Database Migrations

### Migration 019: Legacy Google Cleanup

Migration `019_cleanup_legacy_google.sql` removes the legacy monolithic Google Workspace integration:

- Deletes connections for the legacy `google` integration ID
- Removes `google-read` and `google-write` tool names from all agents' tools arrays
- Deletes the legacy `google-read` and `google-write` custom tool records

This migration runs automatically and is safe to apply -- the four new Google integrations (google-drive, google-sheets, google-docs, gmail) are independent and unaffected.

### Migration 020: Version History Fields

Migration `020_version_history_fields.sql` expands the `agent_versions` table to track all configuration changes, not just system prompt changes. New columns:

- `model` (TEXT)
- `tools` (TEXT, JSON array)
- `max_turns` (INTEGER)
- `memory_enabled` (BOOLEAN)
- `mentions_only` (BOOLEAN)
- `respond_to_all` (BOOLEAN)
- `default_access` (TEXT)
- `write_policy` (TEXT)

---

## Quick Reference

| Command | Where | Who | What it does |
|---------|-------|-----|--------------|
| `/agents` | Anywhere | All users | Get a link to the web dashboard |
| `/new-agent` | Anywhere | All users | Redirects to agent creation on the web dashboard |
| `/update-agent` | Anywhere | All users | Redirects to agent management on the web dashboard |
| `/tools` | Anywhere | All users | Redirects to tools page on the web dashboard |
| `/kb` | Anywhere | All users | Redirects to knowledge base on the web dashboard |
| `/audit` | Anywhere | All users | Redirects to audit log on the web dashboard |
| `/templates` | Anywhere | All users | Redirects to agent templates on the web dashboard |
| `/connect` | Bot DM | All users | Manage personal tool connections |
| `add @user as superadmin` | Bot DM | Superadmins | Grant superadmin access |

---

## Environment Variables

Core required vars (see `.env.example` for full list):

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
ANTHROPIC_API_KEY=...
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
```

Optional:

| Variable | Purpose |
|----------|---------|
| `WEB_DASHBOARD_URL` | Public URL for the web dashboard (used in Slack messages) |
| `ENCRYPTION_KEY` | 32+ character key for encrypting credentials (AES-256-GCM) |
| `GOOGLE_OAUTH_CLIENT_ID` | *Bootstrap-only.* Google OAuth client ID. Set on first boot of a single-tenant install to seed workspace 1's credentials; runtime reads the per-workspace record, never this env var. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | *Bootstrap-only.* Google OAuth client secret (same bootstrap rule as above). |
| `NOTION_OAUTH_CLIENT_ID` | Notion OAuth client ID |
| `NOTION_OAUTH_CLIENT_SECRET` | Notion OAuth client secret |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth client secret |
| `OAUTH_REDIRECT_BASE_URL` | Public URL for OAuth callbacks (e.g., `https://yourdomain.com`) |
| `OAUTH_DOMAIN` | Domain for Nginx SSL setup |
| `LETSENCRYPT_EMAIL` | Email for Let's Encrypt certificate notifications |
| `GITHUB_TOKEN` | GitHub token for auto-update feature |
| `PORT` | Server port (default 3000) |
| `LOG_LEVEL` | Logging level |
| `DOCKER_BASE_IMAGE` | Base Docker image for agent execution |
| `DAILY_BUDGET_USD` | Daily spending limit |
| `AUTO_UPDATE_ENABLED` | Enable pull-based auto-update from GitHub |
| `DATABASE_POOL_URL` | PgBouncer connection string (DigitalOcean managed DB pooler port). When set, app connects via pooler for queries and direct URL for migrations |

---

## Tips

- Set up integrations (Tools & Integrations page) and knowledge sources (KB Sources page) before creating agents -- agents auto-select tools based on their goal.
- For Google services, each workspace admin sets up their own Google Cloud OAuth app via Settings → Integrations → Google connection app. One OAuth client covers Drive, Sheets, Docs, and Gmail. Publish it **Internal** if everyone is on your Google Workspace — it's the easiest path and skips Google's CASA audit.
- Use "Can view data" access for integrations unless agents genuinely need to make changes.
- Enable auto-sync on knowledge sources to keep agent context up to date.
- Use "Invite Only" access for team-specific agents (e.g., engineering-only, sales-only).
- Set action approval to "Ask Owner/Admins" for agents that modify external systems.
- Use "runtime" connection mode for tools that should use each user's own credentials.
- Start with Standard effort level -- increase to Thorough or Maximum only for agents doing deep research.
- Use folder restrictions on Google Drive connections to limit agent access to specific folders.
