import { createClient } from '@/lib/supabase/server'

// Tables with full pipeline implementation.
// TODO: Move a table name from TODO_TABLES to IMPLEMENTED_TABLES
//       and add its batchInsert call in app/api/sync/route.ts
//       as each new GTFS table is added.
const IMPLEMENTED_TABLES = ['stops', 'routes'] as const

// Placeholder cards shown for tables not yet implemented.
// TODO: Remove from this list as tables are implemented.
const TODO_TABLES = [
  'trips',
  'stop_times',
  'calendar',
  'calendar_dates',
  'shapes',
  'agency',
  'fare_attributes',
  'fare_rules',
  'frequencies',
  'transfers',
  'feed_info',
] as const

export default async function DataPage() {
  const supabase = await createClient()

  const counts = await Promise.all(
    IMPLEMENTED_TABLES.map(async (table) => {
      const { count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
      return { table, count: count ?? 0 }
    })
  )

  const { data: lastSync } = await supabase
    .from('sync_runs')
    .select('created_at')
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const lastSyncAt = lastSync
    ? new Date(lastSync.created_at).toLocaleString()
    : null

  return (
    <div>
      <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-wide mb-6">
        Data Preview
      </h1>

      <div className="grid grid-cols-2 gap-4 max-w-2xl">
        {counts.map(({ table, count }) => (
          <div
            key={table}
            className="bg-slate-900 rounded-lg p-6 border border-slate-800"
          >
            <div className="text-violet-400 text-xs font-medium uppercase tracking-wide mb-2">
              {table}
            </div>
            <div className="text-3xl font-bold text-white">
              {count.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              rows{lastSyncAt ? ` · last synced ${lastSyncAt}` : ''}
            </div>
          </div>
        ))}

        {TODO_TABLES.map((table) => (
          <div
            key={table}
            className="bg-slate-900 rounded-lg p-6 border border-dashed border-slate-700 opacity-40"
          >
            <div className="text-slate-600 text-xs font-medium uppercase tracking-wide mb-2">
              {table}
            </div>
            <div className="text-sm text-slate-600 font-mono">// TODO</div>
          </div>
        ))}
      </div>
    </div>
  )
}
