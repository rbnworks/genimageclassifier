import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { PromptGroup } from '../api/prompts'
import { usePromptGroups } from '../hooks/usePromptGroups'
import {
  Region,
  deleteLayoutFromStorage,
  listSavedLayouts,
  useCollageEditor,
} from '../hooks/useCollageEditor'
import styles from './CollageEditorPage.module.css'

// ── Resize handle positions ────────────────────────────────────────────────
type Handle =
  | 'nw' | 'n' | 'ne'
  | 'w'           | 'e'
  | 'sw' | 's' | 'se'
  | 'move'

const HANDLE_SIZE = 14          // px in SVG space (hit target)
const MIN_SIZE     = 40

// ── Helper: hit-test a region's handles / body in SVG coords ──────────────
function hitHandle(
  rx: number, ry: number, rw: number, rh: number,
  px: number, py: number,
): Handle | null {
  const hs = HANDLE_SIZE
  const cx = rx + rw / 2
  const cy = ry + rh / 2

  const corners: [Handle, number, number][] = [
    ['nw', rx,      ry      ],
    ['ne', rx + rw, ry      ],
    ['sw', rx,      ry + rh ],
    ['se', rx + rw, ry + rh ],
  ]
  const edges: [Handle, number, number][] = [
    ['n', cx, ry      ],
    ['s', cx, ry + rh ],
    ['w', rx, cy      ],
    ['e', rx + rw, cy],
  ]

  for (const [h, hx, hy] of [...corners, ...edges]) {
    if (Math.abs(px - hx) <= hs && Math.abs(py - hy) <= hs) return h
  }
  if (px >= rx && px <= rx + rw && py >= ry && py <= ry + rh) return 'move'
  return null
}

