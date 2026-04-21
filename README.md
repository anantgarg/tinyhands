# Tiny Hands

**Extra hands for your Slack workspace. Open-source, self-hosted.**

Create autonomous AI agents that live in your Slack channels, connect to your tools and data, and get work done through conversation. Your VPS, your keys, your hands.

---

## Deploy

**Docker Compose** (any server with Docker):

```bash
git clone https://github.com/anantgarg/tinyhands.git && cd tinyhands
cp .env.example .env   # fill in SLACK_* and ANTHROPIC_API_KEY
docker compose up -d
```

For OAuth (Google, GitHub, Notion), set `OAUTH_DOMAIN` in `.env` and run `./deploy/init-letsencrypt.sh` to enable HTTPS with auto-renewing SSL certificates.

**Install script** (Ubuntu/Debian -- installs Docker, configures everything interactively):

```bash
curl -sSL https://raw.githubusercontent.com/anantgarg/tinyhands/main/scripts/install.sh | sudo bash
```

---

## What is Tiny Hands?

Tiny Hands turns your Slack workspace into a crew of AI teammates. Each agent gets its own channel, persona, tools, and knowledge. You talk to them like teammates -- they execute tasks autonomously using Claude, pull context from connected sources, and learn from feedback.

**Core idea:** Every agent is Claude running in a Docker container. Slack is the control plane. A web dashboard manages everything. You describe the job, give it tools -- Claude does the rest.

---

## Use Cases

**Customer Support** -- Triage tickets, answer questions from your help center, watch for SLA breaches

**Sales** -- Enrich leads, summarize deal activity, monitor competitors

**Engineering** -- Review PRs, respond to incidents, keep docs updated

**Product** -- Track feature requests, draft release notes, analyze user research

**Marketing** -- Research content, track SEO rankings, monitor brand mentions

**Operations** -- Onboard new hires, generate reports, manage procurement

---

## Features

### Agent Management
- **Web Dashboard** at your domain -- create, configure, pause, resume, and delete agents
- **Agent Creation Wizard** -- 4-step flow: Describe (AI generates config), Identity, Settings, Tools
- **AI Goal Analyzer** -- describe what the agent should do and it auto-generates name, instructions, model, tools, and activation mode
- **Templates** -- 10 pre-built agent templates, activate with one click
- **Version History** -- every config change tracked (instructions, model, tools, effort, memory, access, write policy) with preview and restore
- **Inline Editing** -- click agent name to rename, edit instructions with rich text editor, auto-save dropdowns

### Tool Integrations

Core tools (file access, web search, code execution) are always available. Connected services add external capabilities:

| Integration | Can View Data | Can Make Changes | Connection |
|-------------|--------------|-----------------|------------|
| **Chargebee** | Customers, subscriptions, invoices | Manage billing, apply coupons | API key |
| **Google Drive** | Search, list, download files | Create folders, move files, upload | OAuth |
| **Google Sheets** | Read spreadsheet data | Create, update, append sheets | OAuth |
| **Google Docs** | Read documents | Create, update documents | OAuth |
| **Gmail** | Search, read emails | Send, reply to emails | OAuth |
| **HubSpot** | Contacts, deals, companies | Create/update records, tasks | API key |
| **Knowledge Base** | Search internal KB | -- | Auto |
| **Linear** | Issues, projects, cycles | Create/update issues, comments | API key |
| **PostHog** | Events, persons, feature flags | -- | API key |
| **SerpAPI** | SERP rankings (Google, Bing, Yahoo) | -- | API key |
| **Zendesk** | Tickets, groups, users | Create tickets, comments, update priority | API key |
| **Documents** | Read docs, sheets, files | Create, edit, archive documents | Auto |

All four Google integrations share a single OAuth flow -- one authorization covers Drive, Sheets, Docs, and Gmail. Google OAuth uses **your workspace's own Google Cloud OAuth app** (an admin sets this up once via Settings → Integrations), not a TinyHands-owned app. This keeps you off Google's CASA audit, removes the 100-user cap when using Internal publishing, and keeps your Google data's processor relationship with Google alone — TinyHands is transport only.

### Documents

Native document management — create, edit, and manage three document types directly in TinyHands:

- **Docs** — Rich text documents with auto-save, version history, and Markdown export
- **Sheets** — Spreadsheets with tabs, cell editing, and CSV export
- **Files** — Upload any common document format. Single-file or multi-file drag-and-drop. Handles PDFs (native + scanned), Office (`.docx`/`.xlsx`/`.pptx`), legacy Office, OpenDocument, email (`.eml`/`.msg` with attachments), archives (`.zip`), eBooks (`.epub`), images, code, and data formats (CSV/TSV/JSON/XML/YAML) — see the format matrix in `FEATURES.md`.

Agents can create and edit documents via tool calls. Each document has an "Allow agents to edit" toggle. Full-text search across all document types.

### Wiki (KB + Documents)

Each content surface — the Knowledge Base and the Documents module — maintains its own LLM-curated wiki. Every write (KB article, Drive sync, user upload, user or agent edit) triggers a re-ingest that refreshes source, entity, and concept pages with cross-references and an append-only log.

- **No embeddings, no vector search.** Agents read the wiki directly as Markdown pages via new `wiki_index`, `wiki_list`, and `wiki_read` actions on the `kb` and `docs-read` tools.
- **Optional OCR** via customer-supplied Reducto or LlamaParse API keys — otherwise local parsers handle everything text-native.
- **Open wiki** button in the dashboard for full-screen read-only preview; admin-only schema editor; rate-limited backfill migration for existing workspaces.

### Knowledge Base

