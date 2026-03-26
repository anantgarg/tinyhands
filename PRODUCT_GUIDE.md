# Introducing TinyHands -- Your AI Agent Platform in Slack

We're excited to launch TinyHands, a platform that lets you create and manage AI-powered agents right inside Slack. These agents can answer questions, run research, manage tickets, track SEO rankings, and much more -- all from the channels you already work in.

---

## Getting Started

### Step 1: Create Your First Agent

Open the TinyHands web dashboard and go to the **Agents** page. Click **New Agent**. You will be guided through a four-step wizard:

1. **Describe** -- Tell the agent what it should do in plain English. For example:
   - *"Answer customer support questions using our help center docs"*
   - *"Track our SEO rankings and report on keyword performance"*
   - *"Triage incoming Linear issues and add labels"*

   TinyHands uses AI to analyze your description and automatically generate a name, instructions, model selection, and tool recommendations. You can also click "I'll set it up manually" to skip the AI step.

2. **Identity** -- Review and edit the agent's name, emoji avatar, and instructions (system prompt). The instructions define who the agent is, what it does, and how it behaves.

3. **Settings** -- Configure:
   - **Model**: Sonnet (balanced, recommended), Opus (most capable), or Haiku (fastest)
   - **Effort**: Quick, Standard, Thorough, or Maximum
   - **Slack Activation**: Only when @mentioned, relevant messages (recommended), or every message
   - **Access**: Full Access, Limited Access, or Invite Only
   - **Action Approval**: Automatic, Ask User First, or Ask Owner/Admins
   - **Memory**: Toggle on to let the agent remember context across conversations

4. **Tools** -- Choose which connected services the agent can access. For each service, you can enable:
   - **Can view data** -- read-only access
   - **Can make changes** -- read and write access (enabling this automatically includes view access)

   Core tools (file access, web search, code analysis) are always available and do not need to be selected.

After completing all steps, click **Create Agent** and you will be taken to the agent's detail page.

Any user in the workspace can create agents.

### Step 2: Talk to Your Agent

Once created, just send a message in the agent's Slack channel. The agent will pick up relevant messages and respond in a thread. You can also:

- **@mention the agent** to guarantee a response
- **Reply in a thread** to continue a conversation
- **Override the model** by starting your message with `/opus`, `/sonnet`, or `/haiku`

### Step 3: DM the Bot Directly

You can also DM TinyHands directly. If you have access to multiple agents, it will either:
- Route your message to the most relevant agent automatically
- Show you a picker to choose which agent you want to talk to

Follow-up messages in the same thread continue with the same agent.

---

## Managing Your Agents

### Web Dashboard

The primary way to manage agents is through the **web dashboard**. The `/agents` Slack command provides a link to the dashboard.

On the **Agents** page you can:
- View all agents you have access to, split into "Your Agents" and "Other Agents"
- Search by name, filter by status (Active, Paused) or model (Sonnet, Opus, Haiku)
- Click any agent to open its detail page

Each agent's detail page has six tabs:

| Tab | What it shows |
|-----|---------------|
| **Overview** | Instructions (editable), configuration (model, effort), and version history |
| **Tools** | Connected services, action approval policy, and credential modes |
| **Runs** | Execution history with status, duration, cost, and who triggered each run |
| **Memory** | Stored facts and context the agent has learned across conversations |
| **Triggers** | Scheduled and event-based triggers (cron, webhooks, external events) |
| **Access** | User roles (owner, member, viewer), default access level, and upgrade requests |

From the agent header, owners and admins can:
- Click the agent name to rename it
- Pause or resume the agent
- Delete the agent via the overflow menu

### Version History

Every change to an agent's configuration is tracked in its version history (visible in the Overview tab). Each version records:
- What changed (instructions, model, tools, effort, memory, access, write policy)
- Who made the change
- When it was made

You can **preview** any previous version to see its full configuration, and **restore** it to revert the agent to that state.

