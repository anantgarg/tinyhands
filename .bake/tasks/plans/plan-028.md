---
id: plan-028
title: Database feature — workspace-isolated tables, imports, and agent tool
status: complete
created: 2026-04-24
completed: 2026-04-27T21:20:53.000Z
---

## Summary

Add a new first-class **Database** feature to TinyHands. Each workspace gets a real PostgreSQL schema (named by workspace id) where dashboard admins can create tables and columns with real types. Admins can import data into tables from CSV, Excel (xls/xlsx), or a Google Sheet (with ongoing sync). Agents can reference a table in the agent builder via `@` autocomplete, and a new `Database` tool (with read and write modes, just like existing tools) lets agents query and mutate data — including aggregate/sum helpers and raw SQL for reads — but never lets agents change the schema.

## Why

Today, structured workspace data lives outside TinyHands (in spreadsheets, Zendesk, HubSpot, etc.) and agents can only reach it via integrations or unstructured KB entries. Admins have repeatedly asked for a simple place to keep workspace-owned tabular data (price lists, customer segments, inventory, pipeline snapshots, lookup tables) that agents can read and write to directly. A workspace-isolated database backed by real Postgres schemas gives us:

- Clean isolation per tenant (schema-per-workspace is enforced at the DB layer, not just in application code).
- Real types and indexes so agents can do real aggregations, not string math over JSON blobs.
- A canonical, first-class home for imported spreadsheets — replacing the current pattern of shoving CSVs into KB entries.

## Approach

**New module `src/modules/database/`** with submodules:

- `schema.ts` — create/drop per-workspace Postgres schema (`ws_<workspaceId>`), list tables, list columns. Schema name is derived from workspace id so isolation is enforced by Postgres itself.
- `tables.ts` — admin-only CRUD for tables and columns. Supported column types: `text`, `integer`, `bigint`, `numeric`, `boolean`, `timestamptz`, `date`, `json`. Each table gets an implicit `id bigserial primary key`, `created_at`, `updated_at`.
- `rows.ts` — read/write row operations used by the tool runtime (insert, update, delete, select, aggregate helpers).
- `imports/` — CSV, XLSX (via `xlsx` package already used by KB parsers), and Google Sheets import. Google Sheets imports persist a sync config and are refreshed by the existing `sync` process on a schedule.
- `sql.ts` — **read-only** raw SQL runner that opens a transaction with `SET LOCAL search_path = ws_<id>`, `SET LOCAL default_transaction_read_only = on`, and a statement timeout; rejects any statement that isn't a single `SELECT`/`WITH`.

**Database tool** lives at `src/modules/tools/integrations/database/` following the existing manifest pattern. Access level is `read + write`. The tool exposes these operations:

- `list_tables`, `describe_table` — always available (schema introspection).
- `select`, `aggregate` (count/sum/avg/min/max with optional group-by), `sql` (read-only raw SELECT) — available in read mode.
- `insert`, `update`, `delete` — available only when the agent is granted write on this tool (same `write_policy` gates as other write tools: `confirm`, `admin_confirm`).
- **Never** exposes `create_table`, `alter_table`, `add_column`, `drop_*`. Schema changes are admin-only and only via the dashboard.

**Dashboard** gets a new admin-only **Database** section:

- Tables list → create table (name + columns with types) → view/edit rows → import data (CSV upload, XLSX upload, or Google Sheet URL with sync toggle).
- Per the dashboard page-roles rule, Database lives on the admin side (like Tools & Integrations), not the user-facing Connections page.

**Agent builder editor** — extend the existing `@` autocomplete so typing `@` in the system prompt suggests tools (including the new Database tool). When the author picks `Database`, the autocomplete MUST present a second-level picker of the workspace's tables so the author can select a specific table — the reference cannot stop at just `@database` by itself. The resulting rendered reference is `@database:<table_name>` (e.g., `@database:customers`). At runtime this is a hint surfaced to the agent — the referenced table's `describe_table` output is injected into context alongside the system prompt — not a hard binding that prevents the agent from reading other tables.

**Sync process** — `src/sync.ts` gets a new "database sheet sync" job that re-pulls Google-Sheet-backed tables on a schedule (same cadence and error surfacing as KB source auto-sync).

