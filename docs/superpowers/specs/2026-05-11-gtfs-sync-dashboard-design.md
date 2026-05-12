# GTFS Sync Dashboard — Design Spec

**Date:** 2026-05-11
**Status:** Approved

---

## Overview

A proof-of-concept Next.js dashboard that lets an authenticated user sync GTFS transit data into a Supabase-hosted PostgreSQL database. Data can be sourced from a ZIP file upload or a remote API URL. The dashboard shows a sync trigger form, a history log of past sync runs (with user attribution), and a data preview showing row counts per table.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Auth | Supabase Auth (email/password) |
| Database | Supabase Postgres |
| DB client | `@supabase/ssr` + `@supabase/supabase-js` |
| ZIP parsing | `jszip` |
| CSV parsing | `papaparse` |
| Styling | Tailwind CSS |
| Deployment | Vercel (intended) |

---

## Architecture

### Approach: All-in-one Next.js (API Routes)

Sync logic runs in a Next.js API route (`POST /api/sync`). The Supabase service role key is used server-side to bypass RLS for writes. The Supabase anon key is used client-side for reads and auth.

> **Why API routes over Supabase Edge Functions:** Keeps everything in one codebase, avoids Deno runtime unfamiliarity, and is sufficient for the PoC's small feed sizes.
> **Future path:** Move sync logic to Supabase Edge Functions to run closer to the database and remove the Vercel deployment dependency.

> **Why not a background job queue (BullMQ/Redis):** No extra infrastructure needed for a PoC. The 60s serverless timeout is acceptable for small feeds.
> **Future path:** Add BullMQ + Redis for large production feeds where sync may exceed serverless timeout limits.

### Route Map

| Route | Type | Purpose |
|---|---|---|
| `/login` | Client component | Supabase Auth login form |
| `/dashboard/sync` | Server + client | Sync trigger UI |
| `/dashboard/history` | Server component | Sync run log |
| `/dashboard/data` | Server component | Row count preview |
| `POST /api/sync` | API route | Runs the sync pipeline |

Next.js middleware protects all `/dashboard/*` routes — unauthenticated requests redirect to `/login`.

---

## Database Schema

### `sync_runs`

Records every sync attempt.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `created_at` | `timestamptz` | `now()` |
| `source_type` | `text` | `'zip'` or `'api'` |
| `source_url` | `text` | null for ZIP uploads |
| `status` | `text` | `'success'` or `'error'` |
| `error_message` | `text` | null on success |
| `rows_inserted` | `jsonb` | e.g. `{"stops": 1240, "routes": 42}` |
| `duration_ms` | `int` | wall-clock time of the sync |
| `triggered_by_user_id` | `uuid` | FK to `auth.users` |
| `triggered_by_email` | `text` | denormalized for display |

> **Audit log note:** `triggered_by_*` fields provide sync-level attribution. Supabase exposes login/logout events via `auth.audit_log_entries` at no extra cost.
> **Future path:** Add a standalone `audit_log` table for broader user activity tracking (data access, settings changes, etc.).

### `stops`

Core fields from `stops.txt`:

| Column | Type |
|---|---|
| `stop_id` | `text` (PK) |
| `stop_name` | `text` |
| `stop_lat` | `float8` |
| `stop_lon` | `float8` |
| `stop_desc` | `text` |
| `zone_id` | `text` |

### `routes`

Core fields from `routes.txt`:

| Column | Type |
|---|---|
| `route_id` | `text` (PK) |
| `agency_id` | `text` |
| `route_short_name` | `text` |
| `route_long_name` | `text` |
| `route_type` | `int` |
| `route_color` | `text` |

> **TODO:** Add tables for `trips`, `stop_times`, `calendar`, `calendar_dates`, `shapes`, `agency`, `fare_attributes`, `fare_rules`, `frequencies`, `transfers`, `feed_info` to reach full GTFS spec coverage.

All tables have Row Level Security enabled. Reads require an authenticated session. Writes use the service role key (server-side only).

---

## Sync Pipeline

Handled by `POST /api/sync`.

### Input

- **ZIP upload:** `multipart/form-data` with a `.zip` file field. Read into memory as a `Buffer`.
- **API URL:** JSON body with a `url` field pointing to a GTFS static feed ZIP download URL (the standard GTFS distribution format). Fetched server-side with `fetch()`, response body buffered as a ZIP.

### Steps

1. Receive input (ZIP buffer or fetch from URL).
2. Unzip buffer with `jszip`, extract `stops.txt` and `routes.txt`.
   - TODO: extract remaining GTFS files as additional tables are added.
3. Parse each CSV with `papaparse` (handles quoted fields, BOM, and CRLF line endings common in GTFS exports).
4. Open a Supabase service-role client.
5. Truncate target tables: `TRUNCATE stops, routes`.
6. Bulk-insert parsed rows in batches of 1,000.
7. Write a `sync_runs` record with status, duration, per-table row counts, and user attribution.
8. Return the `sync_runs` record as JSON.

> **Why full truncate + re-insert over upsert:** Simpler for a PoC — no key-collision edge cases, no change detection logic.
> **Known limitation:** A failure between step 5 (truncate) and step 6 (insert) leaves tables empty. A transaction or backup-then-restore strategy would prevent this in production.
> **Future path:** Upsert using stable GTFS primary keys (`stop_id`, `route_id`, etc.) for incremental syncs without downtime.

### Error Handling

All errors are caught and written to `sync_runs` as `status: 'error'` with the error message. The API route returns a non-2xx status with the error detail. The UI surfaces the error message inline on the sync form and in the History view.

---

## UI

### Layout

Sidebar navigation with three links: **Sync**, **History**, **Data**. Persistent across all dashboard routes.

### Sync View (`/dashboard/sync`)

- Toggle between **ZIP Upload** and **API URL** input modes.
- ZIP mode: drag-and-drop zone with browse fallback.
- API URL mode: text input for the GTFS feed URL.
- **Run Sync** button. While syncing, the button is disabled and shows a loading state.
- After completion: inline status pill showing success (row counts) or error (message).

### History View (`/dashboard/history`)

- Table of past `sync_runs`, newest first.
- Columns: status (colored indicator), source type, source URL (truncated), rows inserted, duration, triggered by (email), timestamp.

### Data Preview View (`/dashboard/data`)

- One card per synced table showing table name and current row count.
- Each card shows the timestamp of the last successful sync.
- A visually distinct placeholder card for each TODO table not yet implemented.

---

## Auth Flow

1. Unauthenticated requests to `/dashboard/*` are redirected to `/login` by Next.js middleware (using `@supabase/ssr`).
2. `/login` renders a client component with email/password fields and a Supabase Auth sign-in call.
3. On success, Supabase sets a session cookie. Middleware reads it on subsequent requests.
4. The sync API route extracts the user from the session and stamps `triggered_by_user_id` / `triggered_by_email` on the sync run.
5. Sign-out clears the session cookie and redirects to `/login`.

---

## Testing

No automated tests in the PoC. Manual testing covers:

- Login / redirect flow
- ZIP upload sync (happy path + malformed ZIP)
- API URL sync (happy path + unreachable URL + 404)
- History log after each sync
- Data preview row counts after sync

> **TODO (future):** Unit tests for the CSV parser mapping logic; integration tests for the sync pipeline against a dedicated Supabase test project; E2E tests with Playwright for the login and sync flows.

---

## Out of Scope (PoC)

- Multi-agency / multi-feed support
- Scheduled / automatic syncs
- Role-based access control
- Full GTFS spec coverage (only `stops` and `routes` implemented)
- Audit log beyond sync-level user attribution
