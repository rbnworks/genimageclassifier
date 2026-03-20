import React from 'react'
import { PromptGroup } from '../api/prompts'
import PromptCard from './PromptCard'
import styles from './PromptGrid.module.css'

interface Props {
  groups: PromptGroup[]
  onCardClick: (group: PromptGroup) => void
  onCardDelete?: (group: PromptGroup) => void
}

export default function PromptGrid({ groups, onCardClick, onCardDelete }: Props) {
  return (
    <div className={styles.grid}>
      {groups.map((group) => (
        <PromptCard
          key={group.prompt_id}
          prompt={group.prompt}
          sampleImageUrl={group.sample_image_url}
          count={group.count}
          onClick={() => onCardClick(group)}
          onDelete={onCardDelete ? () => onCardDelete(group) : undefined}
        />
      ))}
    </div>
  )
}