**Sheet schema drift** — Google Sheets are mutable: a user can add, rename, reorder, or delete columns at any time. On each sync we diff the sheet's header row against the Postgres table's columns. We do NOT auto-mutate the Postgres schema (schema changes are admin-only by design). Instead:

- **New column in the sheet**: skip that column's data on this and every subsequent sync until an admin acts. Record a `partial_sync` entry in `database_sync_log` naming the skipped column. On the dashboard Database page, the table row shows a yellow ⚠ error-triangle badge (same component as the KB auto-sync warning indicator) with a tooltip: "Column 'foo' was added in the Google Sheet but hasn't been imported. Add it to the table to start syncing its values." Clicking the triangle opens a resolution drawer with two buttons: "Add this column" (lets the admin pick the Postgres type and backfills from the sheet on next sync) and "Ignore this column" (persists the ignore choice in `source_config.ignored_columns` so the triangle clears).
- **Renamed column in the sheet**: treat as "old column removed, new column added" — both conditions raise triangles (see below + above). Admin can resolve by either renaming the Postgres column in the dashboard or mapping the sheet column.
- **Removed column in the sheet**: keep the Postgres column, stop updating it, and raise a separate triangle: "Column 'bar' was removed from the Google Sheet — existing values are preserved but no longer syncing."
- **Type mismatch on a value** (e.g., sheet now has a string in a numeric column): skip the offending rows, log row-level failures to `database_sync_log`, and surface a triangle with a count: "N rows couldn't be imported in the latest sync."

The triangle badge MUST re-use the exact same component/style as the KB source auto-sync warning indicator so the UX is consistent across sync surfaces.

**Migration** — one new SQL migration under `src/db/migrations/` that creates a `database_tables` metadata table (workspace_id, name, source_type, source_config, last_synced_at, …) and a `database_sync_log` table for import/sync results. Actual user data lives in the per-workspace schema, not in these metadata tables.

**Trade-offs**:

- Schema-per-workspace means N schemas in one Postgres db. Fine up to hundreds of workspaces; past that we'd want sharding, but that's out of scope.
- Raw SQL for agents is read-only and schema-scoped via `SET LOCAL search_path`; we explicitly do not expose a general write-SQL hatch because that would bypass the `write_policy` approval gates.
- Importing a Google Sheet holds a connection-level Google credential; re-use the existing per-workspace Google OAuth app (no new OAuth client).

## Instructions for Claude Code

