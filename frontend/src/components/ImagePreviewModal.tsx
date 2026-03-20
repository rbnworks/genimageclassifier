import React, { useEffect, useState } from 'react'
import { deleteImage, ImageItem } from '../api/prompts'
import { useClipboard } from '../hooks/useClipboard'
import styles from './ImagePreviewModal.module.css'

interface Props {
  images: ImageItem[]
  initialIndex: number
  onClose: () => void
  onDelete?: (imageId: string) => void
}

export default function ImagePreviewModal({ images: initialImages, initialIndex, onClose, onDelete }: Props) {
  const [images, setImages] = useState(initialImages)
  const [current, setCurrent] = useState(
    Math.max(0, Math.min(initialIndex, initialImages.length - 1)),
  )
  const { copy, copied } = useClipboard()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const prev = () => { setConfirmDelete(false); setCurrent((c) => (c - 1 + images.length) % images.length) }
  const next = () => { setConfirmDelete(false); setCurrent((c) => (c + 1) % images.length) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { prev(); return }
      if (e.key === 'ArrowRight') { next(); return }
      if (e.key === 'Escape')     { if (confirmDelete) { setConfirmDelete(false) } else { onClose() } }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [images.length, onClose, confirmDelete])

  // Scroll active thumbnail into view
  useEffect(() => {
    const el = document.getElementById(`preview-thumb-${current}`)
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [current])

  if (images.length === 0) return null

  const img = images[current]

  async function handleDeleteConfirm() {
    setDeleting(true)
    try {
      await deleteImage(img.id)
      const next = images.filter((_, i) => i !== current)
      onDelete?.(img.id)
      if (next.length === 0) {
        onClose()
        return
      }
      setImages(next)
      setCurrent((c) => Math.min(c, next.length - 1))
      setConfirmDelete(false)
    } catch (err) {
      console.error('[ImagePreviewModal] delete failed', err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      {/* Stop clicks inside the modal from closing */}
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>

        {/* ── Large image ───────────────────────────────────── */}
        <div className={styles.mainArea}>
          <button className={styles.navBtn} onClick={prev} aria-label="Previous image">‹</button>

          <div className={styles.imageWrap}>
            <img src={img.url} alt="" className={styles.mainImg} />
            {confirmDelete && (
              <div className={styles.deleteOverlay}>
                <p className={styles.deleteWarning}>Delete this image from disk?</p>
                <div className={styles.deleteActions}>
                  <button
                    className={styles.deleteConfirmBtn}
                    onClick={handleDeleteConfirm}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    className={styles.deleteCancelBtn}
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <button className={styles.navBtn} onClick={next} aria-label="Next image">›</button>
        </div>

        {/* ── Prompt text + close ───────────────────────────── */}
        <div className={styles.infoBar}>
          <p className={styles.promptText}>{img.prompt}</p>
          <div className={styles.infoRight}>
            <button
              className={styles.copyBtn}
              onClick={() => copy(img.prompt)}
              title="Copy prompt to clipboard"
            >
              {copied ? '✓ Copied' : 'Copy prompt'}
            </button>
            <button
              className={`${styles.deleteBtn} ${confirmDelete ? styles.deleteBtnActive : ''}`}
              onClick={() => setConfirmDelete((v) => !v)}
              title="Delete image from disk"
            >
              🗑 Delete
            </button>
            <span className={styles.counter}>{current + 1} / {images.length}</span>
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {/* ── Thumbnail strip ───────────────────────────────── */}
        <div className={styles.strip}>
          {images.map((thumb, idx) => (
            <button
              id={`preview-thumb-${idx}`}
              key={thumb.id}
              className={`${styles.thumb} ${idx === current ? styles.thumbActive : ''}`}
              onClick={() => setCurrent(idx)}
              title={`Image ${idx + 1}`}
            >
              <img src={thumb.url} alt="" className={styles.thumbImg} loading="lazy" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
