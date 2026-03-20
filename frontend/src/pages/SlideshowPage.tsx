import React, { useCallback, useEffect, useState } from 'react'
import { fetchAllImages, ImageItem } from '../api/prompts'
import ImagePreviewModal from '../components/ImagePreviewModal'
import { usePromptGroups } from '../hooks/usePromptGroups'
import { subscribeRealtime } from '../realtime/events'
import { useSlideshowTimer } from '../hooks/useSlideshowTimer'
import styles from './SlideshowPage.module.css'

const INTERVALS = [
  { label: '1s',  ms: 1000 },
  { label: '3s',  ms: 3000 },
  { label: '5s',  ms: 5000 },
  { label: '10s', ms: 10000 },
]

const TILE_COUNTS = [1, 4, 9]

// ---------------------------------------------------------------------------

type Source = 'all' | string // 'all' or a prompt_id

export default function SlideshowPage() {
  const [allImages, setAllImages]     = useState<ImageItem[]>([])
  // Use the shared cached hook for prompt summaries (no extra network call).
  const { groups }                    = usePromptGroups()
  const [source, setSource]           = useState<Source>('all')
  const [images, setImages]           = useState<ImageItem[]>([])

  const [playing, setPlaying]         = useState(false)
  const [intervalMs, setIntervalMs]   = useState(3000)
  const [tileCount, setTileCount]     = useState(1)
  const [startIndex, setStartIndex]   = useState(0)

  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)

  const loadImages = useCallback(() => {
    setLoading(true)
    setError(null)
    setSource('all') // always reset to full set on refresh
    fetchAllImages()
      .then((imgs) => {
        console.info('[SlideshowPage] loaded', imgs.length, 'images')
        setAllImages(imgs)
        setImages(imgs)
        setStartIndex(0)
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  // Load all images ONCE on mount.
  useEffect(() => { loadImages() }, [loadImages])

  // Refresh slideshow dataset when scanner detects index changes.
  useEffect(() => {
    return subscribeRealtime((event) => {
      if (event.type !== 'scan_updated') return
      loadImages()
    })
  }, [loadImages])

  // Re-filter when source changes
  useEffect(() => {
    if (source === 'all') {
      console.info('[SlideshowPage] source=all,', allImages.length, 'images')
      setImages(allImages)
    } else {
      const grp = groups.find((g) => g.prompt_id === source)
      if (grp) {
        const filtered = allImages.filter((img) => img.prompt === grp.prompt)
        console.info(`[SlideshowPage] source=${grp.prompt.slice(0, 40)}, ${filtered.length} images`)
        setImages(filtered)
      } else {
        // Group not yet loaded — fall back to all images until groups arrive.
        setImages(allImages)
      }
    }
    setStartIndex(0)
  }, [source, allImages, groups])

  const advance = useCallback(() => {
    setStartIndex((prev) => {
      if (images.length === 0) return 0
      return (prev + tileCount) % images.length
    })
  }, [images.length, tileCount])

  const prev = useCallback(() => {
    setStartIndex((p) => {
      if (images.length === 0) return 0
      return (p - tileCount + images.length) % images.length
    })
  }, [images.length, tileCount])

  useSlideshowTimer(advance, intervalMs, playing)

  function jumpTo(index: number) {
    setStartIndex(index)
    setPlaying(false)
  }

  function openPreview(index: number) {
    setPreviewIndex(index)
    setPlaying(false)
  }

  const handleDelete = useCallback((imageId: string) => {
    setAllImages((prev) => prev.filter((img) => img.id !== imageId))
    setImages((prev) => prev.filter((img) => img.id !== imageId))
    setStartIndex(0)
  }, [])

  if (loading) return <div className={styles.status}>Loading images…</div>
  if (error)   return <div className={styles.error}>Error: {error}</div>
  if (images.length === 0)
    return <div className={styles.status}>No images found in the selected source.</div>

  // The tiles currently shown in the main view
  const tiles: ImageItem[] = []
  for (let i = 0; i < tileCount; i++) {
    tiles.push(images[(startIndex + i) % images.length])
  }

  const gridClass =
    tileCount === 4 ? styles.grid2x2 :
    tileCount === 9 ? styles.grid3x3 :
    styles.grid1x1

  return (
    <div className={styles.page}>
      {/* ── Control bar ─────────────────────────────────────── */}
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <button className={styles.btn} onClick={prev} title="Previous">‹ Prev</button>
          <button
            className={`${styles.btn} ${playing ? styles.btnActive : ''}`}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <button className={styles.btn} onClick={advance} title="Next">Next ›</button>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.label}>Interval</span>
          {INTERVALS.map((iv) => (
            <button
              key={iv.ms}
              className={`${styles.btn} ${intervalMs === iv.ms ? styles.btnActive : ''}`}
              onClick={() => setIntervalMs(iv.ms)}
            >
              {iv.label}
            </button>
          ))}
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.label}>Tiles</span>
          {TILE_COUNTS.map((n) => (
            <button
              key={n}
              className={`${styles.btn} ${tileCount === n ? styles.btnActive : ''}`}
              onClick={() => { setTileCount(n); setStartIndex(0) }}
            >
              {n === 1 ? '1×1' : n === 4 ? '2×2' : '3×3'}
            </button>
          ))}
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.label}>Source</span>
          <select
            className={styles.select}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="all">All images ({allImages.length})</option>
            {groups.map((g) => (
              <option key={g.prompt_id} value={g.prompt_id}>
                {g.prompt.slice(0, 60)}{g.prompt.length > 60 ? '…' : ''} ({g.count})
              </option>
            ))}
          </select>
        </div>

        <div className={styles.controlGroup}>
          <button
            className={styles.btn}
            onClick={() => { setPlaying(false); loadImages() }}
            title="Reload all images from the server"
          >
            ↻ Refresh
          </button>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.label}>
            {startIndex + 1}–{Math.min(startIndex + tileCount, images.length)}
            {' '}/ {images.length}
            {source !== 'all' ? ' (filtered)' : ''}
          </span>
        </div>
      </div>

      {/* ── Main view ───────────────────────────────────────── */}
      <div className={`${styles.mainView} ${gridClass}`}>
        {tiles.map((img, i) => (
          <div key={`${img.id}-${i}`} className={styles.mainTile}>
            <img src={img.url} alt="" className={styles.mainImg} />
          </div>
        ))}
      </div>

      {/* ── Thumbnail strip ─────────────────────────────────── */}
      <div className={styles.strip}>
        {images.map((img, idx) => {
          const isActive = idx >= startIndex && idx < startIndex + tileCount
          return (
            <button
              key={img.id}
              className={`${styles.thumb} ${isActive ? styles.thumbActive : ''}`}
              onClick={() => openPreview(idx)}
              onDoubleClick={() => jumpTo(idx)}
              title={img.prompt.slice(0, 80)}
            >
              <img src={img.url} alt="" className={styles.thumbImg} loading="lazy" />
            </button>
          )
        })}
      </div>
      {previewIndex !== null && (
        <ImagePreviewModal
          images={images}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
