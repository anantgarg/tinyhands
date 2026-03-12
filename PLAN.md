# Tiny Hands — Implementation Plan

**Slack-based command center for Claude Code agents**
19 Modules · v3.0

---

## Overview

Tiny Hands is a Slack-based command center where each agent lives in its own channel with a persistent persona. Agents connect to live data sources, fire on external events, and propose edits to their own instructions based on feedback. The execution engine is Claude Code CLI — agents are autonomous, not scripted. Tiny Hands provides context, tools, triggers, and a Slack interface. Claude decides everything else.

**Architecture:** Single VPS. All components — Node.js (PM2), Redis, Docker, SQLite — coexist on one machine. No Kubernetes, no managed databases, no multi-server orchestration.

---

## Phase 1: Core Agent System (4–6 weeks)

> **Deliverable:** Slack bot that creates agents, runs tasks in Docker containers, with superadmin access, job queue, and permissions.

### Step 1.1 — Module 1: Agent Management

- [ ] Implement `/new-agent` conversational wizard in Slack (name → persona → tools → permissions → model → confirm)
- [ ] Create dedicated `#agent-[name]` channel per agent
- [ ] Configure custom bot identity per agent (name + emoji avatar via `chat:write.customize`)
- [ ] Store agent config in SQLite with full version history
- [ ] Implement `/agents` command to list all active agents with channel links and status
- [ ] Reject duplicate agent names with clear error
- [ ] Handle failure modes: Slack rate limits, SQLite transaction rollback, wizard timeout

**Acceptance Criteria:**
- `/new-agent` wizard completes end-to-end, channel created in < 10 seconds
- Agent appears in `/agents` list immediately after creation
- Version history row written on every config change with correct `changed_by` attribution

### Step 1.2 — Module 2: Task Execution (Claude Agent SDK + BullMQ + Docker)

- [ ] Set up BullMQ job queue backed by Redis with three priority queues (high/normal/low)
- [ ] Implement worker processes (default: 3) that consume queue and spawn Docker containers
- [ ] Build Docker base image (`tinyhands-runner`) with Node.js + Claude Agent SDK + CLI tools
- [ ] Configure ephemeral Docker containers per run: filesystem isolation, network restrictions, secret injection
- [ ] Stream SDK events to Slack (1.5s buffer to respect Slack rate limits)
- [ ] Implement job timeout (default 10 min), retry policy, and dead letter queue
- [ ] Record per-run data: agent, channel, thread_ts, input, output, status, tokens, cost, duration, trace_id, job_id, model
- [ ] Implement token bucket rate limiter in Redis for Anthropic API (TPM/RPM tracking)
- [ ] Add backpressure: pause high-priority queue at 90% bucket consumption
- [ ] Handle failure modes: Docker OOM, Redis unavailable, SDK hang watchdog, Anthropic 429, maxTurns exceeded

**Acceptance Criteria:**
- Agent run completes end-to-end inside Docker with output posted to Slack
- First thinking event appears in Slack within 3 seconds
- 3 concurrent agent runs complete without interference
- Job timeout kills container and posts error within 5 seconds
- Container filesystem destroyed after run; no state leaks
- System never exceeds Anthropic API rate limits (zero 429s under normal operation)

### Step 1.3 — Module 8: Permissions & Isolation

- [ ] Implement three-axis permission model:
  - **Tool Access:** Read-only / Standard / Full
  - **Integration Access:** read / write / admin per skill
  - **Process Isolation:** Docker containers as primary security boundary
- [ ] Configure `disallowedTools` enforcement per permission level
- [ ] Implement container-level isolation: no host filesystem/network access, agent-specific env vars only, OOM kills container not host
- [ ] Target < 2 second Docker overhead on run startup

**Acceptance Criteria:**
- Read-only agent cannot write, bash, or modify external systems
- Container cannot access host filesystem, network, or other agent data
- OOM kills container cleanly; host unaffected

### Step 1.4 — Module 17: Per-Agent Ownership & Access Control

- [ ] First DM to bot establishes superadmin (no config wizard)
- [ ] Implement `add @user as superadmin` via DM
- [ ] Implement `add @user as admin` in agent channel
- [ ] Enforce role checks on every modification (superadmin > owner > admin > member)

**Acceptance Criteria:**
- First DM establishes superadmin; second DM from different user rejected
- Non-admin cannot modify agent config, connections, or triggers

---

## Phase 2: Knowledge & Self-Improvement (4–6 weeks)

> **Deliverable:** Self-improvement, retrieval-based sources, KB with FTS5, ingestion wizard.

### Step 2.1 — Module 3: Agent Self-Improvement

