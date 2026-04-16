# Agents API

**Base Path**: `/api/v1/agents`

## Endpoints

### List Agents
`GET /`
- **Auth**: Required
- **Response**: Agent array with display names (filtered by user's role)

### Create Agent
`POST /`
- **Auth**: Required
- **Body**: Agent config fields (name, system_prompt, tools, model, etc.)
- **Response**: Created agent (201)

### Analyze Goal
`POST /analyze-goal`
- **Auth**: Required
- **Body**: `{ goal }` — natural language description
- **Response**: AI-generated agent configuration

### Get Pending Review Counts
`GET /pending-counts`
- **Auth**: Required
- **Response**: `{ upgrades, toolRequests, evolutionProposals, featureRequests, kbContributions, total }`

### Get Upgrade Requests
`GET /upgrade-requests`
- **Auth**: Required
- **Response**: Pending upgrade requests array

### Get Tool Requests
`GET /tool-requests`
- **Auth**: Required
- **Query**: `status?`
- **Response**: Tool requests array

### Get Feature Requests
`GET /feature-requests`
- **Auth**: Required
- **Response**: Feature requests from pending confirmations

### Dismiss Feature Request
`DELETE /feature-requests/:requestId`
- **Auth**: Required
- **Response**: `{ ok: true }`

### Get Agent Detail
`GET /:id`
- **Auth**: Required (can view)
- **Response**: Agent with channel names, user role, mentioned users

### Update Agent
`PATCH /:id`
- **Auth**: Required (can modify)
- **Body**: Agent fields to update
- **Response**: Updated agent

### Delete Agent
`DELETE /:id`
- **Auth**: Required (can modify)
- **Response**: `{ ok: true }` (soft-delete/archive)

### Get Version History
`GET /:id/versions`
- **Auth**: Required (can view)
- **Response**: Versions array

### Revert to Version
`POST /:id/revert`
- **Auth**: Required (can modify)
- **Body**: `{ version }`
- **Response**: Reverted agent

### Get Agent Tools
`GET /:id/tools`
- **Auth**: Required (can view)
- **Response**: Tool summary

### Add Tool to Agent
`POST /:id/tools`
- **Auth**: Required (can modify)
- **Body**: `{ toolName }`
- **Response**: `{ tools }` or pending approval

### Remove Tool
`DELETE /:id/tools/:toolName`
- **Auth**: Required (can modify)
- **Response**: `{ tools }`

### Get Agent Skills
`GET /:id/skills`
- **Auth**: Required (can view)
- **Response**: Skills array

### Attach Skill
`POST /:id/skills`
- **Auth**: Required (can modify)
- **Body**: `{ skillName, permissionLevel? }`
- **Response**: Agent skill object

### Detach Skill
`DELETE /:id/skills/:skillId`
- **Auth**: Required (can modify)
- **Response**: `{ ok: true }`

### Get Agent Runs
`GET /:id/runs`
- **Auth**: Required (can view)
- **Query**: `page`, `limit`, `status`
- **Response**: `{ runs, total }`

### Get Agent Memories
`GET /:id/memories`
- **Auth**: Required (can view)
- **Query**: `limit` (default 50)
- **Response**: Memories array

### Get Agent Roles
`GET /:id/roles`
- **Auth**: Required (can view)
- **Response**: Roles array with display names

### Set Agent Role
`POST /:id/roles`
- **Auth**: Required (can modify)
- **Body**: `{ targetUserId, role }`
- **Response**: `{ ok: true }`

### Remove Agent Role
`DELETE /:id/roles/:targetUserId`
- **Auth**: Required (can modify)
- **Response**: `{ ok: true }`

### Get Current User Access
`GET /:id/access`
- **Auth**: Required
- **Response**: `{ role }`

### Request Upgrade
`POST /:id/upgrade-requests`
- **Auth**: Required
- **Body**: `{ reason? }`
- **Response**: `{ id }` (201)

### Approve/Deny Upgrade
`POST /:id/upgrade-requests/:requestId/approve`
`POST /:id/upgrade-requests/:requestId/deny`
- **Auth**: Required (can modify)

### Get Agent Triggers
`GET /:id/triggers`
- **Auth**: Required (can view)
- **Response**: Triggers array

### Tool Request Management
`GET /:id/tool-requests` — List agent tool requests
`POST /:id/tool-requests` — Create tool request (`{ toolName, accessLevel?, reason? }`)
`POST /:id/tool-requests/:requestId/approve` — Approve (admin only)
`POST /:id/tool-requests/:requestId/deny` — Deny

### Prompt Improvement
`POST /:id/suggest-improvement` — Get AI suggestion (`{ feedback }`)
`POST /:id/apply-improvement` — Apply change (`{ newPrompt, changeNote? }`)

### Prompt Size Check
`GET /:id/prompt-size`
- **Auth**: Required (can view)
- **Response**: Token count info
