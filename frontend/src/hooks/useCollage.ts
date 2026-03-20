import { useCallback, useRef, useState } from 'react'
import { fetchAllImages, fetchImagesByPromptId, ImageItem } from '../api/prompts'

export type LayoutMode = 'uniform' | 'masonry' | 'shelf'
export type SourceMode = 'all' | 'prompt' | 'random'

export interface CollageConfig {
  sourceMode: SourceMode
  selectedPromptIds: string[]
  promptImageCount: number   // max images to use per prompt (0 = all)
  promptRandom: boolean      // pick randomly instead of first-N
  randomCount: number
  canvasWidth: number
  canvasHeight: number
  layout: LayoutMode
  spacing: number
  bgColor: string
}

interface Tile {
  img: HTMLImageElement
  x: number
  y: number
  w: number
  h: number
}

// Load a URL into an HTMLImageElement (cached by URL).
const _imgCache = new Map<string, HTMLImageElement>()
function loadImage(url: string): Promise<HTMLImageElement> {
  if (_imgCache.has(url)) return Promise.resolve(_imgCache.get(url)!)
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => { _imgCache.set(url, el); resolve(el) }
    el.onerror = reject
    el.src = url
  })
}

// ── Layout algorithms ───────────────────────────────────────────────────────

interface Rect { x: number; y: number; w: number; h: number }

function layoutUniform(
  imgs: HTMLImageElement[],
  canvasW: number,
  canvasH: number,
  spacing: number,
): Tile[] {
  const n = imgs.length
  if (n === 0) return []
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const tileW = (canvasW - spacing * (cols + 1)) / cols
  const tileH = (canvasH - spacing * (rows + 1)) / rows

  return imgs.map((img, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = spacing + col * (tileW + spacing)
    const y = spacing + row * (tileH + spacing)
    return { img, x, y, w: tileW, h: tileH }
  })
}

/**
 * AR-weighted guillotine subdivision — zero-gap masonry.
 *
 * Every pixel of the canvas is covered (100% fill) AND each leaf tile's
 * aspect ratio is proportional to its image's aspect ratio, so the side-
 * crop-only draw function (drawTileMasonry) needs to crop as little as
 * possible.
 *
 * Algorithm:
 *  - Sort images by AR descending before calling so the widest images
 *    always go into the widest tiles.
 *  - Landscape rect  → vertical cut, split point weighted by
 *    sumAR(left) / sumAR(total)  (wide images get wider tiles)
 *  - Portrait rect   → horizontal cut, split point weighted by
 *    sum(1/AR)(top) / sum(1/AR)(total)  (tall images get taller tiles)
 *  - Clamp ratio to [0.2, 0.8] to prevent degenerate slivers.
 */
function guilSubdivide(rect: Rect, imgs: HTMLImageElement[], spacing: number): Tile[] {
  if (imgs.length === 0) return []
  if (imgs.length === 1) {
    return [{ img: imgs[0], x: rect.x, y: rect.y, w: rect.w, h: rect.h }]
  }

  const s     = spacing
  const half  = Math.floor(imgs.length / 2)
  const left  = imgs.slice(0, half)
  const right = imgs.slice(half)

  const sumAR = (arr: HTMLImageElement[]) =>
    arr.reduce((sum, img) => sum + Math.max(0.1, (img.naturalWidth || 1) / (img.naturalHeight || 1)), 0)
  const sumInvAR = (arr: HTMLImageElement[]) =>
    arr.reduce((sum, img) => sum + Math.max(0.1, (img.naturalHeight || 1) / (img.naturalWidth || 1)), 0)

  let r1: Rect, r2: Rect

  if (rect.w >= rect.h) {
    // Landscape → vertical cut, weighted by total AR
    const arL = sumAR(left)
    const arR = sumAR(right)
    const ratio = Math.max(0.2, Math.min(0.8, arL / (arL + arR)))
    const cutX = rect.x + Math.round(rect.w * ratio)
    r1 = { x: rect.x,                  y: rect.y, w: cutX - rect.x                        - Math.round(s / 2), h: rect.h }
    r2 = { x: cutX + Math.round(s / 2), y: rect.y, w: rect.x + rect.w - cutX - Math.round(s / 2), h: rect.h }
  } else {
    // Portrait → horizontal cut, weighted by total inverse-AR (tall images need more height)
    const invL = sumInvAR(left)
    const invR = sumInvAR(right)
    const ratio = Math.max(0.2, Math.min(0.8, invL / (invL + invR)))
    const cutY = rect.y + Math.round(rect.h * ratio)
    r1 = { x: rect.x, y: rect.y,                   w: rect.w, h: cutY - rect.y                        - Math.round(s / 2) }
    r2 = { x: rect.x, y: cutY + Math.round(s / 2), w: rect.w, h: rect.y + rect.h - cutY - Math.round(s / 2) }
  }

  return [
    ...guilSubdivide(r1, left,  spacing),
    ...guilSubdivide(r2, right, spacing),
  ]
}

