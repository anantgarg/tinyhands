# Knowledge Base API

**Base Path**: `/api/v1/kb`

## Endpoints

### Get KB Statistics
`GET /stats`
- **Auth**: Required
- **Response**: `{ totalEntries, pendingEntries, categories, sourcesCount, manualEntries }`
- `manualEntries` counts rows with `kb_source_id IS NULL` directly, so it stays consistent even while source-backed entry counts are in flight.

### List KB Entries
`GET /entries`
- **Auth**: Required
- **Query**: `page`, `limit`, `category`, `approved`, `search`, `sourceId`
- **Response**: `{ entries, total }`

### Search KB (Full-Text)
`GET /entries/search`
- **Auth**: Required
- **Query**: `q` (required), `agentId?`, `limit?`
- **Response**: Search results array

### List Categories
`GET /categories`
- **Auth**: Required
- **Response**: Category array

### Get KB Entry
`GET /entries/:id`
- **Auth**: Required
- **Response**: KB entry object

### Create KB Entry
`POST /entries`
- **Auth**: Required
- **Body**: `{ title, content, category, sourceType, ... }`
- **Response**: Created entry (201)

### Approve KB Entry
`POST /entries/:id/approve`
- **Auth**: Admin only
- **Response**: Approved entry

### Delete KB Entry
`DELETE /entries/:id`
- **Auth**: Admin only
- **Response**: `{ ok: true }`

### Update KB Entry
`PATCH /entries/:id`
- **Auth**: Admin only
- **Body**: `{ title?, content?, category? }`
- **Response**: Updated entry

## KB Sources

### List Sources
`GET /sources`
- **Auth**: Required
- **Response**: Sources array

### Create Source
`POST /sources`
- **Auth**: Admin only
- **Body**: `{ name, sourceType, config }`
- **Response**: Created source (201)

### Update Source
`PATCH /sources/:id`
- **Auth**: Admin only
- **Body**: `{ config?, ... }`
- **Response**: `{ ok: true }`

### Delete Source
`DELETE /sources/:id`
- **Auth**: Admin only
- **Response**: `{ ok: true }`

### Sync Source
`POST /sources/:id/sync`
- **Auth**: Admin only
- **Response**: `{ ok: true, message }`

### Flush and Resync
`POST /sources/:id/flush-and-resync`
- **Auth**: Admin only
- **Response**: `{ ok: true, message }`

## API Keys

### List API Keys
`GET /api-keys`
- **Auth**: Admin only

### Set API Key
`PUT /api-keys/:provider`
- **Auth**: Admin only
- **Body**: `{ config }`

### Delete API Key
`DELETE /api-keys/:provider`
- **Auth**: Admin only

## Google Drive

### List Drive Folders
`GET /drive-folders`
- **Auth**: Admin only
- **Query**: `parentId`
- **Response**: `{ parentId, folders }`
