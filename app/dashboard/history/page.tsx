import { createClient } from '@/lib/supabase/server'

export default async function HistoryPage() {
  const supabase = await createClient()
  const { data: runs } = await supabase
    .from('sync_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div>
      <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-wide mb-6">
        Sync History
      </h1>

      {!runs || runs.length === 0 ? (
        <p className="text-slate-500 text-sm">No sync runs yet.</p>
      ) : (
        <div className="space-y-2 max-w-3xl">
          {runs.map((run) => (
            <div
              key={run.id}
              className={`bg-slate-900 rounded px-4 py-3 border-l-2 ${
                run.status === 'success'
                  ? 'border-green-500'
                  : 'border-red-500'
              }`}
            >
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span
                  className={
                    run.status === 'success' ? 'text-green-400' : 'text-red-400'
                  }
                >
                  {run.status === 'success' ? '✓' : '✗'} {run.status}
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-400">{run.source_type}</span>
                {run.source_url && (
                  <>
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-500 text-xs truncate max-w-xs">
                      {run.source_url}
                    </span>
                  </>
                )}
              </div>
              <div className="text-xs text-slate-500 mt-1 flex gap-3 flex-wrap">
                {run.rows_inserted && (
                  <span>
                    {Object.entries(
                      run.rows_inserted as Record<string, number>
                    )
                      .map(([t, c]) => `${t}: ${c.toLocaleString()}`)
                      .join(' · ')}
                  </span>
                )}
                {run.error_message && (
                  <span className="text-red-400">{run.error_message}</span>
                )}
                <span>{run.duration_ms}ms</span>
                <span>·</span>
                <span>{run.triggered_by_email ?? 'unknown'}</span>
                <span>·</span>
                <span>{new Date(run.created_at).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