---

## Knowledge Base

The Knowledge Base page organizes content in a hierarchy:

1. **Sources** -- Top-level view shows all connected sources (GitHub, Google Drive, Zendesk, etc.) as browsable cards, plus a "Manual Entries" card for hand-written content.
2. **Documents** -- Click any source card to see its entries, with the source name in a breadcrumb. Click "All Sources" to go back.
3. **Content** -- Click any entry to view its full content, category, source, and last-updated date.

You can search across all entries from any level using the search bar. Admins can add manual entries, edit non-synced entries, approve pending entries, and delete entries.

The **Sources** sub-page (accessible via the "Sources" button) lets admins manage connected data sources and API keys for external KB access.

### Searching the Knowledge Base

Everyone can search the knowledge base by DMing the bot and typing `/kb search <query>`.

---

## Triggers

Triggers control when an agent activates beyond direct messages. Types include:

- **Channel messages** -- agent responds when messages appear in its Slack channel
- **Scheduled** -- agent runs on a cron schedule (e.g., "Every Monday at 9am")
- **External events** -- agent triggers on webhooks from Linear, Zendesk, Intercom, or GitHub

Triggers are configured on the agent's Triggers tab in the dashboard. You can add, edit, pause, resume, and delete triggers.

---

## Available Tools and Integrations

Your agents come with core tools (web search, file operations, code analysis) and may also have access to these integrations:

| Integration | What it does |
|------------|--------------|
| **Google Drive** | Search, browse, and manage files and folders |
| **Google Sheets** | Read and write spreadsheet data |
| **Google Docs** | Read and create documents |
| **Gmail** | Search, read, and send emails |
| **Zendesk** | Search tickets, create tickets, add comments |
| **Linear** | Search issues, manage projects and cycles |
| **PostHog** | Query events, feature flags, user analytics |
| **HubSpot** | Search and manage contacts, deals, companies |
| **Chargebee** | List customers, subscriptions, invoices |
| **SerpAPI** | Track search engine rankings across Google, Bing, Yahoo |
| **Knowledge Base** | Search your internal KB |

Google services (Drive, Sheets, Docs, Gmail) each appear as separate integrations but share a single Google OAuth connection. Connecting your Google account once gives agents access to whichever Google tools are enabled.

When you create an agent, TinyHands automatically selects the right tools based on the agent's goal. For each integration tool, you choose between two levels:
- **Can view data** -- the agent can read information from the service
- **Can make changes** -- the agent can also create, update, or delete data

### Tools Page (Admin)

The **Tools & Integrations** page in the dashboard is accessible to admins and shows:

| Section | What it shows |
|---------|---------------|
| **Connected** | Integrations that are registered and active, with edit and disconnect options |
| **Available** | Integrations that can be connected, with setup buttons |
| **Agent-Created Tools** | Tools created by agents during execution, pending admin approval |

From this page admins can register new integrations by entering credentials, edit existing credentials, and disconnect integrations.

### Personal Connections

Some integrations support personal credentials so agents can act on your behalf. The **Connections** page in the dashboard has two tabs:

- **Personal Connections** -- Your own OAuth or API key connections. You can add new connections, set folder restrictions for Google services, and disconnect.
- **Team Connections** -- Shared credentials managed by admins (read-only for non-admins).

To add a personal connection:
1. Go to the Connections page
2. Click **Add Connection**
3. Choose an OAuth service (Google, Notion, GitHub) or an API key integration
4. Complete the authorization flow or enter credentials

#### Google Drive Folder Restrictions

For Google connections, you can restrict an agent's access to a specific Drive folder and its contents. On the Connections page, click **Set Folder** (or **Change Folder**) next to your Google connection. A folder browser lets you navigate your Drive and select a folder. The agent will only be able to access files within that folder.

Leave the folder restriction empty for full access to all files.

