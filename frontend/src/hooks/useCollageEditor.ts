/**
 * useCollageEditor — all state & logic for the drag/resize layout editor.
 *
 * Approach: pure React + pointer events on a scaled SVG overlay.
 * No third-party dependency needed — works inside Docker without rebuild.
 *
 *  Region has an id, position (% of canvas) and fill image url.
 *  The SVG overlay sits on top of a regular <canvas>; when the user
 *  commits ("Fill & Render"), regions are drawn onto the canvas.
 */

import { useCallback, useRef, useState } from 'react'
import { fetchAllImages, fetchImagesByPromptId, ImageItem } from '../api/prompts'

// ── Types ────────────────────────────────────────────────────────────────────

export interface Region {
  id: string
  /** All values are in canvas pixels (not %). */
  x: number
  y: number
  w: number
  h: number
  /** URL of assigned image (undefined = skeleton). */
  imageUrl?: string
}

export interface EditorLayout {
  name: string
  canvasW: number
  canvasH: number
  regions: Omit<Region, 'id' | 'imageUrl'>[]
}

// ── Built-in templates ────────────────────────────────────────────────────────

function buildTemplates(cw: number, ch: number): Record<string, EditorLayout> {
  return {
    '1×1': {
      name: '1×1',
      canvasW: cw, canvasH: ch,
      regions: [{ x: 0, y: 0, w: cw, h: ch }],
    },
    '2×1': {
      name: '2×1',
      canvasW: cw, canvasH: ch,
      regions: [
        { x: 0,      y: 0, w: cw / 2, h: ch },
        { x: cw / 2, y: 0, w: cw / 2, h: ch },
      ],
    },
    '2×2': {
      name: '2×2',
      canvasW: cw, canvasH: ch,
      regions: [
        { x: 0,      y: 0,      w: cw / 2, h: ch / 2 },
        { x: cw / 2, y: 0,      w: cw / 2, h: ch / 2 },
        { x: 0,      y: ch / 2, w: cw / 2, h: ch / 2 },
        { x: cw / 2, y: ch / 2, w: cw / 2, h: ch / 2 },
      ],
    },
    '3×2': {
      name: '3×2',
      canvasW: cw, canvasH: ch,
      regions: [
        { x: 0,          y: 0,      w: cw / 3, h: ch / 2 },
        { x: cw / 3,     y: 0,      w: cw / 3, h: ch / 2 },
        { x: (cw / 3) * 2, y: 0,    w: cw / 3, h: ch / 2 },
        { x: 0,          y: ch / 2, w: cw / 3, h: ch / 2 },
        { x: cw / 3,     y: ch / 2, w: cw / 3, h: ch / 2 },
        { x: (cw / 3) * 2, y: ch / 2, w: cw / 3, h: ch / 2 },
      ],
    },
    'Hero + 2': {
      name: 'Hero + 2',
      canvasW: cw, canvasH: ch,
      regions: [
        { x: 0,          y: 0, w: cw * 0.6, h: ch },
        { x: cw * 0.6,   y: 0, w: cw * 0.4, h: ch / 2 },
        { x: cw * 0.6,   y: ch / 2, w: cw * 0.4, h: ch / 2 },
      ],
    },
    'Instagram': {
      name: 'Instagram',
      canvasW: 1080, canvasH: 1080,
      regions: [
        { x: 0,   y: 0,   w: 540, h: 540 },
        { x: 540, y: 0,   w: 540, h: 540 },
        { x: 0,   y: 540, w: 540, h: 540 },
        { x: 540, y: 540, w: 540, h: 540 },
      ],
    },
    '9:16 Story': {
      name: '9:16 Story',
      canvasW: 1080, canvasH: 1920,
      regions: [
        { x: 0, y: 0,    w: 1080, h: 960 },
        { x: 0, y: 960, w: 1080, h: 960 },
      ],
    },
  }
}

// ── localStorage helpers ──────────────────────────────────────────────────────

const LS_PREFIX = 'collage-editor-layout:'