- [ ] Detect critique in agent threads ("why did you do X", "that's wrong", "fix your approach")
- [ ] Agent analyses: system prompt + run output + critique → proposes targeted diff to system prompt
- [ ] Auto-apply change (no approval gate), post what changed
- [ ] Retain full version history in DB, support "revert" command
- [ ] Warn if prompt grows beyond 4000 tokens, suggest consolidation

**Acceptance Criteria:**
- Critique produces diff posted in < 30 seconds
- New version row created with correct diff
- "revert" restores previous version and confirms in thread

### Step 2.2 — Module 4: Source Connections (Retrieval-Based)

- [ ] Implement conversational connect: "connect to github.com/org/repo"
- [ ] Build ingestion pipeline: Fetch → Chunk (~500 tokens, 50-token overlap) → FTS5 Index
- [ ] Support source types: GitHub, Google Drive, local path, Slack file upload
- [ ] Implement retrieval at run time: FTS5 MATCH query → top 20 chunks → dedupe → inject as "Relevant Context" (capped at 8,000 tokens)
- [ ] Incremental sync every 15 minutes (content hash comparison)
- [ ] Connection management: "show connections", "disconnect [source]", "reindex [source]"

**Sub-step 4b: Agent Memory Across Runs**
- [ ] Per-agent `memory_enabled` flag (default: false)
- [ ] End-of-run extraction: 0–5 key facts stored in `agent_memory` table
- [ ] FTS5 retrieval of top 10 memories on run start (2,000 token budget)
- [ ] Memory cap: 500 per agent, oldest pruned. Support "forget X" command.

**Acceptance Criteria:**
- GitHub repo with 500+ files indexes in < 60 seconds
- Retrieval query returns relevant chunks in < 200ms
- Agent with memory recalls facts from prior runs without explicit prompting

### Step 2.3 — Module 7: Shared Knowledge Base

- [ ] Manual ingestion: `/kb add` or file upload triggers ingestion wizard (Module 13)
- [ ] Agent-contributed: agent proposes after run, user approves
- [ ] FTS5 search (shared infrastructure with source connections), sharing token budget
- [ ] KB entry schema: title, summary, content, category (2-level), tags[], access_scope, source_type, embedding (reserved for RAG upgrade)

**Acceptance Criteria:**
- KB entry searchable within 2 seconds of creation
- Agent-contributed entry requires approval
- Access scoping enforced correctly

### Step 2.4 — Module 13: KB Ingestion Wizard

- [ ] Manual flow: AI generates title/summary/category/tags → user confirms or edits → save
- [ ] Agent-contributed flow: auto-generated metadata → approve/dismiss
- [ ] Two-level category hierarchy (top-level in config, subcategories on first use)

**Acceptance Criteria:**
- AI metadata appears within 5 seconds
- Confirm saves and indexes in 2 seconds

---

## Phase 3: Tool & Model Management (1–2 weeks)

> **Deliverable:** Conversational tool management and per-agent model selection.

### Step 3.1 — Module 11: Tool Management via Slack

- [ ] Add tools conversationally: "add web_search to this agent"
- [ ] Support three tool types: Claude Code built-ins, MCP server tools, custom code tools
- [ ] Custom tool registration restricted to admin-only
- [ ] Tools run inside Docker container

**Acceptance Criteria:**
- Tool added conversationally available in next run
- Non-admin custom tool registration rejected with clear message

### Step 3.2 — Module 18: Per-Agent Model Selection

- [ ] Set model at creation (wizard step), change conversationally, override per task
- [ ] Support: opus (complex reasoning), sonnet (default), haiku (fast/cheap)
- [ ] Warn on haiku selection (no thinking traces)

---

## Phase 4: Triggers & Workflows (3–5 weeks)

> **Deliverable:** Event triggers, BullMQ workflow persistence, idempotency.

### Step 4.1 — Module 5: Event Triggers

- [ ] Conversational trigger config: "trigger this agent when a new message arrives in #support-inbound"
- [ ] Support trigger types: Slack channel, Linear webhook, Zendesk/Intercom webhook, generic POST endpoint
- [ ] Normalize event payload into task prompt
- [ ] Deduplication: idempotency key + 5-min Redis cache window
- [ ] Slack triggers: reply in-thread. Webhook triggers: post in agent channel with source link.
- [ ] Trigger storm protection: auto-pause at 100+ events/min, alert to #tinyhands

**Acceptance Criteria:**
- Slack trigger fires agent run within 2 seconds of message
- Webhook with valid signature starts run; invalid returns 401
- Duplicate events within 5 min dropped silently
- Paused trigger does not fire; resumed trigger fires on next event

### Step 4.2 — Module 15: Conditional Multi-Step Workflows

