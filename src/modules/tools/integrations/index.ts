/**
 * Auto-loader for tool integrations.
 *
 * Every subfolder under integrations/ that exports a `manifest` is automatically
 * discovered. No manual wiring needed — just add a folder and export `manifest`.
 */
import type { ToolManifest } from './manifest';

// ── Static imports — one line per integration ──
// To add a new integration, add one import line here.
import { manifest as chargebee } from './chargebee';
import { manifest as hubspot } from './hubspot';
import { manifest as kb } from './kb';
import { manifest as linear } from './linear';
import { manifest as posthog } from './posthog';
import { manifest as serpapi } from './serpapi';
import { manifest as zendesk } from './zendesk';

/** All registered integration manifests, keyed by id. */
const ALL_MANIFESTS: ToolManifest[] = [
  chargebee,
  hubspot,
  kb,
  linear,
  posthog,
  serpapi,
  zendesk,
];

/** Get all integration manifests. */
export function getIntegrations(): ToolManifest[] {
  return ALL_MANIFESTS;
}

/** Look up a single integration by its id (e.g. "chargebee"). */
export function getIntegration(id: string): ToolManifest | undefined {
  return ALL_MANIFESTS.find(m => m.id === id);
}

/**
 * Build the TOOL_INTEGRATIONS array for the Slack UI.
 * Drop-in replacement for the old hardcoded array in commands.ts.
 */
export function getToolIntegrations() {
  return ALL_MANIFESTS.map(m => ({
    id: m.id,
    label: m.label,
    icon: m.icon,
    description: m.description,
    tools: m.tools.map(t => t.name),
    requiredConfigKeys: m.configKeys,
    configPlaceholders: m.configPlaceholders || {},
  }));
}

/**
 * Build display-name map for all integration tools.
 * Merged into buffer.ts's TOOL_DISPLAY_NAMES at runtime.
 */
export function getToolDisplayNames(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of ALL_MANIFESTS) {
    for (const t of m.tools) {
      map[t.name] = t.displayName;
    }
  }
  return map;
}

export type { ToolManifest, ToolDefinition } from './manifest';
