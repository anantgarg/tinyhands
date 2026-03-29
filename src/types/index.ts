// ── Agent Types ──

export type AgentStatus = 'active' | 'paused' | 'error' | 'archived';
export type ModelAlias = 'opus' | 'sonnet' | 'haiku';
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';
export type SelfEvolutionMode = 'autonomous' | 'approve-first';
export type AccessRole = 'superadmin' | 'owner' | 'admin' | 'member';
export type IntegrationAccess = 'read' | 'write' | 'admin';
export type AgentVisibility = 'public' | 'private';

// ── Unified Access Model Types ──

export type PlatformRole = 'superadmin' | 'admin' | 'member';
export type AgentAccessLevel = 'owner' | 'member' | 'viewer' | 'none';
export type WritePolicy = 'auto' | 'confirm' | 'admin_confirm' | 'deny';

export interface AgentRoleRecord {
  agent_id: string;
  user_id: string;
  role: AgentAccessLevel;
  granted_by: string;
  granted_at: string;
  workspace_id: string;
}

export interface PlatformRoleRecord {
  workspace_id: string;
  user_id: string;
  role: PlatformRole;
  granted_by: string;
  granted_at: string;
}

export interface WorkspaceSetting {
  workspace_id: string;
  key: string;
  value: string;
  updated_by: string | null;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  channel_id: string;
  channel_ids: string[];
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
  respond_to_all_messages: boolean;
  mentions_only: boolean;
  visibility: AgentVisibility;
  default_access: AgentAccessLevel;
  write_policy: WritePolicy;
  relevance_keywords: string[];
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
  conversation_trace?: string;
}

export interface ToolCallRecord {
  id: string;
  run_id: string;
  workspace_id: string;
  tool_name: string;
  tool_input: Record<string, unknown> | null;
  tool_output: string | null;
  error: string | null;
  duration_ms: number;
  sequence_number: number;
  created_at: string;
}

export interface JobData {
  workspaceId: string;
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
  statusMessageTs?: string;
  /** When true, strip write tools from the agent — used for viewer-level access */
  readOnly?: boolean;
}

// ── Source Connection Types ──

export type SourceType = 'github' | 'google_drive' | 'local' | 'slack_upload';
export type SourceStatus = 'active' | 'error' | 'syncing';

export interface Source {
  id: string;
  workspace_id: string;
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

export type MemoryCategory = 'customer_preference' | 'decision' | 'context' | 'technical' | 'general' | 'preference' | 'procedure' | 'correction' | 'entity';

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

export type KBSourceType = 'manual' | 'agent' | 'google_drive' | 'zendesk_help_center' | 'website' | 'github' | 'hubspot_kb' | 'linear_docs';

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
  kb_source_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── KB Source Types ──

export type KBSourceStatus = 'active' | 'syncing' | 'error' | 'needs_setup';
export type KBProviderType = 'google' | 'zendesk' | 'firecrawl' | 'github' | 'hubspot' | 'linear';
export type KBConnectorType = 'google_drive' | 'zendesk_help_center' | 'website' | 'github' | 'hubspot_kb' | 'linear_docs';

export interface KBSource {
  id: string;
  name: string;
  source_type: KBConnectorType;
  config_json: string;
  status: KBSourceStatus;
  auto_sync: boolean;
  sync_interval_hours: number;
  last_sync_at: string | null;
  entry_count: number;
  error_message: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface KBApiKey {
  id: string;
  provider: KBProviderType;
  config_json: string;
  setup_complete: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ── Trigger Types ──

export type TriggerType = 'slack_channel' | 'linear' | 'zendesk' | 'intercom' | 'webhook' | 'schedule';
export type TriggerStatus = 'active' | 'paused';

export interface Trigger {
  id: string;
  workspace_id: string;
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
  workspace_id: string;
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

export interface AgentMember {
  agent_id: string;
  user_id: string;
  added_by: string;
  added_at: string;
}

export interface DmConversation {
  id: string;
  user_id: string;
  agent_id: string;
  dm_channel_id: string;
  thread_ts: string;
  created_at: string;
  last_active_at: string;
}

// ── Tool Management Types ──

export type ToolType = 'builtin' | 'mcp' | 'custom';

export type ToolAccessLevel = 'read-only' | 'read-write';

export interface CustomTool {
  id: string;
  name: string;
  tool_type: ToolType;
  schema_json: string;
  script_code: string | null;
  script_path: string | null;
  language: 'javascript' | 'python' | 'bash';
  registered_by: string;
  approved: boolean;
  access_level: ToolAccessLevel;
  config_json: string;
  created_at: string;
}

export interface AuthoredSkill {
  id: string;
  agent_id: string;
  name: string;
  description: string;
  skill_type: 'prompt_template' | 'tool_chain';
  template: string;
  version: number;
  approved: boolean;
  created_at: string;
  updated_at: string;
}

export interface McpConfig {
  id: string;
  agent_id: string;
  name: string;
  config_json: string;
  approved: boolean;
  created_at: string;
  updated_at: string;
}

export interface CodeArtifact {
  id: string;
  agent_id: string;
  file_path: string;
  content: string;
  language: string;
  proposal_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
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

// ── Upgrade Request Types ──

export interface UpgradeRequest {
  id: string;
  workspace_id: string;
  agent_id: string;
  user_id: string;
  requested_role: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'denied';
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

// ── Connection Types ──

export type ConnectionType = 'team' | 'personal';
export type ConnectionMode = 'team' | 'delegated' | 'runtime';
export type ConnectionStatus = 'active' | 'revoked' | 'expired';

export interface Connection {
  id: string;
  workspace_id: string;
  integration_id: string;
  connection_type: ConnectionType;
  user_id: string | null;
  label: string;
  credentials_encrypted: string;
  credentials_iv: string;
  status: ConnectionStatus;
  oauth_refresh_token_encrypted: string | null;
  oauth_token_expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AgentToolConnection {
  id: string;
  workspace_id: string;
  agent_id: string;
  tool_name: string;
  connection_mode: ConnectionMode;
  connection_id: string | null;
  configured_by: string;
  created_at: string;
}

export interface OAuthState {
  state: string;
  workspace_id: string;
  user_id: string;
  integration_id: string;
  redirect_channel_id: string | null;
  created_at: string;
  expires_at: string;
}

// ── Audit Log Types ──

export type AuditActionType =
  | 'tool_invocation' | 'agent_config_change' | 'role_change'
  | 'connection_created' | 'connection_deleted' | 'upgrade_approved'
  | 'upgrade_denied' | 'agent_created' | 'agent_deleted' | 'platform_role_changed';

export interface AuditLogEntry {
  id: string;
  workspace_id: string;
  timestamp: string;
  actor_user_id: string;
  actor_role: string;
  action_type: AuditActionType;
  agent_id: string | null;
  agent_name: string | null;
  tool_name: string | null;
  connection_id: string | null;
  target_user_id: string | null;
  details_json: string;
  run_id: string | null;
  trace_id: string | null;
  channel_id: string | null;
  status: string;
  error_message: string | null;
}
