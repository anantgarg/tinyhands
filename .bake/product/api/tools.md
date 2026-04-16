# Tools API

**Base Path**: `/api/v1/tools`

## Endpoints

### List Built-in Tools
`GET /builtin` — Optional auth. Returns builtin tools array.

### List Custom Tools
`GET /custom` — Admin only. Returns custom tools array.

### Get Custom Tool Detail
`GET /custom/:name` — Admin only. Returns tool object or 404.

### Register Custom Tool
`POST /custom` — Admin only.
- **Body**: `{ name, schemaJson/schema, scriptCode?, language?, accessLevel?, description? }`
- **Response**: Created tool (201)

### Approve Custom Tool
`POST /custom/:name/approve` — Admin only.

### Delete Custom Tool
`DELETE /custom/:name` — Admin only.

### Get/Set Tool Config
`GET /custom/:name/config` — Get config (admin only)
`PUT /custom/:name/config` — Update config (`{ configJson }`, admin only)
`PATCH /custom/:name/config` — Set single key (`{ key, value? }`, admin only)

### Update Access Level
`PUT /custom/:name/access-level` — Admin only. Body: `{ accessLevel }`

### List Available Tools
`GET /available` — Required auth. All tools available to the user.

### List Integrations
`GET /integrations` — Admin only. Integrations with connection status.

### Register Integration
`POST /integrations/register` — Admin only. Body: `{ integrationId, config }`

### Disconnect Integration
`DELETE /integrations/:id/disconnect` — Admin only.

### AI-Generate Tool
`POST /custom/generate` — Admin only. Body: `{ description, language? }`

### Test Custom Tool
`POST /custom/:name/test` — Admin only. Body: `{ code?, inputSchema? }`
- **Response**: `{ passed, output, error?, durationMs }`

### Tool Version History
`GET /custom/:name/versions` — Admin only.

### Rollback Tool
`POST /custom/:name/rollback` — Admin only. Body: `{ version }`

### Tool Analytics
`GET /custom/:name/analytics` — Admin only.
