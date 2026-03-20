import React, { useState } from 'react'
import { useClipboard } from '../hooks/useClipboard'
import styles from './PromptCard.module.css'

interface Props {
  prompt: string
  sampleImageUrl: string
  count: number
  onClick: () => void
  onDelete?: () => void
}

export default function PromptCard({ prompt, sampleImageUrl, count, onClick, onDelete }: Props) {
  const { copy, copied } = useClipboard()
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    copy(prompt)
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm) { setConfirm(true); return }
    setDeleting(true)
    try {
      await onDelete?.()
    } catch {
      setDeleting(false)
      setConfirm(false)
    }
  }

  function handleCancelDelete(e: React.MouseEvent) {
    e.stopPropagation()
    setConfirm(false)
  }

  return (
    <div
      className={styles.card}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <img src={sampleImageUrl} alt="" className={styles.image} loading="lazy" />
      <div className={styles.overlay}>
        <p className={styles.promptText}>{prompt}</p>
        <div className={styles.footer}>
          <span className={styles.count}>{count} image{count !== 1 ? 's' : ''}</span>
          <div className={styles.footerActions}>
            <button
              className={styles.copyBtn}
              onClick={handleCopy}
              title="Copy prompt"
              aria-label="Copy prompt to clipboard"
            >
              {copied ? '✓' : 'Copy'}
            </button>
            {onDelete && (
              <>
                <button
                  className={`${styles.deleteBtn} ${confirm ? styles.deleteBtnConfirm : ''}`}
                  onClick={handleDelete}
                  disabled={deleting}
                  title={confirm ? `Delete all ${count} images` : 'Delete album'}
                  aria-label="Delete album"
                >
                  {deleting ? '…' : confirm ? 'Delete all?' : '🗑'}
                </button>
                {confirm && (
                  <button
                    className={styles.cancelBtn}
                    onClick={handleCancelDelete}
                    title="Cancel"
                  >
                    ✕
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
