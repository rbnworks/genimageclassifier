import { apiFetch } from './client'

export interface Stats {
  totalImages: number
  imagesWithMetadata: number
  imagesWithoutMetadata: number
  uniquePrompts: number
}

export function fetchStats(): Promise<Stats> {
  return apiFetch<Stats>('/api/stats')
}