function layoutGuillotine(
  imgs: HTMLImageElement[],
  canvasW: number,
  canvasH: number,
  spacing: number,
): Tile[] {
  if (imgs.length === 0) return []
  // Sort widest-first so vertical cuts naturally match wide tiles to wide images.
  const sorted = [...imgs].sort((a, b) => {
    const arA = (a.naturalWidth || 1) / (a.naturalHeight || 1)
    const arB = (b.naturalWidth || 1) / (b.naturalHeight || 1)
    return arB - arA
  })
  return guilSubdivide({ x: 0, y: 0, w: canvasW, h: canvasH }, sorted, spacing)
}

/**
 * Shelf (justified-row) layout — like Google Photos / Flickr:
 * Each row scales all its images to the same height so their widths fill canvasW.
 * Row heights are then scaled uniformly to fill canvasH.
 * Tile AR ≈ natural image AR → minimal / zero cropping needed.
 */
function layoutShelf(
  imgs: HTMLImageElement[],
  canvasW: number,
  canvasH: number,
  spacing: number,
): Tile[] {
  if (imgs.length === 0) return []

  // Target row height: chosen so all rows together span ≈ canvasH.
  // At height H each img contributes AR*H width; total = totalAR*H across numRows rows.
  // H ≈ sqrt(canvasH * canvasW / totalAR).
  const totalAR = imgs.reduce(
    (sum, img) => sum + Math.max(0.1, (img.naturalWidth || 1) / (img.naturalHeight || 1)),
    0,
  )
  const targetH = Math.max(60, Math.sqrt((canvasH * canvasW) / totalAR))

  // Greedy row-packing: break when next image would exceed canvasW.
  type RowEntry = { img: HTMLImageElement; ar: number }
  const rows: RowEntry[][] = []
  let currentRow: RowEntry[] = []
  let currentRowW = 0

  for (const img of imgs) {
    const ar = Math.max(0.1, (img.naturalWidth || 1) / (img.naturalHeight || 1))
    const scaledW = targetH * ar
    const gap = currentRow.length > 0 ? spacing : 0
    if (currentRow.length > 0 && currentRowW + gap + scaledW > canvasW) {
      rows.push(currentRow)
      currentRow = [{ img, ar }]
      currentRowW = scaledW
    } else {
      currentRow.push({ img, ar })
      currentRowW += gap + scaledW
    }
  }
  if (currentRow.length > 0) rows.push(currentRow)

  // Per-row: compute a uniform height so the widths exactly fill canvasW.
  type RowLayout = { entries: RowEntry[]; rowH: number; widths: number[] }
  const rowLayouts: RowLayout[] = rows.map((row) => {
    const sumAR  = row.reduce((s, e) => s + e.ar, 0)
    const availW = canvasW - spacing * Math.max(0, row.length - 1)
    const scale  = availW / (targetH * sumAR)
    return {
      entries: row,
      rowH:    targetH * scale,
      widths:  row.map((e) => targetH * e.ar * scale),
    }
  })

  // Vertical scale: make row heights sum to canvasH.
  const totalRowH = rowLayouts.reduce((s, r) => s + r.rowH, 0)
  const availH   = canvasH - spacing * Math.max(0, rows.length - 1)
  const vScale   = availH / totalRowH

  // Build tiles — last tile in each row/col fills the remaining pixels exactly.
  // Widths were computed to sum to canvasW; do NOT multiply by vScale (that's a vertical scale).
  const tiles: Tile[] = []
  let y = 0
  for (let r = 0; r < rowLayouts.length; r++) {
    const { entries, rowH, widths } = rowLayouts[r]
    const actualH = r === rowLayouts.length - 1 ? canvasH - y : Math.round(rowH * vScale)
    let x = 0
    for (let i = 0; i < entries.length; i++) {
      const tileW = i === entries.length - 1 ? canvasW - x : Math.round(widths[i])
      tiles.push({ img: entries[i].img, x, y, w: tileW, h: actualH })
      x += tileW + spacing
    }
    y += actualH + spacing
  }
  return tiles
}

// Uniform grid: contain (letterbox). Image never overflows its cell.
function drawTileContain(ctx: CanvasRenderingContext2D, tile: Tile) {
  const { img, x, y, w, h } = tile
  const naturalW = img.naturalWidth  || w
  const naturalH = img.naturalHeight || h
  const scale  = Math.min(w / naturalW, h / naturalH)   // contain
  const drawW  = naturalW * scale
  const drawH  = naturalH * scale
  const offX   = x + (w - drawW) / 2
  const offY   = y + (h - drawH) / 2
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
  ctx.drawImage(img, offX, offY, drawW, drawH)
  ctx.restore()
}

/**
 * Side-crop only (shelf layout) — never crops top or bottom.
 * Scales to fill the full tile height; clips excess width from the sides.
 */
