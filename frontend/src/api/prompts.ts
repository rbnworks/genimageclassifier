import { apiFetch, API_BASE_URL } from './client'

export interface ImageItem {
  id: string
  path: string
  url: string
  prompt: string
  created_at: string
}

export interface PromptGroup {
  prompt_id: string
  prompt: string
  sample_image_url: string
  count: number
  latest_updated_at: string
}

export function fetchPromptGroups(): Promise<PromptGroup[]> {
  // cache: 'no-store' ensures the browser never serves a stale cached body after
  // a delete — the WS scan_updated event triggers a re-fetch and must get fresh data.
  return fetch(`${API_BASE_URL}/api/prompts`, { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`Request failed [${res.status}]`)
      return res.json() as Promise<PromptGroup[]>
    })
}

// Per-prompt image cache — avoids refetching the same prompt within a session.
const _promptImagesCache = new Map<string, ImageItem[]>()

export function fetchImagesByPromptId(promptId: string): Promise<ImageItem[]> {
  if (_promptImagesCache.has(promptId)) {
    console.info(`[fetchImagesByPromptId] cache hit for ${promptId}`)
    return Promise.resolve(_promptImagesCache.get(promptId)!)
  }
  console.info(`[fetchImagesByPromptId] fetching ${promptId} from backend`)
  return apiFetch<ImageItem[]>(`/api/prompts/${promptId}/images`).then((data) => {
    _promptImagesCache.set(promptId, data)
    return data
  })
}

export function clearPromptImageCache(): void {
  _promptImagesCache.clear()
}

export async function deleteImage(imageId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/images/${imageId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '')
    throw new Error(`Delete failed [${res.status}]: ${body}`)
  }
  // Evict all per-prompt caches since counts and lists changed.
  _promptImagesCache.clear()
}

export async function deleteAlbum(promptId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/prompts/${promptId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '')
    throw new Error(`Delete album failed [${res.status}]: ${body}`)
  }
  _promptImagesCache.delete(promptId)
}

// Keep the old name as an alias so other callers (SlideshowPage, etc.) don't break.
export const fetchImagesByPrompt = fetchImagesByPromptId

export function fetchAllImages(): Promise<ImageItem[]> {
  return apiFetch<ImageItem[]>('/api/images')
}
