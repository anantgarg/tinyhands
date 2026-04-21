# Connections API

**Base Path**: `/api/v1/connections`

## Endpoints

### List Team Connections
`GET /team` — Admin only. Workspace-wide credential connections.

### List Personal Connections
`GET /personal` — Required auth. Current user's personal connections.

### Create Team Connection
`POST /team` — Admin only. Body: `{ integrationId, credentials, label? }`

### Create Personal Connection
`POST /personal` — Required auth. Body: `{ integrationId, credentials, label? }`

### Update Connection Settings
`PATCH /:id/settings` — Required (owner). Body: `{ rootFolderId?, rootFolderName? }`

### Delete Connection
`DELETE /:id` — Required (owner).

### Get Tool-Agent Usage Map
`GET /agent-tool-usage` — Admin only.

### List Agent Tool Connections
`GET /agent/:agentId` — Required auth.

### Set Agent Tool Connection Mode
`PUT /agent/:agentId/:toolName` — Required (can modify). Body: `{ mode, connectionId? }`

### Start OAuth Flow
`GET /oauth/:integration/start` — Required auth. Redirects to the provider using the workspace's per-workspace OAuth app credentials. Returns `409 { needsSetup: true, setupUrl }` when the workspace has no OAuth app configured for that provider (Google today).

### List OAuth Integrations
`GET /oauth-integrations` — Optional auth.

### Workspace OAuth App Credentials (plan-015)
Per-workspace OAuth client credentials for third-party providers. Today only `google` is wired; `notion` and `github` are reserved but still use platform-wide env vars.

`GET /workspace-oauth-apps/:provider` — Admin only. Returns `{ configured, clientIdMasked, publishingStatus, configuredAt }`. Never returns the secret.

`PUT /workspace-oauth-apps/:provider` — Admin only. Body: `{ clientId, clientSecret, publishingStatus? }`.

`DELETE /workspace-oauth-apps/:provider` — Admin only.

`POST /workspace-oauth-apps/:provider/test` — Admin only. Builds an auth URL and HEAD-requests `accounts.google.com` to surface `invalid_client_or_redirect` without requiring a full user consent round-trip.

### Agent Tool Modes (Admin)
`GET /agent-tool-modes` — List all agent tool modes
`PUT /agent-tool-modes/:agentId/:toolName` — Set mode. Body: `{ mode, connectionId? }`

### Check Connection Availability
`GET /agent/:agentId/availability` — Required auth.

### Count Expired Connections
`GET /expired-count` — Required auth. Returns `{ count }`.
