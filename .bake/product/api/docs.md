# Documents API

**Base Path**: `/api/v1/docs`

## Endpoints

### Get Document Statistics
`GET /stats`
- **Auth**: Required
- **Response**: Stats object

### List Documents
`GET /`
- **Auth**: Required
- **Query**: `type`, `agentId`, `createdBy`, `tags`, `search`, `includeArchived`, `page`, `limit`
- **Response**: `{ documents, total }`

### Search Documents
`GET /search`
- **Auth**: Required
- **Query**: `q` (required), `limit`
- **Response**: Search results

### Create Document
`POST /`
- **Auth**: Required (agent owner)
- **Body**: `{ type, title, description?, content?, tags?, agentId }`
- **Response**: Created document (201)

### Upload File
`POST /upload`
- **Auth**: Required (agent owner)
- **Body**: Multipart — `file`, `agentId?`, `tags?`
- **Response**: Created document (201)

### Import CSV as Sheet
`POST /import-csv`
- **Auth**: Required (agent owner)
- **Body**: Multipart — `file`, `agentId?`, `title?`
- **Response**: Created sheet (201)

### Import DOCX as Doc
`POST /import-docx`
- **Auth**: Required (agent owner)
- **Body**: Multipart — `file`, `agentId?`, `title?`
- **Response**: Created doc (201)

### Get Document
`GET /:id`
- **Auth**: Required (can view)
- **Response**: Document with tabs (if sheet)

### Download File
`GET /:id/download`
- **Auth**: Required (can view)
- **Response**: Binary file

### Export Document
`GET /:id/export`
- **Auth**: Required (can view)
- **Query**: `format` (markdown / html / csv)
- **Response**: Exported file

### Replace File
`POST /:id/replace`
- **Auth**: Required (can modify)
- **Body**: Multipart — `file`
- **Response**: Updated document

### Update Document
`PATCH /:id`
- **Auth**: Required (can modify)
- **Body**: `{ title?, description?, content?, tags?, agentEditable?, expectedVersion }`
- **Response**: Updated document (optimistic concurrency via expectedVersion)

### Archive Document
`DELETE /:id`
- **Auth**: Required (can modify)
- **Response**: `{ ok: true }` (soft delete)

### Hard Delete
`DELETE /:id/permanent`
- **Auth**: Admin only
- **Response**: `{ ok: true }`

## Version History

### List Versions
`GET /:id/versions`
- **Auth**: Required (can view)

### Get Version
`GET /:id/versions/:version`
- **Auth**: Required (can view)

### Restore Version
`POST /:id/versions/:version/restore`
- **Auth**: Required (can modify)

## Sheet Tabs

### List Tabs
`GET /:id/tabs`
- **Auth**: Required (can view)

### Create Tab
`POST /:id/tabs`
- **Auth**: Required (can modify)
- **Body**: `{ name? }`

### Update Tab
`PATCH /:id/tabs/:tabId`
- **Auth**: Required (can modify)

### Delete Tab
`DELETE /:id/tabs/:tabId`
- **Auth**: Required (can modify)

### Reorder Tabs
`POST /:id/tabs/reorder`
- **Auth**: Required (can modify)
- **Body**: `{ tabIds }`

### Update Cells
`PATCH /:id/tabs/:tabId/cells`
- **Auth**: Required (can modify)
- **Body**: `{ cells }` (max 10,000 cells)

### Append Rows
`POST /:id/tabs/:tabId/rows`
- **Auth**: Required (can modify)
- **Body**: `{ rows }` (max 1,000 rows)
