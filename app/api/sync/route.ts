import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/service'
import { parseGtfsZip } from '@/lib/gtfs/parse'

// APPROACH: All-in-one Next.js API route.
//
// PRO: Single codebase, simple Vercel deployment, no extra infrastructure.
// CON: Vercel serverless functions have a 60s execution timeout.
//      Fine for small GTFS feeds (this PoC). Risky for large production feeds.
//
// ALTERNATIVE A — Supabase Edge Functions (Deno):
//   Runs closer to the database, removes Vercel dependency.
//   Natural upgrade path when moving to production.
//   See: https://supabase.com/docs/guides/functions
//
// ALTERNATIVE B — Background job queue (BullMQ + Redis):
//   Handles arbitrarily large feeds without timeout risk.
//   Requires additional infrastructure (Redis, worker process).
//   See: https://docs.bullmq.io/

const BATCH_SIZE = 1_000

export async function POST(request: NextRequest) {
  const start = Date.now()
  const serviceClient = createServiceClient()

  // Extract the authenticated user for attribution.
  // Uses the anon client + session cookie — not the service role client.
  let userId: string | null = null
  let userEmail: string | null = null

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll() {}, // No-op in API routes
        },
      }
    )
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
    userEmail = user?.email ?? null
  } catch {
    // Non-fatal: sync proceeds without attribution if session extraction fails.
  }

  // --- Input handling ---
  let buffer: Buffer
  let sourceType: 'zip' | 'api' = 'api'
  let sourceUrl: string | null = null

  try {
    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) throw new Error('No file provided in form data')
      buffer = Buffer.from(await file.arrayBuffer())
      sourceType = 'zip'
    } else {
      const body = await request.json()
      if (!body.url) throw new Error('No URL provided in request body')
      sourceUrl = body.url as string
      const response = await fetch(sourceUrl)
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
      }
      buffer = Buffer.from(await response.arrayBuffer())
      sourceType = 'api'
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown input error'
    await recordSyncRun(serviceClient, {
      source_type: sourceType, source_url: sourceUrl, status: 'error',
      error_message: message, rows_inserted: null,
      duration_ms: Date.now() - start,
      triggered_by_user_id: userId, triggered_by_email: userEmail,
    })
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // --- Parse ---
  let parsed
  try {
    parsed = await parseGtfsZip(buffer)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ZIP parse error'
    await recordSyncRun(serviceClient, {
      source_type: sourceType, source_url: sourceUrl, status: 'error',
      error_message: message, rows_inserted: null,
      duration_ms: Date.now() - start,
      triggered_by_user_id: userId, triggered_by_email: userEmail,
    })
    return NextResponse.json({ error: message }, { status: 422 })
  }

  // --- Truncate + insert ---
  try {
    // STRATEGY: Full truncate + re-insert on every sync.
    //
    // PRO: Simple, no key-collision edge cases.
    // KNOWN LIMITATION: A failure after truncate but before insert completes
    //   leaves the tables empty until the next successful sync.
    //   Fix in production: wrap in a transaction or use a shadow-table swap.
    //
    // FUTURE: Upsert using stable GTFS primary keys (stop_id, route_id, etc.)
    //   for incremental syncs without any downtime window.
    const { error: truncateError } = await serviceClient.rpc('truncate_gtfs_tables')
    if (truncateError) throw new Error(`Truncate failed: ${truncateError.message}`)

    // TODO: Add batchInsert calls for additional tables as they are implemented.
    await batchInsert(serviceClient, 'stops', parsed.stops)
    await batchInsert(serviceClient, 'routes', parsed.routes)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Database error'
    await recordSyncRun(serviceClient, {
      source_type: sourceType, source_url: sourceUrl, status: 'error',
      error_message: message, rows_inserted: null,
      duration_ms: Date.now() - start,
      triggered_by_user_id: userId, triggered_by_email: userEmail,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const rowsInserted = {
    stops: parsed.stops.length,
    routes: parsed.routes.length,
  }

  const syncRun = await recordSyncRun(serviceClient, {
    source_type: sourceType,
    source_url: sourceUrl,
    status: 'success',
    error_message: null,
    rows_inserted: rowsInserted,
    duration_ms: Date.now() - start,
    triggered_by_user_id: userId,
    triggered_by_email: userEmail,
  })

  return NextResponse.json({ syncRun, rowsInserted })
}

async function batchInsert(
  client: ReturnType<typeof createServiceClient>,
  table: string,
  rows: object[]
) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await client.from(table).insert(batch)
    if (error) throw new Error(`Insert into ${table} failed: ${error.message}`)
  }
}

type SyncRunInput = {
  source_type: 'zip' | 'api'
  source_url: string | null
  status: 'success' | 'error'
  error_message: string | null
  rows_inserted: Record<string, number> | null
  duration_ms: number
  triggered_by_user_id: string | null
  triggered_by_email: string | null
}

async function recordSyncRun(
  client: ReturnType<typeof createServiceClient>,
  data: SyncRunInput
) {
  const { data: run, error } = await client
    .from('sync_runs')
    .insert(data)
    .select()
    .single()
  if (error) console.error('Failed to record sync run:', error.message)
  return run
}
