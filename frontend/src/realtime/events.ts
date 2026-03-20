import { API_BASE_URL } from '../api/client'

export type RealtimeEvent =
  | { type: 'hello' }
  | {
      type: 'scan_updated'
      stats: {
        totalImages: number
        imagesWithMetadata: number
        imagesWithoutMetadata: number
        uniquePrompts: number
      }
    }

type EventListener = (event: RealtimeEvent) => void
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
type StatusListener = (status: ConnectionStatus) => void

const listeners = new Set<EventListener>()
const statusListeners = new Set<StatusListener>()
let socket: WebSocket | null = null
let reconnectTimer: number | null = null
let connectionStatus: ConnectionStatus = 'disconnected'

function setStatus(status: ConnectionStatus): void {
  if (connectionStatus === status) return
  connectionStatus = status
  statusListeners.forEach((listener) => {
    try {
      listener(status)
    } catch (err) {
      console.warn('[realtime] status listener failed', err)
    }
  })
}

function wsUrl(): string {
  // VITE_WS_URL is set in docker-compose so the browser can connect directly
  // to the backend port, bypassing Vite's HMR server which intercepts WS upgrades.
  const explicit = import.meta.env.VITE_WS_URL as string | undefined
  if (explicit) {
    console.debug('[realtime] using VITE_WS_URL:', explicit)
    return explicit
  }
  // Fallback for local dev without Docker: derive from current origin.
  const origin = window.location.origin
  const u = new URL(origin)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/ws/events'
  u.search = ''
  console.debug('[realtime] derived WS URL:', u.toString())
  return u.toString()
}

function notify(event: RealtimeEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(event)
    } catch (err) {
      console.warn('[realtime] listener failed', err)
    }
  })
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null || listeners.size === 0) return
  setStatus('reconnecting')
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    ensureConnected()
  }, 1200)
}

function ensureConnected(): void {
  if (socket || listeners.size === 0) return
  setStatus('connecting')

  const next = new WebSocket(wsUrl())
  socket = next

  next.onopen = () => {
    if (socket === next) setStatus('connected')
  }

  next.onmessage = (ev) => {
    try {
      const parsed = JSON.parse(ev.data) as RealtimeEvent
      notify(parsed)
    } catch (err) {
      console.warn('[realtime] invalid event payload', err)
    }
  }

  next.onclose = () => {
    if (socket === next) socket = null
    if (listeners.size === 0) {
      setStatus('disconnected')
      return
    }
    scheduleReconnect()
  }

  next.onerror = () => {
    next.close()
  }
}

function maybeDisconnect(): void {
  if (listeners.size > 0) return
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  // Keep a single long-lived socket for the app session.
  // This avoids churn from StrictMode mount/unmount cycles during handshake.
}

export function subscribeRealtime(listener: EventListener): () => void {
  listeners.add(listener)
  ensureConnected()
  return () => {
    listeners.delete(listener)
    maybeDisconnect()
  }
}

export function subscribeRealtimeStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  listener(connectionStatus)
  return () => {
    statusListeners.delete(listener)
  }
}

export function retainRealtimeConnection(): () => void {
  return subscribeRealtime(() => {})
}
