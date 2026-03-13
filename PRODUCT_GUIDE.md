# Introducing TinyHands — Your AI Agent Platform in Slack

We're excited to launch TinyHands, a platform that lets you create and manage AI-powered agents right inside Slack. These agents can answer questions, run research, manage tickets, track SEO rankings, and much more — all from the channels you already work in.

---

## Getting Started

### Step 1: Create Your First Agent

DM the TinyHands bot and type `/agents`. Click the **+ New Agent** button. You'll be asked two questions:

1. **What should this agent do?** Describe its goal in plain English. For example:
   - *"Answer customer support questions using our help center docs"*
   - *"Track our SEO rankings and report on keyword performance"*
   - *"Triage incoming Linear issues and add labels"*

2. **When should it run?** Tell it when to activate:
   - *"Whenever someone asks a question in #support"*
   - *"Every Monday at 9am"*
   - *"When a new Zendesk ticket comes in"*

TinyHands will automatically configure the agent's name, prompt, model, tools, and channel — then ask you to confirm before creating it.

### Step 2: Talk to Your Agent

Once created, just send a message in the agent's channel. The agent will pick up relevant messages and respond in a thread. You can also:

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

DM the TinyHands bot and type `/agents` to see all your agents. From there you can:

| Action | How |
|--------|-----|
| View config | Overflow menu → View Config |
| Edit goal & settings | Overflow menu → Update |
| Pause / Resume | Overflow menu → Pause / Resume |
| Delete | Overflow menu → Delete |
| Manage members (private agents) | Overflow menu → Members |

You can also type `/update-agent` in the bot DM to update any agent via conversation.

---

## Knowledge Sources

Agents work best when they have context. Your admin can connect knowledge sources like GitHub repos, Google Drive files, and Zendesk help centers to your agents. If you need a source connected, reach out to your admin.

You can search the shared knowledge base anytime by DMing the bot and typing `/kb search <query>`.

---

## Triggers

Triggers are set up during agent creation. When asked "When should it run?", describe when the agent should activate:

- *"Whenever someone asks a question in #support"* — responds to channel messages
- *"Every Monday at 9am"* — runs on a schedule
- *"When a new Linear issue is created"* — triggers on external events
- *"When a Zendesk ticket comes in"* — triggers on external events

TinyHands will automatically configure the right trigger type and schedule based on your description. You can pause and resume triggers later from `/agents`.

---

## Available Tools & Integrations

Your agents come with built-in tools (web search, file operations, code analysis) and may also have access to these integrations:

| Integration | What it does |
|------------|--------------|
| **Zendesk** | Search tickets, create tickets, add comments |
| **Linear** | Search issues, manage projects and cycles |
| **PostHog** | Query events, feature flags, user analytics |
| **HubSpot** | Search and manage contacts, deals, companies |
| **SerpAPI** | Track search engine rankings across Google, Bing, Yahoo |
| **Knowledge Base** | Search your internal KB |

When you create an agent, TinyHands automatically selects the right tools based on the agent's goal. If you need an integration that isn't available yet, ask your admin to set it up.

---

## Private Agents

Not every agent needs to be visible to everyone. When creating an agent, you can set its visibility to **Private**. Private agents:

- Only appear for members you've added
- Are silently ignored when non-members message in shared channels
- Can be managed with `add member @user` and `remove member @user` in the agent's channel

---

## Agent Memory

Agents with memory enabled learn from conversations. They remember user preferences, key decisions, and important context across sessions. If you ever need an agent to forget something, type `forget about <topic>` in its channel.

---

## Effort Levels

Each agent has an effort level that controls how deeply it works on a task:

| Level | Best for |
|-------|----------|
| **Low** | Quick, single-turn answers |
| **Medium** | Multi-step reasoning (default) |
| **High** | Deep research and iteration |
| **Max** | Complex, multi-tool investigations |

You can change this in the agent's settings via `/agents` → Update.

---

## Quick Reference

| Command | What it does |
|---------|--------------|
| `/agents` | View and manage all your agents (in bot DM) |
| `/update-agent` | Update an existing agent (in bot DM) |
| `/kb search <query>` | Search the knowledge base (in bot DM) |
| DM the bot | Talk to any agent directly |

---

## Tips

- Start simple. Create an agent with a clear, focused goal — you can always expand it later.
- Use `/opus` before a message for the most capable model on complex tasks.
- Private agents are great for team-specific workflows that don't need org-wide visibility.

Questions? DM TinyHands or reach out to the platform team.
