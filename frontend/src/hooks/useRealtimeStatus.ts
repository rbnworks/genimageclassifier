import { useEffect, useState } from 'react'
import { retainRealtimeConnection, subscribeRealtimeStatus } from '../realtime/events'

export type RealtimeConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export function useRealtimeStatus(): RealtimeConnectionStatus {
  const [status, setStatus] = useState<RealtimeConnectionStatus>('disconnected')

  useEffect(() => {
    const release = retainRealtimeConnection()
    const unsub = subscribeRealtimeStatus((next) => setStatus(next))
    return () => {
      unsub()
      release()
    }
  }, [])

  return status
}
