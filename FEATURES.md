# TinyHands -- Complete Feature List

Everything TinyHands can do, organized by capability.

---

## AI Agent Platform

### Create Agents in Seconds
Describe what you want your agent to do in plain English. TinyHands uses Claude to automatically generate the agent's name, personality, detailed instructions, recommended AI model, activation settings, and tool selections. Review and customize before creating, or accept the AI-generated configuration as-is.

### Four-Step Creation Wizard
1. **Describe** -- Type a goal like "Help our support team answer customer questions using our knowledge base"
2. **Identity** -- Review and edit the generated name, emoji avatar, and detailed instructions
3. **Settings** -- Configure the AI model (Sonnet, Opus, or Haiku), effort level, when the agent responds in Slack, who can access it, and whether it needs approval before taking actions
4. **Tools** -- Select which connected services the agent can access, with granular read/write permissions per service

### Agent Templates
10 pre-built agent templates across five categories: Content & SEO, Sales & Revenue, Customer Insights, Competitive Intelligence, and Growth. Browse templates, preview their configuration, and deploy with one click.

### Flexible AI Models
Choose the right model for each agent's needs:
- **Sonnet** -- Balanced performance for most tasks (recommended)
- **Opus** -- Maximum capability for complex multi-step reasoning
- **Haiku** -- Fastest responses for simple classification and routing

### Adjustable Effort Levels
Control how much work each agent puts into responses: Quick (fast answers), Standard (balanced), Thorough (detailed analysis), or Maximum (exhaustive research). Higher effort means the agent takes more steps and uses more tools before responding.

### Agent Memory
Agents can remember facts, preferences, corrections, and context across conversations. Memory is automatically extracted after each interaction and retrieved for future conversations. Categories include customer preferences, procedures, corrections, technical context, and entities.

---

## Slack Integration

### Channel-Based Agents
Each agent lives in one or more Slack channels. Messages in those channels are automatically routed to the agent. Agents respond in threads with their own custom name and emoji avatar.

### Smart Activation Modes
- **Only when @mentioned** -- Agent only responds when directly tagged
- **Relevant messages** -- AI determines if a message is relevant to the agent's purpose and responds automatically
- **Every message** -- Agent responds to all messages in its channels

### Direct Message Routing
Message the bot directly in Slack DMs. If you have access to multiple agents, the system automatically determines which agent is most relevant to your message. If it can't decide, it shows a picker with your available agents. Thread-based conversations maintain continuity with the chosen agent.

### Real-Time Streaming
Agent responses stream to Slack in real-time. See live status updates as the agent thinks, uses tools, and composes its response. No waiting for the full response -- see progress as it happens.

### Rich Formatting
Agent output automatically converts to Slack-native formatting: bold, italic, code blocks, bullet lists, and links. Slack user mentions (@name) and emoji codes render correctly in the dashboard.

---

## Connected Services

### 11 Integrations, Ready to Connect

#### Chargebee (Billing & Subscriptions)
- **View**: Search customers, list subscriptions, view invoices, browse plans and pricing, list coupons
- **Act**: Create/update customers, manage subscriptions, cancel subscriptions, add charges, apply coupons

#### Google Drive (File Management)
- **View**: Search files across Drive, list folder contents, view file metadata, download and read documents (auto-exports Google Docs to text, Sheets to CSV)
- **Act**: Create folders, move files between folders, upload new files

#### Google Sheets (Spreadsheets)
- **View**: Read spreadsheet data by range (A1 notation), get sheet structure and dimensions
- **Act**: Create new spreadsheets, update cell ranges, append rows to existing sheets

#### Google Docs (Documents)
- **View**: Read full document content including text from tables
- **Act**: Create new documents with initial content, replace entire document content

#### Gmail (Email)
- **View**: Search emails with Gmail query syntax, read full email with attachments list, browse labels
- **Act**: Send new emails with to/cc/bcc, reply to emails with proper threading (In-Reply-To headers preserved)

#### HubSpot (CRM)
- **View**: Search contacts, deals, and companies. View contact details, deal pipelines, company records
- **Act**: Create/update contacts, deals, and companies. Add notes and tasks to records

