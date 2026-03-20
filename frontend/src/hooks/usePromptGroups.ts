import { useCallback, useEffect, useState } from 'react'
import { clearPromptImageCache, fetchPromptGroups, PromptGroup } from '../api/prompts'
import { subscribeRealtime } from '../realtime/events'

// Module-level cache — survives unmount/remount within the same browser session.
let _cache: PromptGroup[] | null = null
let _lastUpdated: Date | null = null

export function usePromptGroups() {
  const [groups, setGroups] = useState<PromptGroup[]>(_cache ?? [])
  // Show spinner only on the very first load (no cached data yet).
  const [loading, setLoading] = useState(_cache === null)
  // True during a background refresh (cache already populated).
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(_lastUpdated)

  const doFetch = useCallback(async (background: boolean) => {
    if (background) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    try {
      console.info(`[usePromptGroups] ${background ? 'background poll' : 'initial fetch'}`)
      const data = await fetchPromptGroups()
      _cache = data
      _lastUpdated = new Date()
      setGroups(data)
      setLastUpdated(_lastUpdated)
      setError(null)
    } catch (e: unknown) {
      // On background poll failures, keep showing stale data silently.
      if (!background) setError(String(e))
      console.warn('[usePromptGroups] fetch failed', e)
    } finally {
      if (background) {
        setRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }, [])

  // Initial load
  useEffect(() => {
    if (_cache !== null) {
      console.info('[usePromptGroups] loaded from cache')
      setGroups(_cache)
      setLoading(false)
      return
    }
    doFetch(false)
  }, [doFetch])

  // Background polling — only runs while the component using this hook is mounted.
  useEffect(() => {
    return subscribeRealtime((event) => {
      if (event.type !== 'scan_updated') return
      clearPromptImageCache()
      doFetch(true)
    })
  }, [doFetch])

  const forceRefresh = useCallback(() => {
    _cache = null
    doFetch(false)
  }, [doFetch])

  const evictGroup = useCallback((promptId: string) => {
    if (_cache) {
      _cache = _cache.filter((g) => g.prompt_id !== promptId)
    }
    setGroups((prev) => prev.filter((g) => g.prompt_id !== promptId))
  }, [])

  return { groups, loading, refreshing, error, lastUpdated, forceRefresh, evictGroup }
}