- [ ] Implement stateful workflows: steps as BullMQ jobs, timers via delayed jobs, branching, human-in-the-loop
- [ ] Workflow state in `workflow_runs` table (workflow_id, run_id, current_step, step_state, waiting_for, status)
- [ ] Side effects logged in `side_effects_log` — duplicates skipped on retry
- [ ] PM2 restart recovery: jobs persist in Redis, workers resume cleanly

**Acceptance Criteria:**
- 3-step workflow with 5-min timer completes end-to-end
- PM2 restart during timer wait resumes correctly
- No duplicate side effects on retry
- Human-in-the-loop step pauses and resumes on action

---

## Phase 5: Skills & Document Filling (2–3 weeks)

> **Deliverable:** MCP skill marketplace and document-filling agent pattern.

### Step 5.1 — Module 6: Skill Marketplace

**6a. MCP Server Skills (Integration Skills)**
- [ ] Attach conversationally: "add Linear skill to this agent"
- [ ] Permission level per attachment: read-only or read-write
- [ ] Built-in MCP skills: Linear, Zendesk, Notion, Slack, GitHub

**6b. Prompt Template Skills (Behaviour Skills)**
- [ ] Stored in registry, versioned independently
- [ ] Composable — multiple skills layered onto base persona
- [ ] Built-in: company-research, ticket-triage, code-review, lead-enrichment, document-filling

**Acceptance Criteria:**
- MCP skill attaches and is available in next run
- Prompt skill composes without conflicts

### Step 5.2 — Module 14: Document-Filling Agent Pattern

- [ ] Extract fields from template, query KB per field, fill confidently, flag gaps
- [ ] Return filled file + gap summary in Slack thread
- [ ] Support: Google Sheets, Google Docs, uploaded .xlsx, uploaded .docx

**Acceptance Criteria:**
- 20-field template filled in < 60 seconds
- Unfilled fields flagged with reason
- Original formatting preserved

---

## Phase 6: Dashboard & Observability (2–3 weeks)

> **Deliverable:** Slack Home Tab dashboard, structured logging, alerting, cost tracking.

### Step 6.1 — Module 9: Slack Home Tab Dashboard

- [ ] Sections: Agent Fleet, Recent Runs, Source Sync Health, Trigger Activity, KB, Queue Health, Usage Overview
- [ ] Stay under 50KB Block Kit limit with pagination + collapsible sections (for 30+ agents)

**Acceptance Criteria:**
- Dashboard renders in < 2 seconds
- Updates within 5 seconds of run completing

### Step 6.2 — Module 10: Usage, Cost Tracking & Observability

- [ ] Structured JSON logs to stdout with trace_id correlating: Slack message, BullMQ job, Docker container, SDK events
- [ ] Per-run metrics: tokens, cost, duration, queue wait, context injected, tool calls, model
- [ ] Alerting: error rate > 10%, single run cost > $5, daily spend over budget, queue depth > 50, run duration anomaly
- [ ] Dashboard metrics: 30-day totals, by agent, by user, by model, run counts, p50/p95/p99 durations, error rates
- [ ] Daily digest: yesterday's stats, agents with >10% error rate, anomalous cost agents

**Acceptance Criteria:**
- Every run produces complete structured log with trace_id
- trace_id visible in Slack thread, BullMQ metadata, container logs
- Alert fires within 60 seconds of threshold breach
- Daily digest posts at configured time with accurate metrics

---

## Phase 7: Self-Evolution & Auto-Deploy (2–3 weeks)

> **Deliverable:** Auto-deploy from GitHub, agent self-evolution with approve-first mode.

### Step 7.1 — Module 12: Server Auto-Update via GitHub Webhook

- [ ] GitHub webhook fires on push to main → POST /webhooks/github-deploy
- [ ] Verify signature with `GITHUB_WEBHOOK_SECRET`
- [ ] `git pull` → `npm install` if package.json changed → Docker rebuild if Dockerfile changed → `pm2 reload`
- [ ] In-flight jobs complete before workers restart (BullMQ graceful shutdown)
- [ ] Post deploy summary to #tinyhands: commit hash, changed files, restart time

**Acceptance Criteria:**
- Push to main triggers deploy within 30 seconds
- Invalid signature rejected 401
- In-flight runs complete before restart

### Step 7.2 — Module 16: Agent Self-Evolution

- [ ] Agent actions: write new tool, create MCP integration, commit code, update own prompt, add to KB
- [ ] Two modes per agent:
  - **Autonomous** (default): acts immediately, posts what it did
  - **Approve-first**: posts proposal, waits 30 min for approval
- [ ] Every action has git commit + structured log