#### Knowledge Base (Internal)
- **View**: Full-text search across all knowledge base entries, browse by category
- Auto-configured, no API keys needed

#### Linear (Project Management)
- **View**: Search issues, browse projects, list teams and cycles, view labels and users
- **Act**: Create/update issues, add comments, create projects

#### PostHog (Product Analytics)
- **View**: Query events, look up persons, list feature flags, view insights and cohorts

#### SerpAPI (Search Rankings)
- **View**: Track SERP rankings across Google, Bing, and Yahoo. Single keyword or batch search. Location and device targeting.

#### Zendesk (Support)
- **View**: Search tickets, view ticket details and comments, list groups and users, view satisfaction ratings
- **Act**: Create tickets, add comments, update priority, tags, and assignees

### One-Click Google OAuth
All four Google integrations (Drive, Sheets, Docs, Gmail) connect through a single Google authorization. Click "Connect with Google," authorize once, and all Google services are available. No API keys or access tokens to copy.

### Folder-Level Access Control
Restrict a Google Drive connection to a specific folder. Browse your Drive with an interactive folder picker, select a folder, and the agent can only access files within that folder and its subfolders. Change or remove the restriction at any time from the Connections page.

### Core Tools (Always Available)
Every agent automatically has access to: run shell commands, read/write/edit files, search files by name or content, search the web, and fetch web pages. No configuration needed.

### Custom Tools
Create custom tools with JavaScript, Python, or Bash code. Define input schemas, set access levels (read-only or read-write), and attach to agents. Tools run in sandboxed Docker containers with a 30-second timeout.

---

## Knowledge Base

### Hierarchical Organization
Knowledge is organized in three levels: **Sources** (where content comes from), **Documents** (individual articles/pages), and **Content** (the searchable text). The dashboard shows source cards with entry counts and sync status -- click into a source to browse its documents.

### Six Auto-Sync Connectors

| Source | What It Imports |
|--------|----------------|
| **GitHub** | Markdown files from repositories, with automatic Mintlify documentation detection |
| **Google Drive** | Documents, spreadsheets, PDFs from Drive folders (with visual folder picker) |
| **Zendesk Help Center** | Published help center articles |
| **Website** | Crawl and index any website or documentation site |
| **HubSpot KB** | Knowledge base articles from HubSpot CMS |
| **Linear Docs** | Project documents and issue descriptions from Linear |

### Visual Folder Picker for Google Drive
When adding a Google Drive source, browse your Drive interactively instead of pasting folder IDs. Navigate through folders with breadcrumb navigation, see folder names, and select with one click. The same picker is available when editing an existing source.

### Automatic Syncing
Sources sync automatically on a configurable schedule (default: daily). Force a re-sync at any time, or flush all entries and re-import from scratch.

### Full-Text Search
PostgreSQL-powered full-text search with ranking. Agents automatically search the knowledge base for relevant context before responding. Manual search available from the dashboard.

### Manual Entries with Approval
Add knowledge base entries manually with title, category, tags, and content. Agent-contributed entries require human approval before appearing in search results. Edit or delete any entry from the dashboard.

### Smart Categorization
Entries are organized by category. AI-powered metadata generation suggests titles, summaries, categories, and tags from content. Categories are browsable and filterable in the dashboard.

---

## Triggers & Automation

### Schedule Triggers
Run agents on a schedule using cron expressions. Timezone auto-detected from your Slack profile. Common patterns: hourly, daily at 9am, weekly on Mondays. Pause and resume schedules at any time.

### Event Triggers
Fire agents automatically when events happen in external systems:
- **Slack** -- Messages posted in specific channels
- **Linear** -- Issues created or updated
- **Zendesk** -- Tickets created or updated
- **Intercom** -- Conversations started or updated
- **Webhook** -- Any system that can send HTTP POST requests

### Deduplication
Events are automatically deduplicated with a 5-minute window to prevent the same event from triggering multiple agent runs.

---

## Credentials & Security

### Encrypted Storage
All credentials (API keys, OAuth tokens) are encrypted at rest using AES-256-GCM with a configurable encryption key. Credentials are never stored in plaintext.

