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
- **Response**: `{ ok: true }` on success. Returns `404` if the entry doesn't exist, and `409` if the entry has `kb_source_id` set — source-managed entries must be removed in the source folder and re-synced.

### Update KB Entry
`PATCH /entries/:id`
- **Auth**: Admin only
- **Body**: `{ title?, content?, category? }`
- **Response**: Updated entry. Returns `404` if the entry doesn't exist, and `409` if the entry has `kb_source_id` set — source-managed entries are read-only from the dashboard; edit in the source folder and re-sync.

## KB Sources

### List Sources
`GET /sources`
- **Auth**: Required
- **Response**: Sources array. Each row includes `skippedCount` (count of files in the skip log — drives the failures icon on the KB Sources row), `errorMessage` (plain-English translation of the last sync's failure), and `errorFix` (structured hint: `{ kind: 'reconnect', integration }` when the viewer can self-fix, `{ kind: 'ask_owner', integration, ownerName }` when someone else's personal connection is broken).

### Skip Log for a Source (plan-020)
`GET /sources/:id/skip-log`
- **Auth**: Required
- **Response**: Array of skipped files with `filename`, `filePath`, `mimeType`, `sizeBytes`, `reason`, `reasonLabel` (plain English — e.g. "File too large to index"), `message`, `firstSeenAt`, `lastSeenAt`. The dashboard opens a modal over this list when an admin clicks the failures icon on a source row. Rows disappear as soon as the file ingests successfully on a later sync.

### Re-parse Source (plan-020)
`POST /sources/:id/reparse`
- **Auth**: Admin only
- **Response**: `{ ok: true, message }`
- Flushes the source's existing entries and runs a fresh sync with current workspace parser settings. Use after turning Reducto on/off so existing files pick up the new settings; not triggered implicitly because it can use Reducto credits.

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
