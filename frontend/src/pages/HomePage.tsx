import React, { useCallback, useEffect, useState } from 'react'
import {
  fetchImagesByPrompt,
  fetchPromptGroups,
  ImageItem,
  PromptGroup,
} from '../api/prompts'
import PromptGrid from '../components/PromptGrid'
import PromptModal from '../components/PromptModal'
import styles from './HomePage.module.css'

export default function HomePage() {
  const [groups, setGroups] = useState<PromptGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null)
  const [modalImages, setModalImages] = useState<ImageItem[]>([])
  const [modalLoading, setModalLoading] = useState(false)

  useEffect(() => {
    fetchPromptGroups()
      .then(setGroups)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const handleCardClick = useCallback(async (promptId: string, prompt: string) => {
    setSelectedPrompt(prompt)
    setModalImages([])
    setModalLoading(true)
    try {
      const imgs = await fetchImagesByPrompt(promptId)
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

  if (loading) return <div className={styles.status}>Scanning media…</div>
  if (error) return <div className={styles.error}>Error: {error}</div>
  if (groups.length === 0)
    return (
      <div className={styles.status}>
        No indexed images yet — drop images into a watched folder and wait for the next scan.
      </div>
    )

  return (
    <>
      <PromptGrid groups={groups} onCardClick={(g) => handleCardClick(g.prompt_id, g.prompt)} />
      {selectedPrompt !== null && (
        <PromptModal
          prompt={selectedPrompt}
          images={modalImages}
          loading={modalLoading}
          onClose={handleClose}
        />
      )}
    </>
  )
}