### Team vs Personal Credentials
- **Team credentials** -- Shared across the workspace, managed by admins. One set of credentials used by all agents.
- **Personal credentials** -- Each user connects their own account. Agents use the invoking user's credentials, the agent creator's credentials, or fall back to team credentials.

### OAuth Flows
Built-in OAuth support for Google, Notion, and GitHub. Users click "Connect," authorize in a popup, and credentials are stored automatically. No manual token copying.

### Per-Agent Credential Control
Each tool on each agent can be independently configured to use team credentials, the requesting user's personal credentials, or the agent creator's personal credentials.

---

## Access Control

### Three-Tier Platform Roles
- **Super Admin** -- Full platform access. Manage all agents, tools, connections, settings, and users.
- **Admin** -- Same capabilities as Super Admin for most operations.
- **Member** -- Default role. Can use agents they have access to, connect personal credentials, browse the knowledge base.

### Per-Agent Access Levels
- **Full Access** -- Everyone can use and configure the agent
- **Limited Access** -- Everyone can interact, but only owners can configure
- **Invite Only** -- Must be explicitly invited to access the agent

### Action Approval Policies
- **Automatic** -- Agent acts without asking permission
- **Ask User First** -- Agent asks the person who triggered it before making changes
- **Ask Owner/Admins** -- Agent asks the owner or admins before making changes (via Slack DM with approve/deny buttons)

### Upgrade Requests
Users with limited access can request elevated permissions. Requests go to agent owners and admins for approval with an optional reason.

### Tool Access Requests
Non-admin users who need write access to a tool can submit a request. Admins review and approve/deny from the Requests page.

### Non-Admin Guardrails
Members cannot create agents, manage tool integrations, access admin settings, or modify agents they don't own. All admin-only actions are hidden from the UI -- no confusing disabled buttons.

---

## Version History

### Complete Change Tracking
Every configuration change is automatically recorded: instructions, AI model, tools, effort level, memory setting, activation mode, access level, and action approval policy. Each version includes a descriptive change note (e.g., "Instructions, Model updated"), who made the change, and when.

### Preview Any Version
Click "Preview" on any version to see the full agent configuration at that point in time: instructions text, model, effort, memory, access, and connected tools.

### One-Click Restore
Roll back to any previous version with a single click. The agent's configuration is restored to exactly what it was at that point.

---

## Observability & Monitoring

### Usage Dashboard
Real-time metrics: total runs, tokens consumed, estimated cost, error rate, duration percentiles (p50/p95/p99), and queue wait times. Drill down by agent or model.

### Power User & Agent Rankings
See top users by run count, top agent creators, and most popular agents. Identify which agents are delivering the most value.

### Automated Alerts
Five built-in alert rules: high error rate (>10%), expensive single runs (>$5), daily budget exceeded, queue depth warnings, and long-running jobs. Alerts post to Slack with deduplication to prevent spam.

### Daily Digest
Automated daily summary posted to Slack: run count, token usage, cost, top agent, top user, agents with high error rates, and agents with anomalous cost spikes (>2x their 7-day average).

### Error Logs
Browse failed runs with error details, agent name, duration, user who triggered it, and timestamp. Filter by agent or time range.

### Audit Trail
Every significant action is logged: agent creation, configuration changes, tool invocations, role changes, connection management, upgrade requests, and more. Filter by user, agent, or action type.

---

## Self-Improvement

### Critique-Driven Learning
Critique an agent's output in a Slack thread ("that's wrong," "next time do X," "fix your tone") and the agent proposes improvements to its own instructions. See a diff of the proposed changes and approve or reject.

### Evolution Proposals
Agents can propose their own improvements:
- **Create new tools** -- Agent identifies a capability gap and writes a custom tool
- **Update instructions** -- Agent refines its own system prompt based on patterns it observes
- **Add to knowledge base** -- Agent contributes new entries to the KB for future reference
- **Create MCP configs** -- Agent sets up new Model Context Protocol integrations

Proposals can be auto-executed (autonomous mode) or require human approval via Slack buttons.

### Tool Authoring
Agents can write their own tools from scratch. Claude generates the tool specification, code, and input schema. Code is validated against security patterns and sandbox-tested in a Docker container before activation. Failed tools are auto-fixed by Claude.