Hierarchical browsing: **Sources > Documents > Content**

| Source Type | Description |
|-------------|-------------|
| **GitHub** | Markdown files from repos, with Mintlify docs auto-detection |
| **Google Drive** | Docs, sheets, PDFs from Drive folders (with folder picker) |
| **Zendesk Help Center** | Published help center articles |
| **Website** | Crawl and index web pages |
| **HubSpot KB** | Knowledge base articles from HubSpot CMS |
| **Linear Docs** | Project documents from Linear |

- Source cards show entry counts and sync status
- Click into a source to browse its entries
- Auto-sync with configurable intervals
- Full-text search via PostgreSQL tsvector + GIN indexes
- Manual entries with approval workflow
- Edit existing sources (name, config) with help text on all fields
- Google Drive folder picker with breadcrumb navigation

### Connections & Credentials

- **Team connections** -- shared API keys managed by admins in Tools & Integrations
- **Personal connections** -- individual OAuth or API key credentials on the Connections page
- **Google OAuth** -- "Connect with Google" button, no manual token entry
- **Folder restrictions** -- Set Folder / Change Folder on Google Drive connections to limit agent access
- **Credential modes per tool** -- Team credentials, Requesting user's, or Agent creator's
- **AES-256-GCM encryption** for all stored credentials

### Slack Integration

- **Channel-based agents** -- each agent lives in one or more Slack channels
- **DM routing** -- message the bot directly, it routes to the most relevant agent or shows a picker
- **Activation modes** -- only when @mentioned, relevant messages (AI-determined), or every message
- **Real-time streaming** -- agent responses stream to Slack threads in real-time
- **Custom avatars** -- each agent posts with its own name and emoji
- **Slash commands** -- `/agents` opens dashboard, `/new-agent` creates agents from Slack

### Triggers & Automation

| Type | Description |
|------|-------------|
| **Schedule** | Cron expressions with timezone support (auto-detected from Slack) |
| **Slack Channel** | Fire on messages in specific channels |
| **Linear** | React to issue updates |
| **Zendesk** | React to ticket events |
| **Intercom** | React to conversation events |
| **Webhook** | Generic HTTP webhook trigger |

### Access Control

- **Platform roles** -- Super Admin, Admin, Member
- **Agent roles** -- Owner, Member (full access), Viewer (limited)
- **Default access levels** -- Full Access, Limited Access, Invite Only
- **Action approval** -- Automatic, Ask User First, Ask Owner/Admins
- **Non-admin restrictions** -- members cannot manage integrations or access admin pages
- **Upgrade requests** -- viewers can request elevated access

### More

- **Agent Memory** -- optional persistent memory across runs (facts, preferences, context)
- **Self-Improvement** -- critique an agent's output in-thread and it proposes prompt updates
- **Self-Evolution** -- agents can write their own tools and MCP configs
- **Agent Teams** -- lead agents spawn sub-agents for parallel work
- **Multi-Step Workflows** -- stateful DAG workflows with timers and human-in-the-loop
- **Skills** -- attach MCP server integrations and prompt template skills
- **Observability** -- cost tracking, error rates, alerts, daily digest
- **Audit Log** -- comprehensive action trail for all changes
- **Auto-Deploy** -- pull-based deploy from GitHub, no webhook needed

---

## Web Dashboard

The dashboard is the primary management interface. Pages:

| Page | Access | Description |
|------|--------|-------------|
| Dashboard | All | Agent metrics, recent activity, cost tracking |
| Agents | All | List, filter, search agents. Create/edit (admin only) |
| Tools & Integrations | Admin | Connect services, manage integrations |
| Connections | All | Personal OAuth/API key connections, folder restrictions |
| Knowledge Base | All | Browse sources and entries, search, add entries (admin) |
| Triggers | All | Manage schedule, webhook, and event triggers |
| Requests | All | Pending tool requests, upgrade requests, evolution proposals |
| Error Logs | All | Recent errors and failed runs |
| Audit Log | Admin | Full action audit trail |
| Access & Roles | Admin | Platform role management |
| Workspace Settings | Admin | Global configuration |

---

## Architecture

```
Slack (Socket Mode) + Web Dashboard (React)
                |                    |
         Bolt Listener         Express API
                |                    |
         BullMQ + Redis (job queue, rate limiting)
                |
         Workers (1-3, PM2 managed)
                |
         Docker containers (one per run)
                |
         Claude Agent SDK + mounted tools
```

Six PM2 processes: listener, 3 workers, scheduler, sync.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | TypeScript, Node.js, Express |
| Frontend | React, Vite, Tailwind CSS, Radix UI, TanStack Query |
| Slack | Bolt for Node.js (Socket Mode) |
| AI | Claude Agent SDK, Anthropic API |
| Database | PostgreSQL (FTS via tsvector + GIN) |
| Job Queue | BullMQ + Redis |
| Containers | Docker (ephemeral per run) |
| Process Manager | PM2 |

---

## Contributing

Add templates, skills, or tool integrations via PR -- no wiring needed:

- **Templates** -- drop a markdown file in `templates/`
- **Skills** -- drop a markdown file in `skills/`
- **Tool Integrations** -- add a folder in `src/modules/tools/integrations/` with an `index.ts` exporting a manifest

---

## Guides

- **[Product Guide](./PRODUCT_GUIDE.md)** -- capabilities, workflows, and how to use agents
- **[Admin Guide](./ADMIN_GUIDE.md)** -- setup, configuration, integrations, and administration
- **[Features](./FEATURES.md)** -- comprehensive feature inventory with code locations

---

## License

[MIT](./LICENSE) -- Copyright (c) 2026 Anant Garg
