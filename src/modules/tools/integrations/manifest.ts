/**
 * ToolManifest — the single interface every integration must export.
 *
 * To add a new tool, create a folder under src/modules/tools/integrations/<name>/
 * with an index.ts that exports `manifest` satisfying this interface.
 * The system auto-discovers it — no edits to other files required.
 */

export interface ToolDefinition {
  /** Tool name as stored in the database, e.g. "chargebee-read" */
  name: string;
  /** JSON-stringified JSON Schema for tool inputs */
  schema: string;
  /** JavaScript code that runs inside the Docker container */
  code: string;
  /** Whether this tool can write/mutate data */
  accessLevel: 'read-only' | 'read-write';
  /** Friendly status text shown in Slack while tool is running */
  displayName: string;
}

export interface ToolManifest {
  /** Unique identifier, e.g. "chargebee" */
  id: string;
  /** Human-readable label, e.g. "Chargebee" */
  label: string;
  /** Slack emoji, e.g. ":credit_card:" */
  icon: string;
  /** Short description for the integration picker UI */
  description: string;
  /** Config keys the admin must provide (e.g. ["api_key", "site"]) */
  configKeys: string[];
  /** Optional placeholder hints for config fields (key → placeholder text) */
  configPlaceholders?: Record<string, string>;
  /** Optional setup instructions shown in registration modal (Slack mrkdwn) */
  setupGuide?: string;
  /** Which credential modes this integration supports. Defaults to all three (team, delegated, runtime) if omitted. */
  supportedCredentialModes?: ('team' | 'delegated' | 'runtime')[];
  /** The tool definitions (read-only and optionally read-write) */
  tools: ToolDefinition[];
  /** Register both tools into the database */
  register(workspaceId: string, userId: string, config: Record<string, string>): Promise<void>;
  /** Update credentials for already-registered tools */
  updateConfig(workspaceId: string, config: Record<string, string>): Promise<void>;
}