// Apply a drag delta for the given handle to a region (canvas coords).
function applyHandle(
  r: Region, h: Handle,
  dx: number, dy: number,
  canvasW: number, canvasH: number,
): Partial<Region> {
  let { x, y, w, h: rh } = r

  if (h === 'move') {
    x = Math.max(0, Math.min(canvasW - w, x + dx))
    y = Math.max(0, Math.min(canvasH - rh, y + dy))
    return { x, y }
  }

  const right  = x + w
  const bottom = y + rh

  if (h === 'n'  || h === 'nw' || h === 'ne') {
    const newY = Math.max(0, Math.min(bottom - MIN_SIZE, y + dy))
    rh = bottom - newY; y = newY
  }
  if (h === 's'  || h === 'sw' || h === 'se') {
    rh = Math.max(MIN_SIZE, Math.min(canvasH - y, rh + dy))
  }
  if (h === 'w'  || h === 'nw' || h === 'sw') {
    const newX = Math.max(0, Math.min(right  - MIN_SIZE, x + dx))
    w  = right  - newX; x = newX
  }
  if (h === 'e'  || h === 'ne' || h === 'se') {
    w  = Math.max(MIN_SIZE, Math.min(canvasW - x, w  + dx))
  }

  return { x, y, w, h: rh }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CollageEditorPage() {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const svgRef       = useRef<SVGSVGElement>(null)
  const previewRef   = useRef<HTMLDivElement>(null)
  const { groups }   = usePromptGroups()

  const {
    canvasW, setCanvasW,
    canvasH, setCanvasH,
    bgColor, setBgColor,
    regions, selectedId, setSelectedId,
    mode, setMode,
    rendering, error,
    addRegion, deleteRegion, updateRegion, duplicateRegion,
    loadTemplate, saveLayout, loadCustomLayout,
    assignImage,
    redrawSkeletons, renderFilled, download,
    fillFromSource,
    templateNames,
  } = useCollageEditor(canvasRef)

  // ── Scale factor: canvas → SVG/screen ───────────────────────────────────
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      setScale(Math.min((width - 40) / canvasW, (height - 40) / canvasH, 1))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [canvasW, canvasH])

  // Recompute scale when canvas dims change.
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setScale(Math.min((width - 40) / canvasW, (height - 40) / canvasH, 1))
  }, [canvasW, canvasH])

  // ── Drag state ───────────────────────────────────────────────────────────
  const dragRef = useRef<{
    regionId: string
    handle: Handle
    startX: number
    startY: number
    startRegion: Region
  } | null>(null)

  // Convert pointer event offset → SVG/canvas coords.
  const toCanvas = useCallback(
    (e: React.PointerEvent): { x: number; y: number } => {
      const svg = svgRef.current!
      const rect = svg.getBoundingClientRect()
      return {
        x: (e.clientX - rect.left) / scale,
        y: (e.clientY - rect.top)  / scale,
      }
    },
    [scale],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent, regionId: string) => {
      if (mode === 'fill') return
      e.currentTarget.setPointerCapture(e.pointerId)
      const { x, y } = toCanvas(e)
      const r = regions.find((r) => r.id === regionId)!
      const h = hitHandle(r.x, r.y, r.w, r.h, x, y) ?? 'move'
      dragRef.current = { regionId, handle: h, startX: x, startY: y, startRegion: { ...r } }
      setSelectedId(regionId)
    },
    [mode, regions, toCanvas, setSelectedId],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const { x, y } = toCanvas(e)
      const dx = x - d.startX
      const dy = y - d.startY
      const patch = applyHandle(d.startRegion, d.handle, dx, dy, canvasW, canvasH)
      updateRegion(d.regionId, { ...patch, x: Math.round(patch.x ?? d.startRegion.x), y: Math.round(patch.y ?? d.startRegion.y) })
    },
    [toCanvas, canvasW, canvasH, updateRegion],
  )

  const onPointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  // ── Fill-mode click ──────────────────────────────────────────────────────
  const onSvgClick = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== 'fill') return
      const { x, y } = (() => {
        const svg = svgRef.current!
        const rect = svg.getBoundingClientRect()
        return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale }
      })()
      for (let i = regions.length - 1; i >= 0; i--) {
        const r = regions[i]
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          setSelectedId(r.id)
          return
        }
      }
    },
    [mode, regions, scale, setSelectedId],
  )

  // ── Save layout dialog ───────────────────────────────────────────────────
  const [saveName, setSaveName]     = useState('')
  const [savedNames, setSavedNames] = useState(() => listSavedLayouts())

  const onSave = () => {
    const name = saveName.trim() || `Layout-${canvasW}x${canvasH}`
    saveLayout(name)
    setSavedNames(listSavedLayouts())
    setSaveName('')
  }

  const onLoadSaved = (name: string) => {
    loadCustomLayout(name)
    setSavedNames(listSavedLayouts())
  }

  const onDeleteSaved = (name: string) => {
    deleteLayoutFromStorage(name)
    setSavedNames(listSavedLayouts())
  }

  // ── Image picker for fill mode ───────────────────────────────────────────
  const [fillSource, setFillSource] = useState<'all' | 'prompt'>('all')
  const [fillPrompts, setFillPrompts] = useState<string[]>([])
  const [fillRandom, setFillRandom]   = useState(true)

  const toggleFillPrompt = (id: string) =>
    setFillPrompts((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  const onFillAll = async () => {
    await fillFromSource(fillSource, fillPrompts, fillRandom)
  }

  const selectedRegion = regions.find((r) => r.id === selectedId)

  // ── Handle dots for SVG overlay ──────────────────────────────────────────
  function regionHandleDots(r: Region) {
    const hs = HANDLE_SIZE
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2

    // Corners: filled circles (easier to see + grab)
    const corners: [number, number][] = [
      [r.x,          r.y          ], // nw
      [r.x + r.w,    r.y          ], // ne
      [r.x,          r.y + r.h   ], // sw
      [r.x + r.w,    r.y + r.h   ], // se
    ]
    // Edge midpoints: smaller squares
    const edges: [number, number][] = [
      [cx,           r.y          ], // n
      [r.x,          cy           ], // w
      [r.x + r.w,    cy           ], // e
      [cx,           r.y + r.h   ], // s
    ]
    return (
      <g>
        {edges.map(([px, py], i) => (
          <rect
            key={`e${i}`}
            x={px - hs * 0.35} y={py - hs * 0.35}
            width={hs * 0.7} height={hs * 0.7}
            rx={2}
            fill="#5b9cf6"
            stroke="#fff"
            strokeWidth={1.5 / scale}
            style={{ cursor: 'crosshair' }}
          />
        ))}
        {corners.map(([px, py], i) => (
          <circle
            key={`c${i}`}
            cx={px} cy={py}
            r={hs * 0.55}
            fill="#fff"
            stroke="#5b9cf6"
            strokeWidth={2.5 / scale}
            style={{ cursor: 'nwse-resize' }}
          />
        ))}
      </g>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────── */}
      <aside className={styles.sidebar}>
        <h2 className={styles.heading}>Layout Editor</h2>

        {/* Mode toggle */}
        <section className={styles.section}>
          <label className={styles.sectionLabel}>Mode</label>
          <div className={styles.modeRow}>
            <button
              className={`${styles.modeBtn} ${mode === 'design' ? styles.modeBtnActive : ''}`}
              onClick={() => setMode('design')}
            >
              ✏ Design
            </button>
            <button
              className={`${styles.modeBtn} ${mode === 'fill' ? styles.modeBtnActive : ''}`}
              onClick={() => setMode('fill')}
            >
              🖼 Fill
            </button>
          </div>
        </section>

        {/* ── DESIGN MODE controls ── */}
        {mode === 'design' && (
          <>
            {/* Templates */}
            <section className={styles.section}>
              <label className={styles.sectionLabel}>Templates</label>
              <div className={styles.presets}>
                {templateNames.map((name) => (
                  <button
                    key={name}
                    className={styles.presetBtn}
                    onClick={() => loadTemplate(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </section>

            {/* Saved layouts */}
            <section className={styles.section}>
              <label className={styles.sectionLabel}>Saved layouts</label>
              {savedNames.length === 0 && (
                <span className={styles.hint}>None yet.</span>
              )}
              {savedNames.map((name) => (
                <div key={name} className={styles.savedRow}>
                  <button className={styles.savedLoadBtn} onClick={() => onLoadSaved(name)}>
                    {name}
                  </button>
                  <button
                    className={styles.savedDelBtn}
                    onClick={() => onDeleteSaved(name)}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className={styles.saveRow}>
                <input
                  className={styles.saveInput}
                  placeholder="Layout name…"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onSave()}
                />
                <button className={styles.presetBtn} onClick={onSave}>Save</button>
              </div>
            </section>

            {/* Canvas size */}
            <section className={styles.section}>
              <label className={styles.sectionLabel}>
                Width: <strong>{canvasW}px</strong>
              </label>
              <input
                type="range" min={400} max={4000} step={40} value={canvasW}
                onChange={(e) => setCanvasW(Number(e.target.value))}
                className={styles.range}
              />
              <label className={styles.sectionLabel} style={{ marginTop: 8 }}>
                Height: <strong>{canvasH}px</strong>
              </label>
              <input
                type="range" min={400} max={4000} step={40} value={canvasH}
                onChange={(e) => setCanvasH(Number(e.target.value))}
                className={styles.range}
              />
              <div className={styles.presets} style={{ marginTop: 6 }}>
                {[['16:9', 1920, 1080], ['1:1', 1080, 1080], ['4:3', 1600, 1200], ['9:16', 1080, 1920]].map(
                  ([label, w, h]) => (
                    <button
                      key={label as string}
                      className={styles.presetBtn}
                      onClick={() => { setCanvasW(w as number); setCanvasH(h as number) }}
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            </section>

            {/* Background */}
            <section className={styles.section}>
              <label className={styles.sectionLabel}>Background</label>
              <div className={styles.bgRow}>
                <input
                  type="color" value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className={styles.colorPicker}
                />
                <span className={styles.colorHex}>{bgColor}</span>
                <button className={styles.presetBtn} onClick={() => setBgColor('#111111')}>Dark</button>
                <button className={styles.presetBtn} onClick={() => setBgColor('#ffffff')}>White</button>
              </div>
            </section>

            {/* Regions */}
            <section className={styles.section}>
              <label className={styles.sectionLabel}>
                Regions ({regions.length})
              </label>
              <button className={`${styles.btn} ${styles.btnAdd}`} onClick={addRegion}>
                + Add region
              </button>

              {/* Region properties panel */}
              {selectedRegion && (() => {
                const r = selectedRegion
                const idx = regions.indexOf(r)
                const setW = (val: number) => {
                  const w = Math.max(MIN_SIZE, Math.min(canvasW - r.x, val))
                  updateRegion(r.id, { w })
                }
                const setH = (val: number) => {
                  const h = Math.max(MIN_SIZE, Math.min(canvasH - r.y, val))
                  updateRegion(r.id, { h })
                }
                const setX = (val: number) => {
                  const x = Math.max(0, Math.min(canvasW - r.w, val))
                  updateRegion(r.id, { x })
                }
                const setY = (val: number) => {
                  const y = Math.max(0, Math.min(canvasH - r.h, val))
                  updateRegion(r.id, { y })
                }
                const applyAR = (arW: number, arH: number) => {
                  // Lock to width, adjust height to match ratio
                  const newH = Math.round(r.w * arH / arW)
                  setH(newH)
                }
                return (
                  <div className={styles.regionProps}>
                    <div className={styles.regionPropsTitle}>
                      <span>Region #{idx + 1}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className={styles.arBtn}
                          onClick={() => duplicateRegion(r.id)}
                          title="Duplicate region"
                        >
                          ⧉ Duplicate
                        </button>
                        <button
                          className={styles.savedDelBtn}
                          onClick={() => deleteRegion(r.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* W / H inputs */}
                    <div className={styles.regionInputGrid}>
                      <label className={styles.regionInputLabel}>W</label>
                      <input
                        type="number" min={MIN_SIZE} max={canvasW}
                        value={Math.round(r.w)}
                        onChange={(e) => setW(Number(e.target.value))}
                        className={styles.regionInput}
                      />
                      <label className={styles.regionInputLabel}>H</label>
                      <input
                        type="number" min={MIN_SIZE} max={canvasH}
                        value={Math.round(r.h)}
                        onChange={(e) => setH(Number(e.target.value))}
                        className={styles.regionInput}
                      />
                      <label className={styles.regionInputLabel}>X</label>
                      <input
                        type="number" min={0} max={canvasW - r.w}
                        value={Math.round(r.x)}
                        onChange={(e) => setX(Number(e.target.value))}
                        className={styles.regionInput}
                      />
                      <label className={styles.regionInputLabel}>Y</label>
                      <input
                        type="number" min={0} max={canvasH - r.h}
                        value={Math.round(r.y)}
                        onChange={(e) => setY(Number(e.target.value))}
                        className={styles.regionInput}
                      />
                    </div>

                    {/* Aspect ratio presets */}
                    <div className={styles.arRow}>
                      <span className={styles.arLabel}>Ratio:</span>
                      {[
                        ['16:9',  16, 9 ],
                        ['9:16',  9, 16 ],
                        ['1:1',   1,  1 ],
                        ['4:3',   4,  3 ],
                        ['3:4',   3,  4 ],
                        ['3:2',   3,  2 ],
                      ].map(([label, arW, arH]) => (
                        <button
                          key={label as string}
                          className={styles.arBtn}
                          onClick={() => applyAR(arW as number, arH as number)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </section>
          </>
        )}

        {/* ── FILL MODE controls ── */}
        {mode === 'fill' && (
          <>
            <section className={styles.section}>
              <label className={styles.sectionLabel}>Image source</label>
              {(['all', 'prompt'] as const).map((s) => (
                <label key={s} className={styles.radioLabel}>
                  <input
                    type="radio" name="fillSource" value={s}
                    checked={fillSource === s}
                    onChange={() => setFillSource(s)}
                  />
                  {s === 'all' ? 'All images' : 'By prompt'}
                </label>
              ))}
            </section>

            {fillSource === 'prompt' && (
              <section className={styles.section}>
                <label className={styles.sectionLabel}>Prompts</label>
                <div className={styles.promptList}>
                  {groups.map((g: PromptGroup) => (
                    <label key={g.prompt_id} className={styles.checkLabel}>
                      <input
                        type="checkbox"
                        checked={fillPrompts.includes(g.prompt_id)}
                        onChange={() => toggleFillPrompt(g.prompt_id)}
                      />
                      <span className={styles.checkText}>
                        {g.prompt.slice(0, 50)}{g.prompt.length > 50 ? '…' : ''}
                        <span className={styles.count}> ({g.count})</span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            <section className={styles.section}>
              <label className={styles.radioLabel}>
                <input
                  type="checkbox"
                  checked={fillRandom}
                  onChange={(e) => setFillRandom(e.target.checked)}
                />
                Randomise order
              </label>
            </section>

            <section className={styles.section}>
              <label className={styles.sectionLabel}>
                Click a region to select it, or:
              </label>
              <button
                className={`${styles.btn} ${styles.btnAdd}`}
                onClick={onFillAll}
              >
                Auto-fill all regions
              </button>
              {selectedRegion && (
                <div className={styles.regionInfo}>
                  <span>Region #{regions.indexOf(selectedRegion) + 1} selected</span>
                  {selectedRegion.imageUrl && (
                    <img
                      src={selectedRegion.imageUrl}
                      className={styles.thumb}
                      alt=""
                    />
                  )}
                </div>
              )}
            </section>
          </>
        )}

        {/* ── Actions ── */}
        <div className={styles.actions}>
          <button
            className={`${styles.btn} ${styles.btnSkeleton}`}
            onClick={redrawSkeletons}
          >
            ▣ Preview skeleton
          </button>
          <button
            className={`${styles.btn} ${styles.btnGenerate}`}
            onClick={renderFilled}
            disabled={rendering}
          >
            {rendering ? 'Rendering…' : '▶ Render'}
          </button>
          <button className={`${styles.btn} ${styles.btnDownload}`} onClick={download}>
            ↓ Download PNG
          </button>
        </div>

        {error && <p className={styles.error}>{error}</p>}
      </aside>

      {/* ── CANVAS + OVERLAY ───────────────────────────────────────── */}
      <main className={styles.preview} ref={previewRef}>
        <div
          className={styles.canvasWrap}
          style={{ width: canvasW * scale, height: canvasH * scale }}
        >
          {/* Actual canvas (output) */}
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            style={{ width: canvasW * scale, height: canvasH * scale }}
          />

          {/* SVG overlay for interactive region editing */}
          <svg
            ref={svgRef}
            className={styles.overlay}
            width={canvasW * scale}
            height={canvasH * scale}
            viewBox={`0 0 ${canvasW} ${canvasH}`}
            onClick={onSvgClick}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {regions.map((r, idx) => {
              const isSelected = r.id === selectedId
              return (
                <g key={r.id}>
                  {/* Region body */}
                  <rect
                    x={r.x} y={r.y} width={r.w} height={r.h}
                    fill={
                      r.imageUrl
                        ? 'rgba(46,204,113,0.12)'
                        : mode === 'fill' && isSelected
                          ? 'rgba(91,156,246,0.25)'
                          : 'rgba(91,156,246,0.08)'
                    }
                    stroke={isSelected ? '#5b9cf6' : 'rgba(91,156,246,0.5)'}
                    strokeWidth={isSelected ? 2 / scale : 1 / scale}
                    strokeDasharray={isSelected ? 'none' : `${6 / scale}`}
                    style={{ cursor: mode === 'design' ? 'move' : 'pointer' }}
                    onPointerDown={(e) => onPointerDown(e, r.id)}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId(r.id)
                    }}
                  />
                  {/* Label */}
                  <text
                    x={r.x + r.w / 2} y={r.y + r.h / 2}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={r.imageUrl ? 'rgba(46,204,113,0.8)' : 'rgba(91,156,246,0.6)'}
                    fontSize={Math.min(r.w, r.h) * 0.18}
                    fontWeight="bold"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {r.imageUrl ? '✓' : idx + 1}
                  </text>
                  {/* Resize handles (design mode + selected only) */}
                  {mode === 'design' && isSelected && regionHandleDots(r)}
                </g>
              )
            })}
          </svg>

          {regions.length === 0 && (
            <div className={styles.placeholder}>
              Pick a template or click <strong>+ Add region</strong>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
