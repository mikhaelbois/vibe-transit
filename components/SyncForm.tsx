'use client'

import { useState, useRef } from 'react'

type SyncMode = 'zip' | 'api'

interface SyncResult {
  success: boolean
  message: string
}

export default function SyncForm() {
  const [mode, setMode] = useState<SyncMode>('zip')
  const [apiUrl, setApiUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSync() {
    setLoading(true)
    setResult(null)

    try {
      let response: Response

      if (mode === 'zip') {
        if (!file) throw new Error('Please select a ZIP file')
        const formData = new FormData()
        formData.append('file', file)
        response = await fetch('/api/sync', { method: 'POST', body: formData })
      } else {
        if (!apiUrl.trim()) throw new Error('Please enter a URL')
        response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: apiUrl.trim() }),
        })
      }

      const data = await response.json()

      if (!response.ok) {
        setResult({ success: false, message: data.error ?? 'Sync failed' })
      } else {
        const counts = Object.entries(
          data.rowsInserted as Record<string, number>
        )
          .map(([table, count]) => `${count.toLocaleString()} ${table}`)
          .join(', ')
        setResult({ success: true, message: `Synced: ${counts}` })
      }
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setLoading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped?.name.endsWith('.zip')) setFile(dropped)
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">
        Sync GTFS Data
      </h1>

      {/* Mode toggle */}
      <div className="flex gap-2">
        {(['zip', 'api'] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setResult(null) }}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              mode === m
                ? 'bg-violet-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {m === 'zip' ? 'ZIP Upload' : 'API URL'}
          </button>
        ))}
      </div>

      {/* Input area */}
      {mode === 'zip' ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-violet-500 bg-violet-500/10'
              : 'border-slate-700 hover:border-slate-500'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <p className="text-sm text-slate-300">{file.name}</p>
          ) : (
            <>
              <p className="text-sm text-slate-400">Drop a GTFS .zip here</p>
              <p className="text-xs text-violet-400 mt-1">or click to browse</p>
            </>
          )}
        </div>
      ) : (
        <input
          type="url"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          placeholder="https://example.com/gtfs.zip"
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:border-violet-500 placeholder-slate-600"
        />
      )}

      {/* Sync button */}
      <button
        onClick={handleSync}
        disabled={loading}
        className="px-6 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
      >
        {loading ? 'Syncing...' : 'Run Sync →'}
      </button>

      {/* Result pill */}
      {result && (
        <div
          className={`px-4 py-3 rounded border text-sm ${
            result.success
              ? 'bg-green-950 border-green-800 text-green-400'
              : 'bg-red-950 border-red-800 text-red-400'
          }`}
        >
          {result.success ? '✓ ' : '✗ '}
          {result.message}
        </div>
      )}
    </div>
  )
}