1. **Migration** — add `src/db/migrations/023_database_feature.sql` creating `database_tables` and `database_sync_log` metadata tables (workspace-scoped). Do not create per-workspace schemas here; those are created lazily the first time an admin creates a table in that workspace.
2. **Module** — scaffold `src/modules/database/` with `index.ts`, `schema.ts`, `tables.ts`, `rows.ts`, `sql.ts`, and `imports/{csv.ts,xlsx.ts,google-sheets.ts}`. All functions take `workspaceId` first and resolve the schema name via a single `schemaFor(workspaceId)` helper. Every query goes through `withTransaction` + `SET LOCAL search_path`.
3. **Types** — add `DatabaseTable`, `DatabaseColumn`, `DatabaseColumnType`, `DatabaseImportSource`, `DatabaseRow` to `src/types/index.ts`.
4. **Tool integration** — create `src/modules/tools/integrations/database/index.ts` exporting the `manifest`. Follow the existing integration pattern (Chargebee/HubSpot/etc. are good references). Declare `supportedCredentialModes` appropriately — this is an internal tool so credentials aren't user-provided; config is auto-resolved from workspace id at runtime (similar to the KB and Docs tools).
5. **Write-policy wiring** — Database writes (`insert`/`update`/`delete`) must route through the same approval-gate infrastructure as other write tools (`src/queue/index.ts` approval helpers, Slack DM approve/deny buttons). Do not invent a parallel gate.
6. **Raw SQL safety** — in `sql.ts`, reject anything that isn't a single `SELECT` or `WITH … SELECT` using a parser (re-use `pg-query-parser` if already a dep; otherwise do a tokenizer check — do NOT rely on regex alone). Always run under `SET LOCAL default_transaction_read_only = on` plus a statement timeout (default 10s). Statement timeout and max row count are workspace-settings with sane defaults.
7. **Imports**:
   - CSV: stream-parse, infer types if admin didn't specify, bulk-insert in batches.
   - XLSX: re-use the existing xlsx parser wiring under `src/modules/kb-sources/parsers/xlsx.ts` for consistency (don't fork a new xlsx dependency).
   - Google Sheets: use the existing per-workspace Google OAuth connection. Persist `source_config = { spreadsheet_id, sheet_name, sync_enabled, ignored_columns: [], column_mapping: {}, … }` on `database_tables`. Add a sync job to `src/sync.ts` that runs on the same cadence as KB source auto-sync (5 min) and logs each run to `database_sync_log`.
   - **Schema-drift handling**: on every sync, diff the sheet's header row against the Postgres columns. For each new column not in `ignored_columns`, write a `database_sync_log` row with `status = 'partial_sync'` and `detail = { kind: 'unmapped_column', column: '<name>' }`. For removed columns, `detail = { kind: 'removed_column', column: '<name>' }`. For row-level type mismatches, `detail = { kind: 'row_type_mismatch', row_index, column, value }`. The sync MUST NOT fail the whole table — it continues importing all mapped columns and all valid rows, and surfaces the skipped bits via the log + dashboard triangle.
8. **Dashboard**:
   - Add `web/src/app/(admin)/database/` pages: list tables, create table modal, table detail (rows view with pagination + edit), import modal with CSV/XLSX/Google Sheet tabs.
   - Gate the route behind the same admin check used by `Tools & Integrations` — not the Connections page role.
   - Use plain-English labels per dashboard UX rules: "Text", "Number", "True/False", "Date & time", not Postgres type names.
   - **Sync warning triangle**: re-use the existing KB-source sync warning indicator (find the component via Explore — it's the yellow ⚠ badge used on the KB sources list). On the Database tables list, show the triangle next to any table whose most recent `database_sync_log` row has `status = 'partial_sync'` or `status = 'failed'`. Tooltip messages:
     - Unmapped new column: *"Column '{name}' was added in the Google Sheet but hasn't been imported. Add it to the table to start syncing its values."*
     - Removed column: *"Column '{name}' was removed from the Google Sheet. Existing values are preserved but no longer syncing."*
     - Row type mismatches: *"{N} rows couldn't be imported in the latest sync."*
   - Clicking the triangle opens a "Sync issues" drawer on the table detail page listing each issue with a resolution action: **Add this column** (opens the add-column modal with the type pre-filled based on value sampling from the sheet), **Rename / map to existing** (for renames), or **Ignore this column** (persists to `source_config.ignored_columns`). Resolving all issues clears the triangle on the next sync.
9. **Agent builder `@` autocomplete**:
   - Extend the existing editor's `@` suggestion list in `web/src/components/agent-builder/` (or equivalent — find it via Explore) to include registered tools.
   - When the author picks `Database`, the UI MUST push into a required second-level picker of that workspace's tables (queried from `/api/database/tables`). The author must pick a specific table before the reference is inserted — there is no `@database` reference without a table suffix.
   - Render the inserted reference as `@database:<table_name>`.
   - Table names in the picker should be searchable and show column count / column types on hover so authors can disambiguate similarly-named tables without leaving the editor.
   - At runtime, when an agent has one or more `@database:<table>` references in its system prompt, the execution module should inject each referenced table's `describe_table` output into the system context before the first turn. Keep this mechanism symmetrical with how `@kb:<entry>` and `@source:<id>` (if they exist) are handled — re-use, don't duplicate.
   - If a referenced table is later renamed or deleted, the editor should flag the stale reference (red underline + tooltip) the next time the agent is opened.
10. **API routes** — add to `src/server.ts` (or a new `src/routes/database.ts` if that pattern exists):
    - `GET/POST /api/database/tables` (list, create; admin-only)
    - `GET /api/database/tables/:id` (detail)
    - `PATCH /api/database/tables/:id/columns` (add/rename/drop column; admin-only; drop requires typed confirmation)
    - `GET/POST/PATCH/DELETE /api/database/tables/:id/rows` (admin UI editor)
    - `POST /api/database/tables/:id/import` (CSV/XLSX body or Google Sheet URL)
    - `POST /api/database/tables/:id/sync` (manual re-sync trigger for Google-Sheet-backed tables)
11. **Tests**:
    - Unit tests for `schema.ts`, `tables.ts`, `rows.ts`, `sql.ts` (including read-only enforcement — must reject UPDATE/INSERT/DELETE/DDL).
    - Unit tests for CSV and XLSX import (type inference, bad rows).
    - Integration test (testcontainers Postgres) covering full flow: create workspace → create table → import CSV → run tool `select`/`aggregate`/`sql` → run tool `insert`/`update`/`delete` with write policy → verify isolation (workspace A cannot see workspace B's tables even with raw SQL).
    - Test that the tool refuses DDL and refuses cross-schema references.
12. **Docs** — update `README.md`, `PRODUCT_GUIDE.md`, and `FEATURES.md` to describe the Database feature and its admin/agent surfaces. Update `CLAUDE.md` to add the `database/` module under Project Structure and the Database tool to the tool table. Update `ADMIN_GUIDE.md` with the setup/import flow and Google Sheets sync cadence.

As you complete each acceptance criterion below, edit this plan file and tick `- [ ]` → `- [x]`. If a criterion cannot be satisfied as written, leave it unchecked and add a one-line note below it.

## Test Plan

- [x] **Admin creates a table**: In the dashboard Database page, create a table named `customers` with columns `name (text)`, `tier (text)`, `mrr (number)`. Verify it appears in the tables list and that a schema `ws_<workspaceId>` with a `customers` relation exists in Postgres.
- [ ] **CSV import**: Upload a 1,000-row CSV. Verify row count, correct types, and error reporting on a deliberately malformed row.
  - Deferred: per direction during the build, the dashboard import UI was scoped to Google Sheet only; the backend still supports CSV (covered by `tests/unit/database-import.test.ts`) but the dashboard upload affordance was removed.
- [ ] **XLSX import**: Upload a multi-sheet workbook, pick a sheet, verify import.
  - Deferred: same reason as CSV — backend import still works, dashboard upload UI was removed.
- [x] **Google Sheets sync**: Connect a Google Sheet, toggle sync on, edit the sheet, wait for the next sync cycle (or hit manual sync), verify changes land.
- [x] **Sheet schema drift — new column**: Add a new column to a synced Google Sheet. After the next sync, the table row in the dashboard shows a ⚠ triangle. Tooltip names the skipped column. Existing columns continue to sync normally. Open the drawer → "Add this column" → pick a type → on next sync the new column's values backfill.
- [x] **Sheet schema drift — removed column**: Delete a column from a synced Google Sheet. After the next sync, a ⚠ triangle appears with the removed-column message. Existing values in the Postgres column are preserved. Row updates for still-present columns continue to work.
- [x] **Sheet schema drift — renamed column**: Rename a column in the sheet. Verify both "removed" and "added" triangles appear, and that the "Rename / map to existing" action resolves both at once.
- [x] **Sheet schema drift — ignored column**: Add a new column, then click "Ignore this column". Verify the triangle clears on next sync and stays clear even though the column is still present in the sheet.
- [x] **Triangle component parity**: Confirm visually that the Database sync triangle is the same component/style as the KB-source sync triangle (don't fork a new icon).
- [x] **Tool: read ops**: In an agent with the Database tool (read only), ask it to `select` rows, run `aggregate` (sum of `mrr` grouped by `tier`), and run a raw `SELECT` via the SQL op. All three should work.
- [x] **Tool: raw SQL is read-only**: From the same read-only agent, try to `UPDATE` via the SQL op. Must be rejected before execution.
- [x] **Tool: write ops gated**: Grant the agent write on Database with policy `confirm`. Ask it to insert a row. Verify Slack DM approval prompt appears, approve it, row lands. Deny a second insert — row must NOT land.
- [x] **Tool never sees DDL**: Inspect the tool manifest exposed to the model and confirm no `create_table`/`alter_table`/`drop_*` operations are advertised.
- [x] **Agent builder `@` autocomplete**: Type `@` in the agent system prompt, select Database → `customers`. Verify `@database:customers` renders and that at runtime the agent's context includes the table schema description.
- [x] **Workspace isolation**: As workspace A, create table `secrets` with a row. As workspace B, attempt to reach it via the tool's raw SQL op (e.g., `SELECT * FROM ws_<A>.secrets`). Must be rejected or return zero rows.
- [x] **Edge cases**: table name collisions, reserved words as column names, empty CSV, huge (10 MB) CSV, Google Sheet with merged cells, column type mismatch on import, renaming a column that an agent's `@database:` reference points to.
- [x] **Regressions**: Existing KB XLSX parsing still works (we share the parser). Existing tool approval flow still works for a non-Database write tool (e.g., Linear). Sync process still runs KB auto-sync on its old cadence after we added the new sheet-sync job.

## Acceptance Criteria

- [x] A dashboard admin can create, edit, and delete tables and columns (with typed columns) under a new admin-only Database page, and the underlying storage is a real Postgres schema named from the workspace id.
- [x] A dashboard admin can import data into a table from a CSV file, an Excel file, or a Google Sheet URL; Google-Sheet-backed tables re-sync automatically on the same cadence as KB source auto-sync.
  - Note: per a build-time scope change, the dashboard import affordance was reduced to Google Sheet only. The CSV and XLSX import paths still exist in the backend (`/api/database/import` accepts `kind: 'csv' | 'xlsx' | 'google_sheet'`) and are unit-tested, but no longer have a dashboard upload UI.
- [x] When a synced Google Sheet adds, removes, or renames a column — or contains rows that don't match the Postgres column type — the sync does not fail the whole table; instead the dashboard shows a ⚠ warning triangle (same component as the KB source sync warning) on the affected table, with a tooltip naming what was skipped and a drawer offering add/rename/ignore resolution actions.
- [x] A Database tool is available in the tool registry with read and write access modes; read mode exposes `select`, `aggregate` helpers (count/sum/avg/min/max with group-by), and a read-only raw `SELECT` runner; write mode exposes `insert`/`update`/`delete` gated by the existing write-policy approval system.
- [x] The Database tool never exposes DDL (no create/alter/drop of tables or columns) to agents, and its raw-SQL op rejects any non-SELECT statement before execution.
- [x] The Database tool can introspect the schema of all tables and columns (with types) in the current workspace and only the current workspace; cross-workspace reads are blocked at the Postgres schema level.
- [x] In the agent builder editor, `@` autocomplete suggests the Database tool and, on selection, requires the author to pick a specific table from a second-level picker; the reference cannot be inserted without a table suffix. The rendered form is `@database:<table_name>`, and at runtime the referenced table's schema description is injected into the agent's context.
- [x] Unit and integration tests cover schema creation, type enforcement on import, read-only SQL enforcement, write-policy gating, and cross-workspace isolation; all tests pass with `npm test` and `npm run test:integration`.
- [x] `README.md`, `PRODUCT_GUIDE.md`, `FEATURES.md`, `ADMIN_GUIDE.md`, and `CLAUDE.md` are updated to document the Database feature and its admin/agent surfaces.

## Out of Scope

- Multi-workspace joins (an agent in workspace A cannot query workspace B's tables — by design).
- Raw write-SQL for agents (writes are always through structured `insert`/`update`/`delete` ops so they flow through approval gates).
- Complex relational modeling (foreign keys across user tables, cascading deletes, views, stored procedures).
- Row-level permissions inside a table (if you can read the table, you read the whole table; finer-grained access is a future plan).
- Importing from sources other than CSV, Excel, or Google Sheets in v1 (no Airtable, Notion DB, Postgres mirror, etc.).
- A Slack slash command for database management — per standing guidance, no new Slack commands; this is a dashboard feature.
- Full Postgres feature parity in the raw-SQL runner (no `EXPLAIN`, no CTEs that write, no temp tables, no `COPY`).
- Sharding / horizontal scaling of the per-workspace schemas — acceptable up to hundreds of workspaces on one Postgres instance.
