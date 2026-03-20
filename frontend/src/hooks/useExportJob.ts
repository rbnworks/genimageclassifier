import { useEffect, useState } from 'react'
import { API_BASE_URL } from '../api/client'

export type ExportResolution = 'original' | '720p' | '480p'
export type ExportStatus = 'idle' | 'building' | 'ready' | 'error'

interface ExportState {
  jobId: string | null
  status: ExportStatus
  resolution: ExportResolution
  done: number
  total: number
  error: string | null
}

// ── Module-level singletons — survive component unmounts and navigation ───────

let _state: ExportState = {
  jobId: null,
  status: 'idle',
  resolution: 'original',
  done: 0,
  total: 0,
  error: null,
}
const _listeners = new Set<() => void>()
let _eventSource: EventSource | null = null

function _notify() {
  _listeners.forEach((fn) => fn())
}

function _patch(update: Partial<ExportState>) {
  _state = { ..._state, ...update }
  _notify()
}

async function _triggerDownload(jobId: string) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/export/prompts/${jobId}/download`)
    if (!res.ok) throw new Error(`Download failed [${res.status}]`)
    const disposition = res.headers.get('Content-Disposition') ?? ''
    const match = disposition.match(/filename[^;=\n]*=(?:["']?)([^"'\n;]+)/i)
    const filename = match ? match[1].trim() : 'prompts-export.zip'
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    _patch({ status: 'error', error: String(e) })
    return
  }
  _patch({ status: 'idle', jobId: null, done: 0, total: 0, error: null })
}

function _connectSSE(jobId: string) {
  _eventSource?.close()
  _eventSource = new EventSource(`${API_BASE_URL}/api/export/prompts/${jobId}/events`)

  _eventSource.onmessage = (e) => {
    const msg = JSON.parse(e.data) as {
      done: number
      total: number
      status: string
      error: string | null
    }
    _patch({ done: msg.done, total: msg.total })

    if (msg.status === 'ready') {
      _eventSource?.close()
      _eventSource = null
      _patch({ status: 'ready' })
      _triggerDownload(jobId)
    } else if (msg.status === 'error') {
      _eventSource?.close()
      _eventSource = null
      _patch({ status: 'error', error: msg.error ?? 'Export failed' })
    }
  }

  _eventSource.onerror = () => {
    _eventSource?.close()
    _eventSource = null
    if (_state.status === 'building') {
      _patch({ status: 'error', error: 'Connection lost during export' })
    }
  }
}

// ── Public actions (module-level, stable references) ─────────────────────────

export async function startExport(): Promise<void> {
  if (_state.status === 'building') return
  _patch({ status: 'building', done: 0, total: 0, error: null, jobId: null })
  try {
    const res = await fetch(`${API_BASE_URL}/api/export/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: _state.resolution }),
    })
    if (!res.ok) throw new Error(`Failed to start export [${res.status}]`)
    const { job_id, total } = (await res.json()) as { job_id: string; total: number }
    _patch({ jobId: job_id, total })
    _connectSSE(job_id)
  } catch (e) {
    _patch({ status: 'error', error: String(e) })
  }
}

export function setExportResolution(resolution: ExportResolution): void {
  if (_state.status !== 'building') {
    _patch({ resolution })
  }
}

export function dismissExportError(): void {
  _patch({ status: 'idle', error: null })
}

// ── React hook ────────────────────────────────────────────────────────────────

export function useExportJob() {
  const [, rerender] = useState(0)

  useEffect(() => {
    const fn = () => rerender((n) => n + 1)
    _listeners.add(fn)
    return () => {
      _listeners.delete(fn)
    }
  }, [])

  return {
    status: _state.status,
    resolution: _state.resolution,
    done: _state.done,
    total: _state.total,
    error: _state.error,
    startExport,
    setResolution: setExportResolution,
    dismiss: dismissExportError,
  }
}
