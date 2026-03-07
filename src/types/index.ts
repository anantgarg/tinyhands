// ── Agent Types ──

export type AgentStatus = 'active' | 'paused' | 'error' | 'archived';
export type PermissionLevel = 'read-only' | 'standard' | 'full';
export type ModelAlias = 'opus' | 'sonnet' | 'haiku';
export type SelfEvolutionMode = 'autonomous' | 'approve-first';
export type AccessRole = 'superadmin' | 'owner' | 'admin' | 'member';
export type IntegrationAccess = 'read' | 'write' | 'admin';

export interface Agent {
  id: string;
  name: string;
  channel_id: string;
  system_prompt: string;
  tools: string[];
  avatar_emoji: string;
  status: AgentStatus;
  model: ModelAlias;
  streaming_detail: boolean;
  docker_image: string | null;
  self_evolution_mode: SelfEvolutionMode;
  max_turns: number;
  memory_enabled: boolean;
  permission_level: PermissionLevel;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AgentVersion {
  id: string;
  agent_id: string;
  version: number;
  system_prompt: string;
  change_note: string;
  changed_by: string;
  created_at: string;
}

// ── Task Execution Types ──

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout';
export type QueuePriority = 'high' | 'normal' | 'low';

export interface RunRecord {
  id: string;
  agent_id: string;
  channel_id: string;
  thread_ts: string;
  input: string;
  output: string;
  status: RunStatus;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  duration_ms: number;
  queue_wait_ms: number;
  context_tokens_injected: number;
  tool_calls_count: number;
  trace_id: string;
  job_id: string;
  model: ModelAlias;
  slack_user_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface JobData {
  agentId: string;
  channelId: string;
  threadTs: string;
  input: string;
  userId: string | null;
  traceId: string;
  modelOverride?: ModelAlias;
  triggerId?: string;
  workflowRunId?: string;
  workflowStepIndex?: number;
}

// ── Source Connection Types ──

export type SourceType = 'github' | 'google_drive' | 'local' | 'slack_upload';
export type SourceStatus = 'active' | 'error' | 'syncing';

export interface Source {
  id: string;
  agent_id: string;
  source_type: SourceType;
  uri: string;
  label: string;
  status: SourceStatus;
  last_sync_at: string | null;
  chunk_count: number;
  error_message: string | null;
  created_at: string;
}

export interface SourceChunk {
  id: string;
  source_id: string;
  agent_id: string;
  file_path: string;
  chunk_index: number;
  content: string;
  content_hash: string;
  metadata_json: string;
}

// ── Agent Memory Types ──

export type MemoryCategory = 'customer_preference' | 'decision' | 'context' | 'technical' | 'general';

export interface AgentMemory {
  id: string;
  agent_id: string;
  run_id: string;
  fact: string;
  category: MemoryCategory;
  relevance_score: number;
  created_at: string;
}

// ── Knowledge Base Types ──

export type KBSourceType = 'manual' | 'agent';

export interface KBEntry {
  id: string;
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
  access_scope: string[] | 'all';
  source_type: KBSourceType;
  contributed_by: string | null;
  approved: boolean;
  created_at: string;
  updated_at: string;
}

// ── Trigger Types ──

export type TriggerType = 'slack_channel' | 'linear' | 'zendesk' | 'intercom' | 'webhook';
export type TriggerStatus = 'active' | 'paused';

export interface Trigger {
  id: string;
  agent_id: string;
  trigger_type: TriggerType;
  config_json: string;
  status: TriggerStatus;
  created_by: string;
  created_at: string;
}

// ── Skill Types ──

export type SkillType = 'mcp' | 'prompt_template';

export interface Skill {
  id: string;
  name: string;
  skill_type: SkillType;
  config_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AgentSkill {
  agent_id: string;
  skill_id: string;
  permission_level: IntegrationAccess;
  attached_by: string;
  attached_at: string;
}

// ── Workflow Types ──

export type WorkflowStatus = 'running' | 'waiting' | 'completed' | 'failed';
export type WaitingFor = 'timer' | 'human_action' | 'channel_event' | null;

export interface WorkflowDefinition {
  id: string;
  name: string;
  agent_id: string;
  steps_json: string;
  created_by: string;
  created_at: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  run_id: string;
  current_step: number;
  step_state: string;
  waiting_for: WaitingFor;
  wait_until: string | null;
  status: WorkflowStatus;
  created_at: string;
  updated_at: string;
}

export interface SideEffect {
  id: string;
  workflow_run_id: string;
  step_id: string;
  attempt_number: number;
  effect_type: string;
  effect_data: string;
  created_at: string;
}

// ── Access Control Types ──

export interface AgentAdmin {
  agent_id: string;
  user_id: string;
  role: 'owner' | 'admin';
  granted_by: string;
  granted_at: string;
}

export interface Superadmin {
  user_id: string;
  granted_by: string;
  granted_at: string;
}

// ── Tool Management Types ──

export type ToolType = 'builtin' | 'mcp' | 'custom';

export interface CustomTool {
  id: string;
  name: string;
  tool_type: ToolType;
  schema_json: string;
  script_path: string | null;
  registered_by: string;
  created_at: string;
}

// ── Dashboard Types ──

export interface DashboardMetrics {
  totalTokens: number;
  totalCostUsd: number;
  totalRuns: number;
  errorRate: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  queueWaitP50Ms: number;
  queueWaitP95Ms: number;
  tokensByAgent: Record<string, number>;
  tokensByUser: Record<string, number>;
  tokensByModel: Record<ModelAlias, number>;
  runsByAgent: Record<string, number>;
}

// ── Observability Types ──

export interface StructuredLog {
  trace_id: string;
  agent_id: string;
  job_id: string;
  event_type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'done' | 'error';
  timestamp: string;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ── Alert Types ──

export type AlertCondition = 'error_rate' | 'single_run_cost' | 'daily_spend' | 'queue_depth' | 'run_duration';

export interface AlertRule {
  condition: AlertCondition;
  threshold: number;
  action: string;
}

// ── Document Filling Types ──

export interface TemplateField {
  name: string;
  value: string | null;
  confidence: number;
  source: string | null;
  unfilled_reason: string | null;
}

export type DocumentType = 'google_sheets' | 'google_docs' | 'xlsx' | 'docx';

// ── Self-Evolution Types ──

export type EvolutionAction = 'write_tool' | 'create_mcp' | 'commit_code' | 'update_prompt' | 'add_to_kb';

export interface EvolutionProposal {
  id: string;
  agent_id: string;
  action: EvolutionAction;
  description: string;
  diff: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  created_at: string;
  resolved_at: string | null;
}

// ── Team Types ──

export interface TeamRun {
  id: string;
  lead_agent_id: string;
  lead_run_id: string;
  sub_agents: SubAgentRun[];
  max_concurrent: number;
  max_depth: number;
  created_at: string;
}

export interface SubAgentRun {
  id: string;
  team_run_id: string;
  agent_id: string;
  run_id: string;
  depth: number;
  status: RunStatus;
  task: string;
  result: string | null;
}