export function listSavedLayouts(): string[] {
  return Object.keys(localStorage)
    .filter((k) => k.startsWith(LS_PREFIX))
    .map((k) => k.slice(LS_PREFIX.length))
}

export function saveLayoutToStorage(layout: EditorLayout) {
  localStorage.setItem(LS_PREFIX + layout.name, JSON.stringify(layout))
}

export function loadLayoutFromStorage(name: string): EditorLayout | null {
  const raw = localStorage.getItem(LS_PREFIX + name)
  return raw ? (JSON.parse(raw) as EditorLayout) : null
}

export function deleteLayoutFromStorage(name: string) {
  localStorage.removeItem(LS_PREFIX + name)
}

// ── Image cache ───────────────────────────────────────────────────────────────

const _imgCache = new Map<string, HTMLImageElement>()

function loadHTMLImage(url: string): Promise<HTMLImageElement> {
  if (_imgCache.has(url)) return Promise.resolve(_imgCache.get(url)!)
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload  = () => { _imgCache.set(url, el); resolve(el) }
    el.onerror = reject
    el.src = url
  })
}

// ── Draw helpers ──────────────────────────────────────────────────────────────

/** Side-crop only: scale to fill height, clip sides. */
function drawRegionSideCrop(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  r: Region,
) {
  const scale = r.h / img.naturalHeight
  const drawW = img.naturalWidth * scale
  const offX  = r.x + (r.w - drawW) / 2
  ctx.save()
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip()
  ctx.drawImage(img, offX, r.y, drawW, r.h)
  ctx.restore()
}