function drawTileSmart(ctx: CanvasRenderingContext2D, tile: Tile) {
  const { img, x, y, w, h } = tile
  const imgW = img.naturalWidth  || w
  const imgH = img.naturalHeight || h

  // Scale so drawH === tile height (no vertical cropping).
  const scale = h / imgH
  const drawW = imgW * scale

  const offX = x + (w - drawW) / 2   // centre horizontally
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
  ctx.drawImage(img, offX, y, drawW, h)
  ctx.restore()
}

/**
 * Masonry draw — side-crop only like drawTileSmart, but each tile bleeds
 * horizontally 10 % beyond its boundary into neighbouring tiles.
 *
 * Why: binary-tree tiles have arbitrary aspect ratios, so a portrait image
 * in a landscape tile leaves visible side strips (background) when scaled
 * to fill height.  By expanding the clip region, the neighbouring tile’s
 * image covers those strips — creating natural overlaps instead of gaps.
 * Constraint: overlap ≤ 10 % of tile width; no top/bottom crop ever.
 */
function drawTileMasonry(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  canvasW: number,
  canvasH: number,
) {
  const { img, x, y, w, h } = tile
  const imgW = img.naturalWidth  || w
  const imgH = img.naturalHeight || h

  // Scale to fill tile height exactly — NEVER crops top/bottom.
  const scale = h / imgH
  const drawW = imgW * scale

  // Expand the clip region horizontally by 10 % of tile width on each side.
  const expand = w * 0.10
  const clipX = Math.max(0, x - expand)
  const clipW = Math.min(canvasW - clipX, w + expand * 2)
  const clipY = Math.max(0, y)
  const clipH = Math.min(canvasH - clipY, h)

  // Centre the image inside the ORIGINAL tile (not the expanded clip).
  const offX = x + (w - drawW) / 2

  ctx.save()
  ctx.beginPath()
  ctx.rect(clipX, clipY, clipW, clipH)
  ctx.clip()
  ctx.drawImage(img, offX, y, drawW, h)
  ctx.restore()
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useCollage(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)

  const generate = useCallback(
    async (cfg: CollageConfig) => {
      const canvas = canvasRef.current
      if (!canvas) return
      setGenerating(true)
      setError(null)
      abortRef.current = false

      try {
        // 1. Collect ImageItem records
        let items: ImageItem[] = []
        if (cfg.sourceMode === 'all') {
          items = await fetchAllImages()
        } else if (cfg.sourceMode === 'prompt') {
          const results = await Promise.all(
            cfg.selectedPromptIds.map((id) => fetchImagesByPromptId(id)),
          )
          let flat = results.flat()
          // Apply per-prompt image count limit
          if (cfg.selectedPromptIds.length > 0 && cfg.promptImageCount > 0) {
            // Re-apply per-prompt so each prompt contributes at most promptImageCount images
            const perPrompt = cfg.promptImageCount
            const capped: ImageItem[] = []
            for (const id of cfg.selectedPromptIds) {
              let slice = results[cfg.selectedPromptIds.indexOf(id)] ?? []
              if (cfg.promptRandom) {
                slice = [...slice].sort(() => Math.random() - 0.5)
              }
              capped.push(...slice.slice(0, perPrompt))
            }
            flat = capped
          }
          items = flat
        } else {
          // random — fetch all then sample
          const all = await fetchAllImages()
          for (let i = all.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[all[i], all[j]] = [all[j], all[i]]
          }
          items = all.slice(0, Math.max(1, cfg.randomCount))
        }

        if (abortRef.current) return
        if (items.length === 0) { setError('No images found for the selected source.'); return }

        // 2. Load images
        const htmlImgs = await Promise.all(items.map((it) => loadImage(it.url)))
        if (abortRef.current) return

        // 3. Compute layout
        const tiles =
          cfg.layout === 'uniform'
            ? layoutUniform(htmlImgs, cfg.canvasWidth, cfg.canvasHeight, cfg.spacing)
            : cfg.layout === 'shelf'
              ? layoutShelf(htmlImgs, cfg.canvasWidth, cfg.canvasHeight, cfg.spacing)
              : layoutGuillotine(htmlImgs, cfg.canvasWidth, cfg.canvasHeight, cfg.spacing)

        // 4. Draw
        canvas.width = cfg.canvasWidth
        canvas.height = cfg.canvasHeight
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = cfg.bgColor
        ctx.fillRect(0, 0, cfg.canvasWidth, cfg.canvasHeight)
        // Uniform: letterbox. Shelf: side-crop. Masonry: side-crop + 10% neighbour overlap.
        if (cfg.layout === 'uniform') {
          tiles.forEach((t) => drawTileContain(ctx, t))
        } else if (cfg.layout === 'shelf') {
          tiles.forEach((t) => drawTileSmart(ctx, t))
        } else {
          tiles.forEach((t) => drawTileMasonry(ctx, t, cfg.canvasWidth, cfg.canvasHeight))
        }
      } catch (e: unknown) {
        setError(String(e))
      } finally {
        setGenerating(false)
      }
    },
    [canvasRef],
  )

  const download = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = 'collage.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [canvasRef])

  const cancel = useCallback(() => { abortRef.current = true }, [])

  return { generate, download, cancel, generating, error }
}