**Acceptance Criteria:**
- Autonomous: tool written and registered end-to-end in < 60 seconds
- Approve-first: waits for approval; timeout means no action

---

## Phase 8: Agent Teams (2–3 weeks)

> **Deliverable:** Agents spawn sub-agents for parallel/delegated work.

### Step 8.1 — Module 19: Agent Teams

- [ ] Lead agent uses `Agent` tool to spawn sub-agents (Claude Agent SDK native Agent Teams)
- [ ] Sub-agents run in separate Docker containers with inherited (but never elevated) permissions
- [ ] Parallel execution with BullMQ jobs per sub-agent
- [ ] Slack presentation: lead's thread shows progress, sub-agent work in nested replies
- [ ] Limits: max 3 concurrent sub-agents (configurable), max spawn depth 2
- [ ] Team cost attributed to lead agent's run

**Acceptance Criteria:**
- Lead spawns 2 parallel sub-agents; both complete and return results
- Sub-agents in separate containers with correct permissions
- Recursive spawn beyond depth 2 rejected

---

## Timeline Summary

| Phase | Modules | Duration (1 eng) |
|-------|---------|-------------------|
| 1 — Core Agent System | 1, 2, 8, 17 | 4–6 weeks |
| 2 — Knowledge & Self-Improvement | 3, 4, 7, 13 | 4–6 weeks |
| 3 — Tool & Model Management | 11, 18 | 1–2 weeks |
| 4 — Triggers & Workflows | 5, 15 | 3–5 weeks |
| 5 — Skills & Document Filling | 6, 14 | 2–3 weeks |
| 6 — Dashboard & Observability | 9, 10 | 2–3 weeks |
| 7 — Self-Evolution & Auto-Deploy | 12, 16 | 2–3 weeks |
| 8 — Agent Teams | 19 | 2–3 weeks |

**Total: 20–31 weeks (5–8 months) with 1 senior engineer.**
**With 2 engineers: 12–18 weeks (3–4.5 months)** — Phases 2–8 heavily parallelizable.

---

## Infrastructure Requirements

### Recommended VPS Spec

| Resource | Minimum (5 agents) | Recommended (20+ agents) |
|----------|---------------------|--------------------------|
| CPU | 4 vCPUs | 8 vCPUs |
| RAM | 8 GB | 16 GB |
| Disk | 40 GB SSD | 100 GB SSD |
| OS | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |
| Docker | Docker CE 24+ | Docker CE 24+ |
| Network | Public IP + port 3000 | Public IP + port 3000 |

### Tech Stack

| Component | Technology |
|-----------|------------|
| Slack interface | Bolt for Node.js (Socket Mode) |
| Webhook receiver | Express HTTP (port 3000) |
| Agent runner | Claude Agent SDK in Docker |
| Job queue | BullMQ + Redis |
| Rate limiter | Token bucket in Redis |
| Agent registry | SQLite + versioned prompt history |
| Context retrieval | SQLite FTS5 |
| Agent memory | SQLite `agent_memory` table |
| Process management | PM2 |
| Container runtime | Docker (ephemeral per run) |
| Self-update | GitHub webhook → auto-deploy |
| Observability | Structured JSON logs + trace IDs |

---

## Testing Strategy

Three-layer testing. Every module must have all three layers passing.

| Layer | Framework | Trigger | Target |
|-------|-----------|---------|--------|
| Unit | Vitest | Every commit (GitHub Actions) | 90% line coverage (non-Slack, non-Docker) |
| Integration | Vitest + Testcontainers | Every PR | BullMQ lifecycle, Docker isolation, rate limiter, workflows |
| E2E Smoke | Custom Slack test harness | Nightly + pre-release | Agent lifecycle, source connection, trigger round-trip |

---

## Open Decisions

| # | Decision | Blocks |
|---|----------|--------|
| 1 | VPS provider (EC2 vs Hetzner vs other) | Module 5 |
| 2 | MCP server hosting (self-hosted vs managed) | Module 6a |
| 3 | KB search upgrade threshold (FTS5 → RAG) | Module 7 |
| 4 | Custom tool admin list scope | Module 11 |
| 5 | Drive write access scope | Module 14 |
| 6 | Redis hosting (local vs Upstash) | Modules 2, 15 |

## Explicit Out of Scope (v1)

- Scheduled/cron runs (triggers + Slack reminders cover most cases)
- Web UI outside Slack (single interface by design)
- Vector embeddings (FTS5 handles expected size; schema ready for upgrade)
- Multi-workspace Slack
- Per-user credentials
- Binary/PDF/spreadsheet KB sources
- Mandatory approval on self-evolution (approve-first mode available per agent)
- Hybrid semantic search (FTS5-only pragmatic for v1)
