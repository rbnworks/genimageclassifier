import React, { useCallback, useState } from 'react'
import { deleteAlbum, fetchImagesByPromptId, ImageItem } from '../api/prompts'
import PromptGrid from '../components/PromptGrid'
import PromptModal from '../components/PromptModal'
import { usePromptGroups } from '../hooks/usePromptGroups'
import styles from './HomePage.module.css'
import albumStyles from './PromptAlbumPage.module.css'

function formatLastUpdated(d: Date | null): string {
  if (!d) return ''
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin === 1) return '1 min ago'
  return `${diffMin} min ago`
}

export default function PromptAlbumPage() {
  const { groups, loading, refreshing, error, lastUpdated, forceRefresh, evictGroup } = usePromptGroups()

  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null)
  const [modalImages, setModalImages] = useState<ImageItem[]>([])
  const [modalLoading, setModalLoading] = useState(false)
  const [, setTick] = useState(0)
  const [query, setQuery] = useState('')

  // Re-render every 30s to keep "X min ago" text fresh.
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const handleCardClick = useCallback(async (promptId: string, prompt: string) => {
    setSelectedPrompt(prompt)
    setModalImages([])
    setModalLoading(true)
    try {
      const imgs = await fetchImagesByPromptId(promptId)
      setModalImages(imgs)
    } catch {
      setModalImages([])
    } finally {
      setModalLoading(false)
    }
  }, [])

  const handleClose = useCallback(() => {
    setSelectedPrompt(null)
    setModalImages([])
  }, [])

  const handleDelete = useCallback((imageId: string) => {
    setModalImages((prev) => prev.filter((img) => img.id !== imageId))
  }, [])

  const handleAlbumDelete = useCallback(async (promptId: string) => {
    await deleteAlbum(promptId)
    evictGroup(promptId)
    // Close modal if it's showing this album
    setSelectedPrompt(null)
    setModalImages([])
  }, [evictGroup])

  if (loading) return <div className={styles.status}>Scanning media…</div>
  if (error) return <div className={styles.error}>Error: {error}</div>
  if (groups.length === 0)
    return (
      <div className={styles.status}>
        No indexed images yet — drop images into a watched folder and wait for the next scan.
      </div>
    )

  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? groups.filter((g) => g.prompt.toLowerCase().includes(needle))
    : groups

  return (
    <>
      <div className={albumStyles.toolbar}>
        <div className={albumStyles.searchWrap}>
          <span className={albumStyles.searchIcon}>🔍</span>
          <input
            className={albumStyles.searchInput}
            type="search"
            placeholder="Search prompts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {query && (
            <button className={albumStyles.searchClear} onClick={() => setQuery('')} title="Clear">
              ✕
            </button>
          )}
        </div>
        <span className={albumStyles.lastUpdated}>
          {needle
            ? `${filtered.length} / ${groups.length} prompts`
            : refreshing
            ? 'Refreshing…'
            : lastUpdated
            ? `Updated ${formatLastUpdated(lastUpdated)}`
            : ''}
        </span>
        <button
          className={albumStyles.refreshBtn}
          onClick={forceRefresh}
          disabled={refreshing || loading}
          title="Refresh prompt list"
        >
          {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
        </button>
      </div>
      {filtered.length === 0 && needle ? (
        <div className={styles.status}>No prompts match “{query}”</div>
      ) : (
        <PromptGrid
          groups={filtered}
          onCardClick={(g) => handleCardClick(g.prompt_id, g.prompt)}
          onCardDelete={(g) => handleAlbumDelete(g.prompt_id)}
        />
      )}
      {selectedPrompt !== null && (
        <PromptModal
          prompt={selectedPrompt}
          images={modalImages}
          loading={modalLoading}
          onClose={handleClose}
          onDelete={handleDelete}
        />
      )}
    </>
  )
}