/** Skeleton (no image) — grey fill + dashed border. */
function drawSkeleton(ctx: CanvasRenderingContext2D, r: Region, idx: number) {
  ctx.fillStyle = 'rgba(50,80,120,0.35)'
  ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.strokeStyle = 'rgba(91,156,246,0.8)'
  ctx.lineWidth = 2
  ctx.setLineDash([8, 6])
  ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2)
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(91,156,246,0.7)'
  ctx.font = `bold ${Math.min(r.w, r.h) * 0.18}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${idx + 1}`, r.x + r.w / 2, r.y + r.h / 2)
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useCollageEditor(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [canvasW, setCanvasW] = useState(1920)
  const [canvasH, setCanvasH] = useState(1080)
  const [bgColor, setBgColor] = useState('#111111')
  const [regions, setRegions] = useState<Region[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'design' | 'fill'>('design')

  // ── Helpers ─────────────────────────────────────────────────────────────

  const uid = () => Math.random().toString(36).slice(2, 8)

  const addRegion = useCallback(() => {
    const newR: Region = {
      id: uid(),
      x: Math.round(canvasW * 0.1 + Math.random() * canvasW * 0.3),
      y: Math.round(canvasH * 0.1 + Math.random() * canvasH * 0.3),
      w: Math.round(canvasW * 0.25 + Math.random() * canvasW * 0.15),
      h: Math.round(canvasH * 0.25 + Math.random() * canvasH * 0.15),
    }
    setRegions((prev) => [...prev, newR])
    setSelectedId(newR.id)
  }, [canvasW, canvasH])

  const deleteRegion = useCallback((id: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== id))
    setSelectedId((s) => (s === id ? null : s))
  }, [])

  const duplicateRegion = useCallback((id: string) => {
    setRegions((prev) => {
      const src = prev.find((r) => r.id === id)
      if (!src) return prev
      const offset = 20
      const copy: Region = {
        ...src,
        id: Math.random().toString(36).slice(2, 8),
        x: src.x + offset,
        y: src.y + offset,
      }
      setSelectedId(copy.id)
      return [...prev, copy]
    })
  }, [])

  const updateRegion = useCallback((id: string, patch: Partial<Region>) => {
    setRegions((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const clampRegion = useCallback(
    (r: Region): Region => ({
      ...r,
      x: Math.max(0, Math.min(r.x, canvasW - r.w)),
      y: Math.max(0, Math.min(r.y, canvasH - r.h)),
      w: Math.max(40, Math.min(r.w, canvasW - r.x)),
      h: Math.max(40, Math.min(r.h, canvasH - r.y)),
    }),
    [canvasW, canvasH],
  )

  // ── Templates ────────────────────────────────────────────────────────────

  const loadTemplate = useCallback(
    (name: string) => {
      const templates = buildTemplates(canvasW, canvasH)
      const tpl = templates[name]
      if (!tpl) return
      if (tpl.canvasW !== canvasW) setCanvasW(tpl.canvasW)
      if (tpl.canvasH !== canvasH) setCanvasH(tpl.canvasH)
      setRegions(
        tpl.regions.map((r) => ({ ...r, id: uid() })),
      )
      setSelectedId(null)
    },
    [canvasW, canvasH],
  )

  const saveLayout = useCallback(
    (name: string) => {
      const layout: EditorLayout = {
        name,
        canvasW,
        canvasH,
        regions: regions.map(({ x, y, w, h }) => ({ x, y, w, h })),
      }
      saveLayoutToStorage(layout)
    },
    [canvasW, canvasH, regions],
  )

  const loadCustomLayout = useCallback((name: string) => {
    const layout = loadLayoutFromStorage(name)
    if (!layout) return
    setCanvasW(layout.canvasW)
    setCanvasH(layout.canvasH)
    setRegions(layout.regions.map((r) => ({ ...r, id: uid() })))
    setSelectedId(null)
  }, [])

  // ── Assign image to region ───────────────────────────────────────────────

  const assignImage = useCallback((regionId: string, url: string) => {
    setRegions((prev) =>
      prev.map((r) => (r.id === regionId ? { ...r, imageUrl: url } : r)),
    )
  }, [])

  // ── Render to canvas ─────────────────────────────────────────────────────

  const redrawSkeletons = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width  = canvasW
    canvas.height = canvasH
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, canvasW, canvasH)
    regions.forEach((r, i) => drawSkeleton(ctx, r, i))
  }, [canvasRef, canvasW, canvasH, bgColor, regions])

  const renderFilled = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    setRendering(true)
    setError(null)
    try {
      canvas.width  = canvasW
      canvas.height = canvasH
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, canvasW, canvasH)
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i]
        if (r.imageUrl) {
          const img = await loadHTMLImage(r.imageUrl)
          drawRegionSideCrop(ctx, img, r)
        } else {
          drawSkeleton(ctx, r, i)
        }
      }
    } catch (e: unknown) {
      setError(String(e))
    } finally {
      setRendering(false)
    }
  }, [canvasRef, canvasW, canvasH, bgColor, regions])

  const download = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = 'collage.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [canvasRef])

  // ── Fill-from-source helpers ──────────────────────────────────────────────

  const fillFromSource = useCallback(
    async (
      source: 'all' | 'prompt',
      promptIds: string[],
      random: boolean,
    ) => {
      let items: ImageItem[]
      if (source === 'all') {
        items = await fetchAllImages()
      } else {
        const results = await Promise.all(promptIds.map(fetchImagesByPromptId))
        items = results.flat()
      }
      if (random) {
        for (let i = items.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[items[i], items[j]] = [items[j], items[i]]
        }
      }
      setRegions((prev) =>
        prev.map((r, i) => ({
          ...r,
          imageUrl: items[i % items.length]?.url ?? r.imageUrl,
        })),
      )
    },
    [],
  )

  return {
    canvasW, setCanvasW,
    canvasH, setCanvasH,
    bgColor, setBgColor,
    regions, setRegions,
    selectedId, setSelectedId,
    mode, setMode,
    rendering, error,
    // actions
    addRegion,
    deleteRegion,
    duplicateRegion,
    updateRegion,
    clampRegion,
    loadTemplate,
    saveLayout,
    loadCustomLayout,
    assignImage,
    redrawSkeletons,
    renderFilled,
    download,
    fillFromSource,
    // statics
    templateNames: Object.keys(buildTemplates(canvasW, canvasH)),
    listSaved: listSavedLayouts,
    deleteSaved: deleteLayoutFromStorage,
  }
}
