import type { ToolManifest } from '../manifest';

/**
 * Legacy Google Workspace integration — kept for backward compatibility.
 *
 * This integration has been split into 4 separate integrations:
 *   - google-drive  (search, list, metadata, download, create folder, move, upload)
 *   - google-sheets (read/write spreadsheet data)
 *   - google-docs   (read/create/update documents)
 *   - gmail         (search/read/send emails)
 *
 * tools: [] ensures no new tools are registered from this manifest.
 * Existing google-read / google-write tools in the database remain functional
 * until workspaces migrate to the new integrations.
 */

export const manifest: ToolManifest = {
  id: 'google',
  label: 'Google Workspace (Legacy)',
  icon: ':file_folder:',
  description: 'Legacy integration — use Google Drive, Google Sheets, Google Docs, or Gmail instead.',
  configKeys: ['access_token'],
  connectionModel: 'personal',
  tools: [],
  async register() {
    // No-op: no tools to register. Use the individual integrations instead.
  },
  async updateConfig() {
    // No-op: no tools to update. Use the individual integrations instead.
  },
};
