import React, { useEffect, useRef, useState } from 'react'
import { deleteImage, ImageItem } from '../api/prompts'
import { useClipboard } from '../hooks/useClipboard'
import ImagePreviewModal from './ImagePreviewModal'
import styles from './PromptModal.module.css'

interface Props {
  prompt: string
  images: ImageItem[]
  loading?: boolean
  onClose: () => void
  onDelete?: (imageId: string) => void
}

function ImageThumb({
  img,
  index,
  onPreview,
  onDeleted,
}: {
  img: ImageItem
  index: number
  onPreview: (i: number) => void
  onDeleted: (id: string) => void
}) {
  const { copy, copied } = useClipboard()
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm) { setConfirm(true); return }
    setDeleting(true)
    try {
      await deleteImage(img.id)
      onDeleted(img.id)
    } catch (err) {
      console.error('[PromptModal] delete failed', err)
      setDeleting(false)
      setConfirm(false)
    }
  }

  return (
    <div className={styles.thumbWrapper}>
      <button className={styles.thumbImgBtn} onClick={() => onPreview(index)}>
        <img src={img.url} alt="" className={styles.thumb} loading="lazy" />
      </button>
      <div className={styles.thumbOverlay}>
        <p className={styles.thumbPrompt}>{img.prompt}</p>
        <div className={styles.thumbActions}>
          <button className={styles.copyBtn} onClick={(e) => { e.stopPropagation(); copy(img.prompt) }}>
            {copied ? '✓' : 'Copy'}
          </button>
          <button
            className={`${styles.thumbDeleteBtn} ${confirm ? styles.thumbDeleteBtnConfirm : ''}`}
            onClick={handleDelete}
            disabled={deleting}
            title={confirm ? 'Click again to confirm delete' : 'Delete image'}
          >
            {deleting ? '…' : confirm ? 'Sure?' : '🗑'}
          </button>
          {confirm && (
            <button
              className={styles.thumbCancelBtn}
              onClick={(e) => { e.stopPropagation(); setConfirm(false) }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PromptModal({ prompt, images: initialImages, loading = false, onClose, onDelete }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const { copy, copied } = useClipboard()
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [images, setImages] = useState(initialImages)

  // Sync when parent re-fetches after a poll/refresh
  useEffect(() => { setImages(initialImages) }, [initialImages])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only handle Escape at this level when ImagePreviewModal is NOT open
      if (e.key === 'Escape' && previewIndex === null) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, previewIndex])

  function handleDelete(imageId: string) {
    setImages((prev) => prev.filter((img) => img.id !== imageId))
    onDelete?.(imageId)
  }

  return (
    <>
    <div
      className={styles.overlay}
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={prompt}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>{prompt}</h2>
          <div className={styles.headerActions}>
            <button className={styles.copyBtn} onClick={() => copy(prompt)}>
              {copied ? '✓ Copied' : 'Copy prompt'}
            </button>
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close modal">✕</button>
          </div>
        </div>

        <div className={styles.body}>
          {loading && <p className={styles.status}>Loading…</p>}
          {!loading && images.length === 0 && (
            <p className={styles.status}>No images found.</p>
          )}
          {!loading && images.length > 0 && (
            <div className={styles.imageGrid}>
              {images.map((img, idx) => (
                <ImageThumb key={img.id} img={img} index={idx} onPreview={setPreviewIndex} onDeleted={handleDelete} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    {previewIndex !== null && (
      <ImagePreviewModal
        images={images}
        initialIndex={previewIndex}
        onClose={() => setPreviewIndex(null)}
        onDelete={handleDelete}
      />
    )}
    </>
  )
}