### Smart Credential Recommendations

When creating an agent, TinyHands analyzes the agent's purpose and automatically recommends which credential mode to use for each connected tool:

| Mode | When recommended | Behavior |
|------|-----------------|----------|
| **Team** | Agent monitors or acts for the whole team (e.g., ticket triage, dashboards) | Uses the shared team credential registered by an admin |
| **Creator's** | Agent is personal to you (e.g., "manage MY tasks") | Uses the agent creator's personal credential |
| **Each User's Own** | Agent acts on behalf of whoever talks to it (e.g., "send email as the requesting user") | Each user provides their own credential at run time |

The recommendation appears as a hint during setup, with a brief explanation of why that mode fits. You can always override it using the radio buttons. The system also respects each tool's connection model -- for example, a team-only tool like Chargebee will always use shared credentials.

### Missing Credentials

If an agent tries to use a tool and the required credentials are missing, you'll see a clear, specific error message tailored to your role:

- **Admins** see instructions to set up shared credentials in the dashboard
- **Agent owners** are told whether they need to connect their own account or ask an admin
- **Regular users** are told who to contact (the agent owner or a workspace admin)

For tools that need your personal credentials, the message includes a **Connect** button. After you complete the connection, the agent automatically retries -- no need to re-send your original message.

---

## Agent Access Levels

Not every agent needs to be accessible to everyone. Each agent has a **default access level** that controls who can interact with it:

| Access Level | Description |
|-------------|-------------|
| **Invite Only** | Agent is hidden -- only explicitly granted users can see it |
| **Limited Access** | Everyone can see the agent, but can only view data (write actions trigger upgrade requests) |
| **Full Access** | Everyone can fully interact with the agent |

When you have limited access and try to trigger a write action, the system automatically sends an upgrade request to the agent's owners. If approved, you'll be notified and can re-run your request.

### Action Approval (Write Policies)

Each agent has an **action approval** setting that controls how write tool actions are handled:

| Setting | Behavior |
|---------|----------|
| **Automatic** | Write actions execute immediately for members |
| **Ask User First** | The agent pauses and DMs you an approval request with the action details. Click **Approve** to proceed or **Deny** to cancel. |
| **Ask Owner/Admins** | The agent pauses and DMs the agent owner with an approval request. You're notified once they approve or deny. |

When an approval is **denied**, you receive a DM explaining which action was blocked and why. When an approval is **granted**, the agent automatically resumes and completes the write action.

---

## Agent Memory

Agents with memory enabled learn from conversations. They remember user preferences, key decisions, and important context across sessions. You can view and manage an agent's memories from the Memory tab on its detail page. If you ever need an agent to forget something, type `forget about <topic>` in its channel.

---

## Effort Levels

Each agent has an effort level that controls how deeply it works on a task:

| Level | Best for |
|-------|----------|
| **Quick** | Quick, single-turn answers |
| **Standard** | Multi-step reasoning (default) |
| **Thorough** | Deep research and iteration |
| **Maximum** | Complex, multi-tool investigations |

You can change this on the agent's Overview tab in the dashboard.

---

## Quick Reference

| Command | What it does |
|---------|--------------|
| `/agents` | Get a link to the web dashboard (in bot DM) |
| `/kb search <query>` | Search the knowledge base (in bot DM) |
| DM the bot | Talk to any agent directly |
| Web dashboard | Full agent management, tools, connections, knowledge base |

---

## Tips

- Start simple. Create an agent with a clear, focused goal -- you can always expand it later.
- Use `/opus` before a message for the most capable model on complex tasks.
- Set agent access to "Invite Only" for team-specific workflows that don't need org-wide visibility.
- Connect your Google account once from the Connections page to enable Drive, Sheets, Docs, and Gmail for all your agents.
- Use folder restrictions on Google connections to limit agent access to specific Drive folders.

Questions? DM TinyHands or reach out to the platform team.