### Tool Versioning & Rollback
Every tool code update is recorded. Roll back any tool to a previous version. Track success rates, average duration, and error history per tool.

---

## Multi-Step Workflows

### Visual Workflow Builder
Define multi-step automation as a sequence of actions:
- **Agent runs** -- Execute an agent with a specific prompt
- **Timers** -- Wait for a configurable delay
- **Human actions** -- Pause and wait for human input (resolved via Slack buttons)
- **Conditions** -- Branch based on previous step results

### Branching & Error Handling
Each step can define different next steps for success vs failure. Workflows are capped at 20 steps to prevent runaway execution.

### Status Tracking
Monitor workflow runs in real-time: running, waiting for input, completed, or failed. Side effects are tracked to prevent duplicate execution on retries.

---

## Multi-Agent Teams

### Parallel Sub-Agents
A lead agent can spawn sub-agents to handle tasks in parallel. Configure concurrency limits (default 3 concurrent sub-agents) and depth limits (default 2 levels) to prevent recursive explosion.

### Result Aggregation
When all sub-agents complete, results are aggregated and posted to the lead agent's Slack thread. Total cost is calculated across all sub-agent runs.

---

## Skills

### Prompt Template Skills
Reusable prompt templates with variable placeholders. Attach to agents to give them standardized capabilities: code review, company research, document filling, lead enrichment, ticket triage.

### MCP Integration Skills
Connect agents to external Model Context Protocol servers: GitHub (PRs, issues, code), Linear (issues, projects), Notion (pages, databases), Slack (channels, messages), Zendesk (tickets, replies).

---

## Web Dashboard

### Full Management Interface
18-page React dashboard for managing every aspect of the platform:
- **Dashboard** -- Usage metrics, cost tracking, recent activity
- **Agents** -- List, create, configure, pause, delete
- **Agent Detail** -- Six tabs: Overview, Tools, Runs, Memory, Triggers, Access
- **Tools & Integrations** -- Connect services, manage API keys, OAuth
- **Connections** -- Personal credentials, folder restrictions
- **Knowledge Base** -- Browse sources and entries, search, add content
- **KB Sources** -- Configure auto-sync connectors
- **Triggers** -- Schedule, webhook, and event triggers
- **Requests** -- Pending approvals (tool requests, upgrades, evolution proposals)
- **Error Logs** -- Failed run details
- **Audit Log** -- Complete action history
- **Access & Roles** -- Platform role management
- **Workspace Settings** -- Global configuration

### Designed for Non-Technical Users
No user IDs, no technical jargon, no raw API slugs. Friendly labels throughout: "Can view data" instead of "read-only," "Ask Owner/Admins" instead of "admin_confirm," "Sonnet" instead of "claude-sonnet-4-20250514."

### Collapsible Sidebar
Navigation sidebar with sections: Manage (Agents, Tools, Connections, KB, Triggers), Review (Requests, Errors, Audit), Settings (Access, Workspace). Collapse to icon-only mode for more screen space.

---

## Deployment & Operations

### One-Command Deploy
Docker Compose deploys everything: the application, PostgreSQL, Redis, and the agent runner image. Single `docker compose up -d` command.

### Auto-Deploy from GitHub
Push to main and the system automatically pulls changes, rebuilds, runs migrations, and restarts. No CI/CD pipeline needed. Alternatively, configure pull-based auto-updates that check for new versions on a schedule.

### Auto-SSL with Let's Encrypt
Built-in Nginx reverse proxy with automatic SSL certificate provisioning and renewal via Let's Encrypt. Required for OAuth callbacks (Google, GitHub, Notion).

### PM2 Process Management
Six managed processes: Slack listener, 3 job workers, scheduler (cron trigger evaluation), and background sync (KB auto-sync, alerts, daily digest). Automatic restart on crashes.

### Rate Limiting
Redis-backed token bucket rate limiting for Anthropic API calls. Pre-flight capacity checks at 90% TPM. Automatic 60-second pause on 429 responses. Per-minute request rate tracking.

### Daily Budget Controls
Set a daily spending threshold. When exceeded, non-critical triggers are automatically paused and an alert is posted to Slack.
